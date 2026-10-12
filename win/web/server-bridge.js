/**
 * md-tiny · 本地服务桥接层
 *
 * 仅在「本地服务模式」下生效：URL 带 ?token=（由 launcher.js 生成）。
 * 扩展环境下没有 token，本文件直接 return，不存在任何副作用。
 *
 * 职责：
 *   1. 收下 URL 里的 token 存进 sessionStorage，并从地址栏抹掉（不留在浏览历史）
 *   2. ?open=<绝对路径> —— 通过本地服务读取该文件并直接在编辑器中打开
 *   3. 接管 Ctrl+S 保存 —— 走 /api/file 原子写回原文件（含外部修改冲突提示）
 *      落盘文本由内核的 textForDisk(tab) 给出：换行风格按打开时的记录还原，
 *      BOM 则交给服务端补（读取时已记录），两端各管一段，不会重复写入
 *   4. ?dir=<目录> —— 侧栏列出该目录下的 Markdown 文档
 *   5. 自动刷新已打开文件 —— 由设置项 preview.autoReload 控制，默认关闭
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var openPath = params.get('open') || '';
  var dirPath = params.get('dir') || '';

  if (token) {
    try { sessionStorage.setItem('md-tiny-token', token); } catch (e) { /* ignore */ }
  } else {
    try { token = sessionStorage.getItem('md-tiny-token') || ''; } catch (e) { /* ignore */ }
  }

  // 抹掉地址栏参数，避免 token 与本地路径留在浏览历史里
  if (location.search) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
  }

  if (!token || !window.MDTiny) return; // 非本地服务模式

  var meta = Object.create(null); // serverPath(小写) -> { mtime, bom }

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers['X-MD-Token'] = token;
    opts.headers = headers;
    return fetch(path, opts).then(function (res) {
      var status = res.status;
      return res.text().then(function (t) {
        var body;
        try { body = JSON.parse(t); } catch (e) {
          body = { ok: false, error: 'HTTP ' + status + ' ' + String(t).slice(0, 160) };
        }
        body.__status = status;
        return body;
      });
    });
  }

  /**
   * 把服务端的失败翻译成用户能照着做的提示。
   *
   * 403 是最容易让人一头雾水的一种：页面明明加载出来了（静态资源不需要 Token），
   * 文件却打不开、是空的 —— 因为端口上那个服务属于「另一份副本」，
   * 它不认我们手上这个 Token。历史故障现场就是它。
   */
  function whyFailed(r) {
    var msg = r.error || '未知错误';
    if (r.__status === 403) {
      return '服务令牌不匹配 —— 端口上的服务可能来自另一个副本（安装目录），' +
             '请先关掉那个服务，或重新运行本目录的「安装.cmd」后再双击文件';
    }
    if (r.__status) msg += '（HTTP ' + r.__status + '）';
    return msg;
  }

  function openFromServer(absPath) {
    window.MDTiny.setStatus('读取中：' + absPath);
    return api('/api/file?path=' + encodeURIComponent(absPath)).then(function (r) {
      if (!r.ok) { window.MDTiny.setStatus('打开失败：' + whyFailed(r)); return; }
      meta[String(r.path).toLowerCase()] = { mtime: r.mtime, bom: !!r.bom };
      window.MDTiny.openText({
        name: r.name, path: r.path, serverPath: r.path, text: r.text, bom: !!r.bom
      });
      window.MDTiny.setStatus('已打开：' + r.name);
    }).catch(function (e) {
      window.MDTiny.setStatus('打开失败：' + e.message);
    });
  }

  // ---------------- 接管保存 ----------------
  // 只接管「有磁盘绝对路径」的文档：本接口按路径寻址，没有路径就无从写起。
  // 内核对没有 serverPath 的文档（例如用「打开」按钮选中的，只有 FileSystemFileHandle）
  // 已不再交给这里，而是回落到 File System Access API 自己写回；下面的分支只是防御性的，
  // 保证即使被调到也一定留下提示，不会静默失败。
  window.MDTiny.setSaveHandler(function (tab) {
    var p = tab.serverPath;
    if (!p) {
      window.MDTiny.setStatus('无法写回：' + tab.name + '（该文档没有磁盘路径）');
      return Promise.resolve(false);
    }
    var key = String(p).toLowerCase();

    function doSave(baseMtime) {
      // 落盘文本要还原换行风格（textarea / contenteditable 一律把 CRLF 归一化成 LF）；
      // BOM 由服务端按读取时的记录补回，两边各管一段、不重复加
      var payload = (window.MDTiny.textForDisk ? window.MDTiny.textForDisk(tab) : tab.text);
      return api('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: p,
          text: payload,
          bom: !!(meta[key] || {}).bom,
          baseMtime: baseMtime || 0
        })
      }).then(function (r) {
        if (r.ok) {
          meta[key] = { mtime: r.mtime, bom: (meta[key] || {}).bom };
          window.MDTiny.setStatus('已保存：' + tab.name);
          return true;
        }
        if (r.code === 'CONFLICT') {
          var overwrite = window.confirm('「' + tab.name + '」已被其他程序修改。\n\n用当前编辑器中的内容覆盖磁盘上的版本吗？');
          if (overwrite) return doSave(0);
          window.MDTiny.setStatus('已取消保存（磁盘上的是较新版本）');
          return false;
        }
        window.MDTiny.setStatus('保存失败：' + whyFailed(r));
        return false;
      }).catch(function (e) {
        window.MDTiny.setStatus('保存失败：' + e.message);
        return false;
      });
    }

    return doSave((meta[key] || {}).mtime);
  });

  // ---------------- 侧栏文件树 ----------------
  function loadTree(dir) {
    return api('/api/list?dir=' + encodeURIComponent(dir)).then(function (r) {
      if (!r.ok) return;
      var sidebar = document.getElementById('sidebar');
      var tree = document.getElementById('file-tree');
      if (!sidebar || !tree) return;
      sidebar.style.display = 'flex';
      tree.innerHTML = '';

      if (!r.files || !r.files.length) {
        var hint = document.createElement('div');
        hint.className = 'tree-hint';
        hint.textContent = '该目录下没有 Markdown 文档';
        tree.appendChild(hint);
        return;
      }

      var head = document.createElement('div');
      head.className = 'tree-hint';
      head.textContent = r.files.length + ' 个文档 · ' + r.dir;
      tree.appendChild(head);

      r.files.forEach(function (f) {
        var el = document.createElement('div');
        el.className = 'tree-item';
        el.textContent = f.rel;
        el.title = f.path;
        el.addEventListener('click', function () { openFromServer(f.path); });
        tree.appendChild(el);
      });
    });
  }

  // ---------------- 工具栏标识 ----------------
  function addBadge() {
    var bar = document.getElementById('toolbar');
    if (!bar || document.getElementById('server-badge')) return;
    var b = document.createElement('span');
    b.id = 'server-badge';
    b.textContent = '本地服务模式';
    b.title = '当前页面由本地服务提供，保存会直接写回原文件';
    b.style.cssText = 'font-size:12px;color:#0F7B3F;background:#E8F7EE;border:1px solid #BFE7CF;' +
      'border-radius:999px;padding:3px 10px;white-space:nowrap;flex-shrink:0;';
    bar.appendChild(b);
  }

  addBadge();

  // ---------------- 自动刷新（设置项 preview.autoReload，默认关闭） ----------------
  // 只在本地服务模式下有意义：磁盘上的文件被别的程序改了，编辑器跟着更新。
  // 刻意不做"每像素轮询"：5 秒一次 + 窗口获得焦点时补一次，足够且安静。
  // 当前标签有未保存内容时**绝不覆盖**，只提示，避免把用户正在写的东西冲掉。
  var AUTO_MS = 5000;
  var autoTimer = null;

  function autoOn() {
    return !!(window.MDSettings && window.MDSettings.get('preview.autoReload'));
  }

  function checkOnce() {
    if (!autoOn() || !window.MDTiny || !window.MDTiny.listTabs) return;
    var tabs = window.MDTiny.listTabs();
    for (var i = 0; i < tabs.length; i++) {
      (function (tab) {
        var p = tab.serverPath;
        if (!p) return;
        var key = String(p).toLowerCase();
        api('/api/file?path=' + encodeURIComponent(p)).then(function (r) {
          if (!r.ok) return;
          var before = (meta[key] || {}).mtime;
          if (before === r.mtime) return;
          if (tab.dirty) {
            window.MDTiny.setStatus('「' + tab.name + '」已被外部修改，但当前有未保存内容，未自动刷新');
            return;
          }
          meta[key] = { mtime: r.mtime, bom: !!r.bom };
          window.MDTiny.replaceText(tab.key, r.text, { bom: !!r.bom });
          window.MDTiny.setStatus('已自动刷新：' + tab.name);
        }).catch(function () { /* 单次失败不打扰用户，下一轮再试 */ });
      })(tabs[i]);
    }
  }

  function syncAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (autoOn()) autoTimer = setInterval(checkOnce, AUTO_MS);
  }

  if (window.MDSettings) window.MDSettings.on(syncAuto);
  document.addEventListener('md:settings', function (e) {
    var k = e.detail && e.detail.key;
    if (k === '*' || k === 'preview.autoReload') syncAuto();
  });
  window.addEventListener('focus', function () { if (autoOn()) checkOnce(); });
  syncAuto();

  if (openPath) openFromServer(openPath);
  if (dirPath) loadTree(dirPath);
})();
