// MDTN-A1 1.0 12823B20 SDA5KuII_tle28kZESub1OHc9gq9l1k7anDfsJ4sxQHzjz5ufFEKrTjv1YqUJ8GuUr_oq3iQHsL7JYMFeNNRDA
/* ============================================================================
 * md-tiny · 编辑器内核
 * ----------------------------------------------------------------------------
 * 浏览器扩展与 Windows 本地启动器共用本文件（逐字节一致），差异全部通过
 * window.MDTiny 这组宿主扩展点注入，不注入时行为与单机版完全一致。
 *
 * 流水线：marked 解析 -> DOMPurify 消毒 -> Prism 高亮 -> 触发 onRender 钩子
 *                                                    （ui.js 在此叠加装饰层）
 *
 * 签名：MDTN-F1 1.0 06 50 01 23 FE FC 80 D1 VDM
 * ========================================================================== */

(function () {
  'use strict';

  var VERSION = '1.0';

  var T = function (k) {
    var rest = Array.prototype.slice.call(arguments, 1);
    return window.MDI18N ? window.MDI18N.t.apply(window.MDI18N, [k].concat(rest)) : k;
  };

  /** 读设置。settings 模块缺失时回落到给定默认值，保证内核可独立运行 */
  function setting(key, fallback) {
    if (!window.MDSettings) return fallback;
    var v = window.MDSettings.get(key);
    return v === undefined ? fallback : v;
  }

  // ---------- DOM ----------
  var btnOpen = document.getElementById('btn-open');
  var btnOpenFolder = document.getElementById('btn-open-folder');
  var btnToggle = document.getElementById('btn-toggle');
  var btnSource = document.getElementById('btn-source');
  var btnSave = document.getElementById('btn-save');
  var statusEl = document.getElementById('status');
  var emptyState = document.getElementById('empty-state');
  var editor = document.getElementById('editor');
  var preview = document.getElementById('preview');
  var fileInput = document.getElementById('file-input');
  var tabbar = document.getElementById('tabbar');
  var sidebar = document.getElementById('sidebar');
  var fileTree = document.getElementById('file-tree');
  var searchInput = document.getElementById('search-input');

  // ---------- 状态 ----------
  var fileTreeHandle = null;    // 文件夹句柄
  var treeItems = [];           // [{name, path, handle}]
  var textCache = {};           // path -> 文本（搜索 / 打开缓存）
  var openFiles = [];           // [{key,name,path,handle,text,dirty,mode,eol,bom,openedText,openedRaw}]
  var activeKey = null;
  var currentText = '';
  var mode = 'empty';           // empty | preview | rich | source
                                //   preview 渲染阅读 / rich 所见即所得编辑 / source 源码编辑

  var FS_SUPPORTED = typeof window.showOpenFilePicker === 'function';
  var MD_RE = /\.(md|markdown|mdown|txt)$/i;
  var externalSaveHandler = null; // 由宿主注入（见文件末尾 window.MDTiny）
  var renderHooks = [];           // 渲染完成后的装饰钩子（ui.js 注册）

  // ---------- 工具 ----------
  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function getActiveTab() {
    if (!activeKey) return null;
    for (var i = 0; i < openFiles.length; i++) {
      if (openFiles[i].key === activeKey) return openFiles[i];
    }
    return null;
  }

  // ---------- 文本落盘保真 ----------
  // 浏览器对 textarea / contenteditable 的取值一律把换行归一化成 LF（HTML 规范），
  // 所以"编辑一次，整份文件的 CRLF 全被改成 LF"是必须显式防住的：
  // 打开时记下换行风格与 BOM，落盘时按记录还原。
  function analyzeEol(text) {
    var crlf = (text.match(/\r\n/g) || []).length;
    var bare = (text.match(/\n/g) || []).length - crlf;
    if (crlf === 0) return 'lf';
    if (bare === 0) return 'crlf';
    return crlf >= bare ? 'crlf' : 'lf'; // 混合行尾：按多数派统一（见 README 已知限制）
  }

  function toLf(text) {
    return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /** 磁盘文本：还原换行风格。内容与打开时完全一致时直接回放原始文本，
   *  这样"进了编辑态但什么都没改"也不会在磁盘上留下任何字节差异。 */
  function textForDisk(tab) {
    // 富文本态下 tab.text 可能还没跟上 DOM（用户刚敲完没触发提交），
    // 这里兜一次：host 拿到的永远是当前内容，而不是上一版
    if (tab && mode === 'rich' && window.MDRich && tab.key === activeKey) {
      tab.text = window.MDRich.commit();
    }
    var text = tab.text == null ? '' : String(tab.text);
    if (tab.openedText !== undefined && text === tab.openedText && tab.openedRaw !== undefined) {
      return tab.openedRaw;
    }
    if (tab.eol === 'crlf') return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    return text;
  }

  /** 完整落盘载荷：换行风格 + BOM。宿主自行管理 BOM 时用 textForDisk。 */
  function payloadOf(tab) {
    var text = textForDisk(tab);
    if (tab.bom && text.charCodeAt(0) !== 0xfeff) text = '\ufeff' + text;
    return text;
  }

  function showMode(next) {
    mode = next;
    emptyState.style.display = next === 'empty' ? 'flex' : 'none';
    editor.style.display = next === 'source' ? 'block' : 'none';
    preview.style.display = (next === 'preview' || next === 'rich') ? 'block' : 'none';

    if (next === 'preview') {
      btnToggle.textContent = T('btn.edit');
      btnToggle.disabled = false;
      btnSave.disabled = true;
    } else if (next === 'rich' || next === 'source') {
      btnToggle.textContent = T('btn.preview');
      btnToggle.disabled = false;
      btnSave.disabled = false;
    } else {
      btnToggle.textContent = T('btn.edit');
      btnToggle.disabled = true;
      btnSave.disabled = true;
    }

    // 「源码 / 所见即所得」这一对只在编辑态出现
    if (btnSource) {
      var editing = (next === 'rich' || next === 'source');
      btnSource.style.display = editing ? '' : 'none';
      btnSource.disabled = !editing;
      btnSource.textContent = next === 'source' ? T('btn.rich') : T('btn.source');
      btnSource.title = next === 'source' ? T('btn.rich.tip') : T('btn.source.tip');
    }

    if (next === 'source') {
      editor.value = currentText;
      editor.focus();
    }
  }

  /** 把当前编辑态的内容收进标签（切换标签 / 关闭 / 保存前都要先收） */
  function captureActive() {
    var tab = getActiveTab();
    if (!tab) return;
    if (mode === 'source') {
      tab.text = editor.value;
    } else if (mode === 'rich' && window.MDRich) {
      tab.text = window.MDRich.commit();
    }
  }

  /** 离开编辑态：先把内容收进标签（源码态取 textarea、富文本态走 commit），
   *  再让富文本模块清掉 contenteditable 与内部块状态。
   *  无论当前在哪种编辑态都必须先收 —— 否则切走时用户刚改的东西就被丢掉了。 */
  function leaveEdit() {
    captureActive();
    if (mode === 'rich' && window.MDRich) window.MDRich.exit();
  }

  // 预览渲染：marked 解析 → DOMPurify 消毒 → Prism 代码高亮 → 装饰钩子
  function renderPreview() {
    // 与当前标签的文本同步，避免"编辑后切回预览仍显示旧内容"
    var active = getActiveTab();
    if (active) currentText = active.text;

    var html = '';
    try {
      if (typeof marked !== 'undefined') {
        html = marked.parse(currentText || '', { gfm: true, breaks: true });
      } else {
        html = '<p style="color:#EA6668;">' + T('status.markedMissing') + '</p>';
      }
    } catch (e) {
      html = '<p style="color:#EA6668;">' + T('status.renderFail', String(e && e.message || e)) + '</p>';
    }

    if (typeof DOMPurify !== 'undefined') {
      html = DOMPurify.sanitize(html, { ADD_ATTR: ['checked', 'type'] });
    }

    preview.innerHTML = html;

    if (typeof Prism !== 'undefined') {
      var codes = preview.querySelectorAll('pre code');
      for (var i = 0; i < codes.length; i++) {
        try {
          Prism.highlightElement(codes[i]);
        } catch (e) {
          // 不再静默吞异常：高亮失败必须可见，否则会误判为"已着色但颜色不明显"
          console.warn('[prism] 代码高亮失败', codes[i].className, e);
        }
      }
    }

    runRenderHooks();
  }

  function runRenderHooks() {
    var ctx = { preview: preview, text: currentText, mode: mode, version: VERSION };
    for (var i = 0; i < renderHooks.length; i++) {
      try {
        renderHooks[i](ctx);
      } catch (e) {
        console.warn('[render hook] 执行失败', e);
      }
    }
  }

  // ---------- 多标签管理 ----------
  function openTab(info) {
    var key = info.path || info.name;
    for (var i = 0; i < openFiles.length; i++) {
      if (openFiles[i].key === key) {
        activateTab(key);
        return;
      }
    }
    // 统一在入口做一次"记账"：BOM 与换行风格各记一份，
    // 编辑期一律用 LF 的规范化文本，落盘时再按记录还原。
    var rawIn = String(info.text == null ? '' : info.text);
    var hasBom = info.bom === true || rawIn.charCodeAt(0) === 0xfeff;
    var raw = stripBom(rawIn);
    var lf = toLf(raw);

    openFiles.push({
      key: key,
      name: info.name,
      path: info.path,
      handle: info.handle,
      serverPath: info.serverPath || null, // 本地服务模式下的磁盘绝对路径
      text: lf,
      openedText: lf,                      // 打开时的规范化文本（判断"内容是否改过"）
      openedRaw: raw,                      // 打开时的原始文本（未改动则逐字节回放）
      eol: analyzeEol(raw),
      bom: hasBom,
      dirty: false,
      mode: 'preview'
    });
    renderTabbar();
    activateTab(key);
  }

  function activateTab(key) {
    captureActive();
    if (mode === 'rich' && window.MDRich) window.MDRich.exit();
    activeKey = key;
    var tab = getActiveTab();
    if (!tab) return;
    currentText = tab.text;
    if (tab.mode === 'rich') {
      enterRich();          // 该标签上次就停在所见即所得态，接着来
    } else if (tab.mode === 'source') {
      showMode('source');
    } else {
      renderPreview();
      showMode('preview');
    }
    setStatus(T('status.current', tab.name, tab.dirty ? T('status.dirtySuffix') : ''));
    renderTabbar();
  }

  /** 进入所见即所得编辑。模块缺席、或词法块无法无损拼回原文时，
   *  自动退化为源码编辑 —— 绝不给出"看着能编辑其实没反应"的界面。 */
  function enterRich() {
    var tab = getActiveTab();
    if (!tab) return;
    currentText = tab.text;

    if (window.MDRich && window.MDRich.available()) {
      showMode('rich');     // 容器先可见，模块再往里填块
      var r = window.MDRich.enter(preview, tab.text, { onDirty: markRichDirty });
      if (r && r.ok) {
        tab.mode = 'rich';
        setStatus(T('status.richEditing', tab.name));
        return;
      }
    }

    tab.mode = 'source';
    showMode('source');
    setStatus(T('status.richFallback', tab.name));
  }

  /** 富文本态下的第一次改动：标签打脏标记 + 状态栏提示 */
  function markRichDirty() {
    var tab = getActiveTab();
    if (!tab) return;
    if (!tab.dirty) {
      tab.dirty = true;
      renderTabbar();
    }
    setStatus(T('status.editingDirty', tab.name));
  }

  function closeTab(key) {
    if (key === activeKey) captureActive(); // 先收内容，脏标记才准
    var idx = -1;
    for (var i = 0; i < openFiles.length; i++) {
      if (openFiles[i].key === key) { idx = i; break; }
    }
    if (idx < 0) return;
    var tab = openFiles[idx];
    var needsAsk = tab.dirty && setting('files.confirmClose', true);
    if (needsAsk && !window.confirm(T('confirm.closeDirty', tab.name))) return;
    openFiles.splice(idx, 1);
    if (activeKey === key) {
      activeKey = null;
      var next = openFiles[idx] || openFiles[idx - 1];
      if (next) {
        activateTab(next.key);
      } else {
        currentText = '';
        showMode('empty');
        setStatus(T('status.allClosed'));
      }
    }
    renderTabbar();
  }

  function renderTabbar() {
    tabbar.innerHTML = '';
    for (var i = 0; i < openFiles.length; i++) {
      var tab = openFiles[i];
      var el = document.createElement('div');
      el.className = 'tab' + (tab.key === activeKey ? ' active' : '');
      el.title = tab.path || tab.name;

      var name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = (tab.dirty ? '● ' : '') + tab.name;
      name.addEventListener('click', (function (k) { return function () { activateTab(k); }; })(tab.key));

      var close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '×';
      close.addEventListener('click', (function (k) { return function (e) { e.stopPropagation(); closeTab(k); }; })(tab.key));

      el.appendChild(name);
      el.appendChild(close);
      tabbar.appendChild(el);
    }
  }

  // ---------- 打开单个文件 ----------
  /** 字节 → 文本：把 BOM 单独摘出来记账。
   *  不能用 file.text()：按编码规范它会把 BOM 吃掉，于是"打开带 BOM 的 md 再保存"就丢 BOM。 */
  function decodeBytes(buf) {
    var bytes = new Uint8Array(buf);
    var bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    var body = bom ? bytes.subarray(3) : bytes;
    return { text: new TextDecoder('utf-8').decode(body), bom: bom };
  }

  async function readHandle(handle) {
    var file = await handle.getFile();
    var meta = decodeBytes(await file.arrayBuffer());
    meta.name = file.name;
    return meta;
  }

  async function openWithPicker() {
    var handle;
    try {
      var picks = await window.showOpenFilePicker({
        types: [{
          description: T('opt.title'),
          accept: {
            'text/markdown': ['.md', '.markdown', '.mdown'],
            'text/plain': ['.txt']
          }
        }],
        multiple: false
      });
      handle = picks[0];
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      setStatus(T('status.openFail', String(err && err.message || err)));
      return;
    }
    var meta = await readHandle(handle);
    openTab({ name: meta.name, path: meta.name, handle: handle, text: meta.text, bom: meta.bom });
    setStatus(T('status.opened', meta.name));
  }

  function openWithInput() {
    fileInput.value = '';
    fileInput.click();
  }

  function handleInputFile(file) {
    file.arrayBuffer().then(function (buf) {
      var meta = decodeBytes(buf);
      openTab({ name: file.name, path: file.name, handle: null, text: meta.text, bom: meta.bom });
      setStatus(T('status.openedAlt', file.name));
    }).catch(function () { setStatus(T('status.fileReadFail')); });
  }

  btnOpen.addEventListener('click', function () {
    if (FS_SUPPORTED) openWithPicker(); else openWithInput();
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length > 0) {
      handleInputFile(fileInput.files[0]);
    }
  });

  // ---------- 打开文件夹 + 文件树 ----------
  async function openFolder() {
    if (!FS_SUPPORTED) {
      setStatus(T('status.noFolder'));
      return;
    }
    var handle;
    try {
      handle = await window.showDirectoryPicker();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      setStatus(T('status.openFolderFail', String(err && err.message || err)));
      return;
    }
    fileTreeHandle = handle;
    treeItems = [];
    await walkDir(handle, '');
    if (setting('files.revealTree', true)) sidebar.style.display = 'flex';
    renderTree('');
    setStatus(T('status.openFolder', handle.name, treeItems.length));
  }

  async function walkDir(dirHandle, prefix) {
    var entries = await dirHandle.values().toArray ? await dirHandle.values().toArray() : collect(dirHandle);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.kind === 'file') {
        if (MD_RE.test(entry.name)) {
          treeItems.push({ name: entry.name, path: prefix ? prefix + '/' + entry.name : entry.name, handle: entry });
        }
      } else if (entry.kind === 'directory') {
        var next = prefix ? prefix + '/' + entry.name : entry.name;
        try { await walkDir(entry, next); } catch (e) { /* 跳过无权限子目录 */ }
      }
    }
  }

  function collect(dirHandle) {
    // 兜底：低版本浏览器 values() 无 toArray 时手动收集
    var out = [];
    return new Promise(function (resolve) {
      var iter = dirHandle.values();
      function step() {
        var r = iter.next();
        if (r && r.then) {
          r.then(function (v) {
            if (v.done) { resolve(out); return; }
            out.push(v.value);
            step();
          });
          return;
        }
        if (r.done) { resolve(out); return; }
        out.push(r.value);
        step();
      }
      step();
    });
  }

  function renderTree(list) {
    fileTree.innerHTML = '';
    var items = list === null ? treeItems : list;
    if (items.length === 0) {
      var hint = document.createElement('div');
      hint.className = 'tree-hint';
      hint.textContent = list === null ? T('tree.empty') : T('tree.noMatch');
      fileTree.appendChild(hint);
      return;
    }
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var el = document.createElement('div');
        el.className = 'tree-item';
        el.textContent = item.path;
        el.title = item.path;
        el.addEventListener('click', function () { openTreeItem(item); });
        fileTree.appendChild(el);
      })(items[i]);
    }
  }

  async function openTreeItem(item) {
    var text;
    var bom = false;
    if (item.handle) {
      // 始终从磁盘重读：避免 textCache 一直回放外部已修改过的旧内容
      try {
        var meta = await readHandle(item.handle);
        text = meta.text;
        bom = meta.bom;
      } catch (err) {
        setStatus(T('status.readFail', item.path));
        return;
      }
      textCache[item.path] = text;
    } else {
      text = textCache[item.path] || '';
    }
    openTab({ name: item.name, path: item.path, handle: item.handle, text: text, bom: bom });
    setStatus(T('status.opened', item.path));
  }

  btnOpenFolder.addEventListener('click', openFolder);

  // ---------- 全文搜索 ----------
  var searchTimer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = searchInput.value.trim();
    searchTimer = setTimeout(function () { runSearch(q); }, 300);
  });

  async function runSearch(q) {
    if (!q) { renderTree(null); return; }
    var results = [];
    for (var i = 0; i < treeItems.length; i++) {
      var item = treeItems[i];
      var text = textCache[item.path];
      if (text === undefined) {
        try {
          text = await (await item.handle.getFile()).text();
        } catch (e) { continue; }
        textCache[item.path] = text;
      }
      var hit = matchLine(text, q);
      if (hit) results.push({ item: item, line: hit.line, lineText: hit.text });
      if (results.length >= 60) break; // 限制结果数量，防止目录过大卡顿
    }
    renderSearchResults(results, q);
  }

  function matchLine(text, q) {
    var idx = text.indexOf(q);
    if (idx < 0) return null;
    var line = text.slice(0, idx).split('\n').length;
    var lineText = text.split('\n')[line - 1].trim().slice(0, 80);
    return { line: line, text: lineText };
  }

  function renderSearchResults(results, q) {
    fileTree.innerHTML = '';
    if (results.length === 0) {
      var hint = document.createElement('div');
      hint.className = 'tree-hint';
      hint.textContent = T('tree.noHit', q);
      fileTree.appendChild(hint);
      return;
    }
    var count = document.createElement('div');
    count.className = 'tree-hint';
    count.textContent = T('tree.hits', results.length);
    fileTree.appendChild(count);

    for (var i = 0; i < results.length; i++) {
      (function (r) {
        var el = document.createElement('div');
        el.className = 'tree-item';
        var name = document.createElement('span');
        name.textContent = r.item.path;
        var line = document.createElement('span');
        line.className = 'tree-line';
        line.textContent = T('tree.line', r.line, r.lineText);
        el.appendChild(name);
        el.appendChild(line);
        el.title = r.item.path + ' ' + T('tree.line', r.line, '');
        el.addEventListener('click', function () { openSearchResult(r.item, q); });
        fileTree.appendChild(el);
      })(results[i]);
    }
  }

  async function openSearchResult(item, q) {
    await openTreeItem(item);
    // 定位到匹配行：切到源码编辑（行号在源码里才有意义）并滚动到对应位置
    showMode('source');
    var tab = getActiveTab();
    if (tab) tab.mode = 'source';
    var idx = editor.value.indexOf(q);
    if (idx >= 0) {
      var line = editor.value.slice(0, idx).split('\n').length;
      // 行高按实际渲染值计算，用户改字号后仍能正确滚动定位
      var cs = window.getComputedStyle(editor);
      var lineHeight = parseFloat(cs.lineHeight);
      if (!isFinite(lineHeight) || lineHeight <= 0) lineHeight = parseFloat(cs.fontSize) * 1.65;
      editor.focus();
      editor.setSelectionRange(idx, idx + q.length);
      editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
    }
    var m = matchLine(currentText || '', q);
    setStatus(T('status.located', item.path, m ? m.line : '?'));
  }

  // ---------- 编辑 / 预览切换 ----------
  // 「编辑」默认进所见即所得（排版不变、直接改），「源码」是给要改标记的人的出口。
  btnToggle.addEventListener('click', function () {
    var tab = getActiveTab();
    if (!tab) return;
    if (mode === 'preview') {
      enterRich();
    } else if (mode === 'rich' || mode === 'source') {
      leaveEdit();
      tab.mode = 'preview';
      currentText = tab.text;
      renderPreview();
      showMode('preview');
      setStatus(T('status.backPreview', tab.name));
    }
  });

  if (btnSource) {
    btnSource.addEventListener('click', function () {
      var tab = getActiveTab();
      if (!tab) return;
      if (mode === 'source') {
        enterRich();
      } else if (mode === 'rich') {
        leaveEdit();
        tab.mode = 'source';
        currentText = tab.text;
        showMode('source');
        setStatus(T('status.editing', tab.name));
      }
    });
  }

  // 编辑内容变化 -> 标记未保存
  editor.addEventListener('input', function () {
    var tab = getActiveTab();
    if (!tab || mode !== 'source') return;
    if (!tab.dirty) {
      tab.dirty = true;
      renderTabbar();
    }
    setStatus(T('status.editingDirty', tab.name));
  });

  // ---------- 保存 ----------
  async function saveWithHandle(tab) {
    try {
      if (!tab.handle) {
        var picks = await window.showSaveFilePicker({
          suggestedName: tab.name || 'untitled.md',
          types: [{
            description: T('opt.title'),
            accept: {
              'text/markdown': ['.md', '.markdown', '.mdown'],
              'text/plain': ['.txt']
            }
          }]
        });
        tab.handle = picks;
        tab.path = picks.name;
        tab.key = picks.name;
      }
      var writable = await tab.handle.createWritable();
      // 不是"把 tab.text 写出去"：落盘载荷要还原换行风格与 BOM，见 payloadOf
      await writable.write(payloadOf(tab));
      await writable.close();
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
      setStatus(T('status.saveFail', String(err && err.message || err)));
      return false;
    }
  }

  function saveWithDownload(tab) {
    var blob = new Blob([payloadOf(tab)], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = tab.name || 'untitled.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  /** 落盘成功后，把"打开时基准"推进到当前内容：
   *  下一次再编辑保存时，才能继续正确判断"哪些字节该原样回放"。 */
  function rebaseDisk(tab) {
    var disk = textForDisk(tab);
    tab.openedRaw = disk;
    tab.openedText = tab.text;
  }

  async function saveFile() {
    var tab = getActiveTab();
    if (!tab) {
      setStatus(T('status.needOpen'));
      return;
    }
    captureActive();
    // 宿主（本地服务）只在「文档有磁盘绝对路径」时才能接管保存 —— 它的写入接口是按路径寻址的。
    // 判定条件不能写成 tab.handle：用「打开」按钮选中的文件只有 FileSystemFileHandle、
    // 没有路径，交给宿主等于交给一个写不了的对象，保存会彻底静默失效（本版修复的 bug）。
    // 这类文档回落到内核自己的 File System Access API，用 handle 直接写回原文件。
    var statusBefore = statusEl.textContent;
    var ok;
    if (externalSaveHandler && tab.serverPath) {
      ok = await externalSaveHandler(tab);
    } else {
      ok = FS_SUPPORTED ? await saveWithHandle(tab) : saveWithDownload(tab);
    }
    if (!ok && statusEl.textContent === statusBefore) {
      // 失败与取消都必须留下回音：宿主和内核都没有说明原因时，这里兜底，
      // 绝不允许「点了保存却什么都不发生」这种静默状态。
      setStatus(T('status.saveUndone', tab.name));
    }
    if (ok) {
      activeKey = tab.key; // 另存为会改变 key，必须同步 activeKey，否则保存后当前标签失去激活态
      rebaseDisk(tab);
      tab.dirty = false;
      leaveEdit();
      tab.mode = 'preview';
      currentText = tab.text;
      renderPreview();
      showMode('preview');
      renderTabbar();
      setStatus(T('status.saved', tab.name));
    }
  }

  btnSave.addEventListener('click', saveFile);

  // Ctrl+S 保存 / Ctrl+W 关闭当前标签 / Esc 退出编辑
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && (mode === 'rich' || mode === 'source')) {
      var t0 = getActiveTab();
      if (t0) {
        e.preventDefault();
        leaveEdit();
        t0.mode = 'preview';
        currentText = t0.text;
        renderPreview();
        showMode('preview');
        setStatus(T('status.backPreview', t0.name));
      }
      return;
    }
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveFile();
    } else if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
      var tab = getActiveTab();
      if (tab) {
        e.preventDefault();
        closeTab(tab.key);
      }
    }
  });

  // ---------- 示例模式（URL 带 #demo，用于演示效果） ----------
  function loadDemo() {
    var doc1 = [
      '# ' + T('app.name'),
      '',
      T('empty.sub'),
      '',
      '## ' + T('tab.files') + ' / ' + T('tab.outline'),
      '',
      '- [x] ' + T('btn.open'),
      '- [x] ' + T('btn.save') + ' — Ctrl+S',
      '- [x] ' + T('tab.outline') + ' + Ctrl+B',
      '- [x] ' + T('theme.light') + ' / ' + T('theme.dark') + ' / ' + T('theme.auto'),
      '- [x] ' + T('set.title') + ' — Ctrl+,',
      '',
      '| | |',
      '| --- | --- |',
      '| **bold** | **bold** |',
      '| *italic* | *italic* |',
      '| `code` | `code` |',
      '',
      '```js',
      'const render = (md) => `markdown -> html`;',
      '```',
      '',
      '## Math',
      '',
      'Inline: $E = mc^2$, and the classic identity $\\int_0^1 x^2\\,dx = \\frac{1}{3}$.',
      '',
      '$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$',
      '',
      '## ' + T('copy.button'),
      '',
      '> ' + T('app.badge.local.tip')
    ].join('\n');

    var doc2 = [
      '# Code',
      '',
      '```js',
      'const greet = (name) => `hello ${name}`;',
      'console.log(greet("markdown"));',
      '```',
      '',
      '```python',
      'def fib(n):',
      '    return n if n < 2 else fib(n - 1) + fib(n - 2)',
      '```',
      '',
      '```bash',
      'ls -la && echo "done"',
      '```',
      '',
      '```json',
      '{ "name": "md-tiny", "version": "' + VERSION + '" }',
      '```'
    ].join('\n');

    var doc3 = [
      '# TODO',
      '',
      '- [x] tabs',
      '- [x] code highlight',
      '- [x] outline',
      '- [x] KaTeX',
      '- [ ] ' + T('btn.openFolder'),
      '',
      '> ' + T('status.demo')
    ].join('\n');

    openTab({ name: T('file.demo'), path: 'demo:' + T('file.demo'), text: doc1 });
    openTab({ name: T('file.code'), path: 'demo:' + T('file.code'), text: doc2 });
    openTab({ name: T('file.todo'), path: 'demo:' + T('file.todo'), text: doc3 });
    // 把概览文档置为当前标签：它的内容最能体现各项能力（标题 / 公式 / 表格）
    activateTab('demo:' + T('file.demo'));
    setStatus(T('status.demo'));
  }

  // ---------- 未保存离开提醒 ----------
  window.addEventListener('beforeunload', function (e) {
    if (!setting('files.warnUnload', true)) return;
    for (var i = 0; i < openFiles.length; i++) {
      if (openFiles[i].dirty) {
        e.preventDefault();
        e.returnValue = '';
        return;
      }
    }
  });

  // ---------- Tab 缩进（textarea 默认会跳出焦点，这里改为插入 / 移除缩进） ----------
  // 缩进宽度由设置面板决定（editor.tabSize），默认 2 空格。
  function indentUnit() {
    var n = Number(setting('editor.tabSize', 2));
    if (!isFinite(n) || n < 1 || n > 8) n = 2;
    return new Array(n + 1).join(' ');
  }

  editor.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();

    var INDENT = indentUnit();
    var value = editor.value;
    var start = editor.selectionStart;
    var end = editor.selectionEnd;

    // 光标单点 + Tab：插入一级缩进
    if (start === end && !e.shiftKey) {
      editor.value = value.slice(0, start) + INDENT + value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + INDENT.length;
      editor.dispatchEvent(new Event('input'));
      return;
    }

    // 多行（或 Shift+Tab）：整行缩进 / 反缩进
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    if (end > start && value.charAt(end - 1) === '\n') lineEnd = end - 1;

    var unindent = new RegExp('^ {1,' + INDENT.length + '}');
    var lines = value.slice(lineStart, lineEnd).split('\n');
    var mapped = lines.map(function (line) {
      return e.shiftKey ? line.replace(unindent, '') : INDENT + line;
    });
    var replaced = mapped.join('\n');

    editor.value = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
    editor.selectionStart = lineStart;
    editor.selectionEnd = lineStart + replaced.length;
    editor.dispatchEvent(new Event('input'));
  });

  // ---------- 文件关联入口（PWA / ChromeOS 场景） ----------
  // 清单里**不再声明** file_handlers：Chrome 的清单特性表把该键限定给 packaged app，
  // 普通扩展一声明就会带一条安装警告「'file_handlers' is only allowed for packaged apps」，
  // 而它在 Windows/macOS/Linux 上本来也不生效（ChromeOS 独占）。见 README 说明。
  // 本段保留：PWA 形态或自行加回该键的构建仍可直接复用这段消费逻辑；其他环境无害空转。
  if ('launchQueue' in window && typeof window.launchQueue.setConsumer === 'function') {
    window.launchQueue.setConsumer(async function (params) {
      if (!params || !params.files || !params.files.length) return;
      for (var i = 0; i < params.files.length; i++) {
        try {
          var handle = params.files[i];
          var meta = await readHandle(handle);
          openTab({ name: meta.name, path: meta.name, handle: handle, text: meta.text, bom: meta.bom });
          setStatus(T('status.opened', meta.name));
        } catch (err) {
          console.warn('[launchQueue] 打开文件失败', err);
        }
      }
    });
  }

  // ---------- 宿主扩展点 ----------
  // 扩展环境下无人调用，行为与单机版完全一致。
  window.MDTiny = {
    VERSION: VERSION,
    // 由外部传入打开：{ name, path, text, serverPath?, bom? }
    openText: function (info) { openTab(info); return getActiveTab(); },
    getActiveTab: getActiveTab,
    getPreview: function () { return preview; },
    isEditMode: function () { return mode === 'rich' || mode === 'source'; },
    /** 'rich' | 'source' | null —— 宿主据此避让（例如编辑态不要弹图片灯箱） */
    editKind: function () { return (mode === 'rich' || mode === 'source') ? mode : null; },
    setStatus: setStatus,
    /** 磁盘文本（已还原换行风格）。宿主自行管理 BOM 时用这个。 */
    textForDisk: textForDisk,
    /** 完整落盘载荷（换行风格 + BOM 一体） */
    payloadOf: payloadOf,
    /** 设置变更后重绘预览。编辑态不动：此时预览是隐藏的，切回预览时会自行重渲染 */
    rerender: function () {
      if (mode === 'preview') renderPreview();
      return mode;
    },
    /** 宿主（本地服务 / 自动刷新）替换某个标签的文本；meta 可带 bom */
    replaceText: function (key, text, meta) {
      for (var i = 0; i < openFiles.length; i++) {
        if (openFiles[i].key !== key) continue;
        var t = openFiles[i];
        var raw = stripBom(String(text == null ? '' : text));
        t.text = toLf(raw);
        t.openedText = t.text;
        t.openedRaw = raw;
        t.eol = analyzeEol(raw);
        if (meta && meta.bom !== undefined) t.bom = meta.bom === true;
        t.dirty = false;
        if (key === activeKey) {
          currentText = t.text;
          if (mode === 'preview') renderPreview();
        }
        return true;
      }
      return false;
    },
    /** 标签清单（只读快照），供宿主轮询磁盘变化时逐个比对 */
    listTabs: function () {
      return openFiles.map(function (t) {
        return { key: t.key, name: t.name, serverPath: t.serverPath, dirty: t.dirty };
      });
    },
    /** 渲染完成钩子：(ctx) => void，ctx = { preview, text, mode, version } */
    onRender: function (fn) { if (typeof fn === 'function') renderHooks.push(fn); },
    // 宿主设置保存实现：fn(tab) -> Promise<boolean>，返回 true 表示已保存成功
    setSaveHandler: function (fn) { externalSaveHandler = typeof fn === 'function' ? fn : null; }
  };

  // ---------- 语言切换时刷新文案 ----------
  document.addEventListener('md:lang', function () {
    if (mode === 'preview') {
      btnToggle.textContent = T('btn.edit');
    } else if (mode === 'rich' || mode === 'source') {
      btnToggle.textContent = T('btn.preview');
      if (btnSource) {
        btnSource.textContent = mode === 'source' ? T('btn.rich') : T('btn.source');
        btnSource.title = mode === 'source' ? T('btn.rich.tip') : T('btn.source.tip');
      }
    }
    if (mode === 'empty') setStatus(T('status.idle'));
    renderTabbar();
  });

  // ---------- 初始化 ----------
  // 必须等文档解析完成再启动：ui.js 在内核之后加载，它要先把渲染钩子挂上来，
  // 首次渲染（含 #demo）才能被大纲 / 复制按钮 / 公式这些装饰层接管。
  function bootstrap() {
    showMode('empty');
    if (location.hash === '#demo') {
      loadDemo();
    } else {
      setStatus(T('status.idle'));
      if (!FS_SUPPORTED) setStatus(T('status.noFs'));
    }
    if (window.console && console.info) {
      console.info('[md-tiny] v' + VERSION + ' · MDTN-F1 1.0 06 50 01 23 FE FC 80 D1 VDM');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
