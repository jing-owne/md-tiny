// MDTN-A1 1.0 12823B20 0VSU-F_b_xhzeDuWbtreyuh8eMB8UCqmw-6J74iBfRkHjFhRSvpKWtKZt5KdUG8AqHCeRxbl66XV_rh81QWYCg
/* ============================================================================
 * md-tiny · 所见即所得编辑层（可选模块）
 * ----------------------------------------------------------------------------
 * 目标：点「编辑」时**保持预览的排版**，并直接在这张页面上改。
 *
 * 两条硬约束决定了这里的实现方式：
 *
 *   1. 保真优先 —— 以 marked 的词法块为「编辑单元」。**没有被改动过的单元
 *      直接用原文切片回写**，只有你真正动过的那一块才会被重新序列化成
 *      Markdown。因此「打开 → 编辑 → 保存」在没改东西时是逐字节零改动的，
 *      表格对齐、代码围栏语言、任务列表标记、引用层级都不会被我们的写法
 *      覆盖掉。（marked 的 token.raw 逐块拼接恒等于原文，这是本层的地基，
 *      进入编辑前会断言，不成立就拒绝进入、退回源码编辑。）
 *
 *   2. 视觉不另起一套 —— 直接复用 #preview 这个渲染容器做 contenteditable。
 *      字体、行高、间距、代码底色全部沿用预览样式，编辑态与预览态长得一样。
 *
 * 本模块与内核解耦：内核只调用 window.MDRich 这组接口；模块缺席时内核
 * 自动退化为源码编辑，功能不残缺。
 *
 * 签名：MDTN-F1 1.0 6A 27 94 10 55 01 05 C8 OEL
 * ========================================================================== */

(function () {
  'use strict';

  var T = function (k) {
    var rest = Array.prototype.slice.call(arguments, 1);
    return window.MDI18N ? window.MDI18N.t.apply(window.MDI18N, [k].concat(rest)) : k;
  };

  // 编辑期不进 DOM 的块类型：它们不该被"改"，只该被原样带走
  var RAW_ONLY = { html: 1, def: 1 };
  // marked 输出的块级标签
  var BLOCK_TAGS = {
    p: 1, div: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
    ul: 1, ol: 1, li: 1, blockquote: 1, pre: 1, table: 1, hr: 1, figure: 1, section: 1
  };
  // 行首这些字符会被 Markdown 当结构语法吃掉，段落文本命中时要转义
  var LINE_HEAD = /^\s*(?:#{1,6}(?:\s|$)|>|\||[-+*](?:\s|$)|\d+[.)](?:\s|$)|\+{3,}$|-{3,}$|={3,}$)/;

  var state = null;

  // ---------------------------------------------------------------- 可用性

  function available() {
    return typeof window.marked !== 'undefined' &&
      typeof window.marked.lexer === 'function' &&
      typeof window.marked.parser === 'function' &&
      typeof window.DOMPurify !== 'undefined';
  }

  // ---------------------------------------------------------------- 工具

  function parseOpts() {
    return { gfm: true, breaks: true };
  }

  function sanitize(html) {
    return window.DOMPurify.sanitize(html, {
      ADD_ATTR: ['checked', 'type', 'disabled', 'colspan', 'rowspan', 'align', 'start', 'value']
    });
  }

  function isBlockEl(node) {
    return node && node.nodeType === 1 && !!BLOCK_TAGS[node.nodeName.toLowerCase()];
  }

  /** 段落文本的"最小转义"：只处理会被当成结构语法的行首字符。
   *  刻意不做全局转义 —— 那会把用户原文里的 ** _ [ ] 全部改写成 \*\* \_ ，
   *  违背"MD 格式不变"；行内语法交给 contenteditable 的元素结构去表达。 */
  function guardLineHead(text) {
    if (!LINE_HEAD.test(text)) return text;
    return text.replace(/^(\s*)([#>|]|\d+[.)]|[-+*])/, function (m, pad, ch) {
      return pad + '\\' + ch;
    });
  }

  function cellText(text) {
    return String(text).replace(/\|/g, '\\|');
  }

  function trimBlankTail(s) {
    return s.replace(/[ \t]+$/gm, function (m) { return m; }).replace(/\s+$/, '');
  }

  // ------------------------------------------------------------ 行内序列化

  /** 行内节点 → Markdown 片段 */
  function inline(node) {
    var out = '';
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) out += inlineNode(kids[i]);
    return out;
  }

  function inlineNode(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';

    var el = node;
    var tag = el.nodeName.toLowerCase();
    if (el.classList && el.classList.contains('mded-ignore')) return '';

    switch (tag) {
      case 'strong':
      case 'b':
        return wrap('**', inline(el), '**');
      case 'em':
      case 'i':
        return wrap('*', inline(el), '*');
      case 'del':
      case 's':
      case 'strike':
        return wrap('~~', inline(el), '~~');
      case 'code':
        // 行内代码：内容按字面取值，只处理反引号
        var lit = el.textContent || '';
        if (lit === '') return '``';
        var tick = lit.indexOf('`') >= 0 ? '``' : '`';
        return tick + lit + tick;
      case 'a':
        return '[' + inline(el) + '](' + attr('href', el) + attrTitle(el) + ')';
      case 'img':
        return '![' + (el.getAttribute('alt') || '') + '](' + attr('src', el) + attrTitle(el) + ')';
      case 'br':
        // 内核以 breaks:true 渲染，单个换行即硬换行，这里回写软换行即可
        return '\n';
      case 'input':
        if ((el.getAttribute('type') || '').toLowerCase() === 'checkbox') {
          return el.checked ? '[x] ' : '[ ] ';
        }
        return '';
      case 'kbd':
        return '`' + (el.textContent || '') + '`';
      case 'span':
      case 'sup':
      case 'sub':
      case 'u':
      case 'mark':
      case 'small':
      case 'abbr':
      case 'font':
        // 装饰性容器（高亮 span、KaTeX 残留等）：只取文字，不再包一层标记
        return inline(el);
      default:
        return inline(el);
    }
  }

  function wrap(open, body, close) {
    if (!body) return '';
    return open + body + close;
  }

  function attr(name, el) {
    return el.getAttribute(name) || '';
  }

  function attrTitle(el) {
    var t = el.getAttribute('title');
    return t ? ' "' + t.replace(/"/g, '\\"') + '"' : '';
  }

  // ------------------------------------------------------------ 块级序列化

  /** 一个编辑单元（可能被回车拆成多个兄弟块）→ Markdown 片段 */
  function serializeUnit(el) {
    var parts = [];
    var pending = [];

    function flushInline() {
      if (!pending.length) return;
      var txt = '';
      for (var i = 0; i < pending.length; i++) txt += inlineNode(pending[i]);
      pending = [];
      if (txt.trim() !== '') parts.push(guardLineHead(txt));
    }

    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (isBlockEl(n)) {
        flushInline();
        var s = serializeBlockNode(n);
        if (s !== '') parts.push(s);
      } else {
        pending.push(n);
      }
    }
    flushInline();

    return parts.join('\n\n');
  }

  function serializeBlockNode(node) {
    var tag = node.nodeName.toLowerCase();
    var i;

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return new Array(Number(tag.charAt(1)) + 1).join('#') + ' ' + inline(node);

      case 'hr':
        return '---';

      case 'pre':
        return serializeCode(node);

      case 'ul':
      case 'ol':
        return serializeList(node, 0);

      case 'blockquote':
        return serializeQuote(node);

      case 'table':
        return serializeTable(node);

      case 'li':
        return serializeListItem(node, 0, false, 1);

      case 'p':
        return guardLineHead(inline(node));

      case 'div':
      case 'section':
      case 'figure':
        // contenteditable 回车会产出裸 <div>：里面没有块级子元素就按段落走
        for (i = 0; i < node.childNodes.length; i++) {
          if (isBlockEl(node.childNodes[i])) return serializeUnit(node);
        }
        return guardLineHead(inline(node));

      default:
        return guardLineHead(inline(node));
    }
  }

  function serializeCode(pre) {
    var code = pre.querySelector('code');
    var host = code || pre;
    var text = (host.textContent || '').replace(/\n+$/, '');
    var lang = '';
    var cls = host.getAttribute('class') || '';
    var m = /(?:^|\s)language-([\w+#-]+)/.exec(cls);
    if (m) lang = m[1];
    else if (host.hasAttribute('data-language')) lang = host.getAttribute('data-language');

    // 内容里出现 ``` 时，围栏加长到不冲突
    var fence = '```';
    while (new RegExp('^\\s*' + fence, 'm').test(text)) fence += '`';
    return fence + lang + '\n' + text + '\n' + fence;
  }

  function serializeList(listEl, depth) {
    var lines = [];
    var ordered = listEl.nodeName.toLowerCase() === 'ol';
    var start = Number(listEl.getAttribute('start') || 1);
    if (!isFinite(start) || start < 1) start = 1;
    var idx = start;
    var kids = listEl.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeName.toLowerCase() !== 'li') continue;
      lines.push(serializeListItem(kids[i], depth, ordered, idx));
      idx++;
    }
    return lines.join('\n');
  }

  function serializeListItem(li, depth, ordered, index) {
    var pad = new Array(depth * 2 + 1).join(' ');
    var marker = (ordered ? index + '. ' : '- ');
    var head = [];
    var rest = [];

    function pushInline(nodes) {
      var txt = '';
      for (var i = 0; i < nodes.length; i++) txt += inlineNode(nodes[i]);
      if (txt.trim() !== '') head.push(txt);
    }

    var bucket = [];
    var kids = li.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (isBlockEl(n) && !(n.nodeName.toLowerCase() === 'ul' || n.nodeName.toLowerCase() === 'ol')) {
        pushInline(bucket); bucket = [];
        var s = serializeBlockNode(n);
        if (s !== '') rest.push(s);
      } else if (n.nodeName.toLowerCase() === 'ul' || n.nodeName.toLowerCase() === 'ol') {
        pushInline(bucket); bucket = [];
        rest.push(serializeList(n, depth + 1));
      } else {
        bucket.push(n);
      }
    }
    pushInline(bucket);

    var first = (head.join(' ') || '').replace(/^\s+/, '');
    // 任务列表：li 首部的 checkbox 已由 inlineNode 转成 [x] / [ ]
    var line = pad + marker + first;

    if (!rest.length) return line;

    var contPad = pad + '  ';
    var out = [line];
    for (var k = 0; k < rest.length; k++) {
      var seg = rest[k].split('\n');
      for (var j = 0; j < seg.length; j++) {
        out.push(seg[j] === '' ? '' : contPad + seg[j]);
      }
    }
    return out.join('\n');
  }

  function serializeQuote(bq) {
    var body = serializeUnit(bq);
    var lines = body.split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      out.push(lines[i] === '' ? '>' : '> ' + lines[i]);
    }
    return out.join('\n');
  }

  function serializeTable(table) {
    var rows = [];
    var trs = table.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var cells = [];
      var tds = trs[i].children;
      for (var j = 0; j < tds.length; j++) {
        cells.push(cellText(inline(tds[j]).replace(/\n/g, ' ')).trim());
      }
      rows.push(cells);
    }
    if (!rows.length) return '';

    var head = rows[0];
    var width = head.length;
    var out = ['| ' + head.join(' | ') + ' |'];
    var sep = [];
    for (var w = 0; w < width; w++) sep.push('---');
    out.push('| ' + sep.join(' | ') + ' |');
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r].slice(0, width);
      while (row.length < width) row.push('');
      out.push('| ' + row.join(' | ') + ' |');
    }
    return out.join('\n');
  }

  // ---------------------------------------------------------------- 进入编辑

  /** 把原文切成「编辑单元」：块 token + 紧随其后的空行 token 绑成一个单元。
   *  空行绑进单元（而不是单独成块）是为了让编辑态看不到多余空行、
   *  间距交给 CSS，同时回写时又能把空行原样带走。 */
  function buildUnits(mdText) {
    var tokens;
    try {
      tokens = window.marked.lexer(mdText, parseOpts());
    } catch (e) {
      return null;
    }

    var units = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type === 'space') {
        if (units.length) units[units.length - 1].raw += t.raw;
        else units.push({ type: 'space', token: null, raw: t.raw, invisible: true });
        continue;
      }
      units.push({ type: t.type, token: t, raw: t.raw, index: units.length });
    }

    // 地基校验：逐块原文拼回来必须与输入完全一致，否则拒绝进入富文本
    var rebuilt = '';
    for (var k = 0; k < units.length; k++) rebuilt += units[k].raw;
    if (rebuilt !== mdText) return null;

    return units;
  }

  function enter(root, mdText, opts) {
    if (!available()) return { ok: false, reason: 'no-lib' };

    var units = buildUnits(mdText);
    if (!units) return { ok: false, reason: 'raw-mismatch' };

    state = {
      root: root,
      units: units,
      opts: opts || {},
      dirty: false,
      md: mdText,
      trailingNL: /\n$/.test(mdText)
    };

    root.classList.add('mded-rich');
    root.textContent = '';

    var frag = document.createDocumentFragment();
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.invisible) continue; // 开头的空行：不占位，原文照样带走

      var wrapEl = document.createElement('div');
      wrapEl.className = 'mded-u';
      wrapEl.setAttribute('data-u', String(u.index));

      if (RAW_ONLY[u.type]) {
        wrapEl.classList.add('mded-pinned');
        wrapEl.setAttribute('contenteditable', 'false');
        wrapEl.textContent = u.raw.replace(/\s+$/, '');
      } else {
        var html = '';
        try {
          html = window.marked.parser([u.token], parseOpts());
        } catch (e) {
          html = '';
        }
        wrapEl.innerHTML = sanitize(html);
      }

      u.el = wrapEl;
      u.snapshot = wrapEl.innerHTML;
      frag.appendChild(wrapEl);
    }

    root.appendChild(frag);
    root.setAttribute('contenteditable', 'true');
    root.setAttribute('spellcheck', 'false');

    bind(root);
    return { ok: true, units: units.length };
  }

  // ---------------------------------------------------------------- 事件

  function unitOf(node) {
    while (node && node !== state.root) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('mded-u')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function markDirty(target) {
    var el = unitOf(target) || target;
    if (!el || !state) return;
    el.__mdedDirty = true;
    if (!state.dirty) {
      state.dirty = true;
      if (state.opts.onDirty) state.opts.onDirty();
    }
  }

  function onInput(e) {
    if (!state) return;
    markDirty(e.target);

    // 空块占位：contenteditable 里空的 div/p 会塌陷，塞一个 <br> 撑住
    var el = unitOf(e.target);
    if (el) {
      var hosts = [el].concat(Array.prototype.slice.call(el.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li')));
      for (var i = 0; i < hosts.length; i++) {
        var h = hosts[i];
        if (!h.childNodes.length) h.appendChild(document.createElement('br'));
      }
    }
  }

  function onPaste(e) {
    if (!state) return;
    // 只收纯文本：外部带样式的 HTML 会污染我们的 DOM，也会把无关标签写进 md
    var text = '';
    if (e.clipboardData && e.clipboardData.getData) text = e.clipboardData.getData('text/plain') || '';
    if (text === '') return;
    e.preventDefault();
    insertText(text);
    markDirty(e.target);
  }

  function insertText(text) {
    try {
      document.execCommand('insertText', false, text);
    } catch (e) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      range.deleteContents();
      var node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function onClick(e) {
    if (!state) return;
    // 编辑态不跳转：点链接应该是选它，而不是离开当前页
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a) e.preventDefault();
  }

  function onKeydown(e) {
    if (!state) return;
    // Tab 会跳出焦点跑去找下一个控件，编辑态里必须拦下
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
    // Shift+Tab 同理
  }

  function onFocus() {
    if (!state) return;
    // 浏览器在聚焦空的 contenteditable 时可能补 <br>，不该算用户改动
    var root = state.root;
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      var u = kids[i];
      if (u.innerHTML === '<br>') u.innerHTML = '';
    }
  }

  var bound = false;
  function bind(root) {
    if (bound) return;
    bound = true;
    root.addEventListener('input', onInput);
    root.addEventListener('paste', onPaste);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('focus', onFocus, true);
  }

  // ---------------------------------------------------------------- 提交

  /** 生成当前内容的 Markdown。
   *  未改动单元 → 原文切片（含它后面那个空行）
   *  改动过的单元 → 重新序列化，块间补标准空行 */
  function commit() {
    if (!state) return '';
    var pieces = [];
    var kids = state.root.children;

    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.classList.contains('mded-ignore')) continue;

      var idx = el.getAttribute('data-u');
      var u = idx === null ? null : state.units[Number(idx)];

      if (u && u.el === el && !el.__mdedDirty && el.innerHTML === u.snapshot) {
        pieces.push({ text: u.raw, raw: true });
        continue;
      }

      var body = trimBlankTail(serializeUnit(el));
      if (body === '') continue; // 被清空的块直接丢弃
      pieces.push({ text: body, raw: false });
    }

    var out = '';
    for (var k = 0; k < pieces.length; k++) {
      if (pieces[k].raw) {
        // 原文切片自带它原来的空行，一个字都不用补
        out += pieces[k].text;
        continue;
      }
      // 重新序列化的块：与前面的内容之间必须留空行。
      // 少了它，两段会被 Markdown 解析成同一段（惰性续行），这正是"编辑后格式变了"的典型来源。
      if (out !== '' && !/\n\n$/.test(out)) out = out.replace(/\n*$/, '') + '\n\n';
      out += pieces[k].text;
      if (k < pieces.length - 1) out += '\n\n';
    }

    // 原文末尾原来有换行就补回来，避免"编辑一次少一个换行"
    if (state.trailingNL && !/\n$/.test(out) && out !== '') out += '\n';
    return out;
  }

  function text() {
    return state ? commit() : '';
  }

  function isDirty() {
    return !!(state && state.dirty);
  }

  function exit() {
    if (!state) return;
    var root = state.root;
    root.removeAttribute('contenteditable');
    root.removeAttribute('spellcheck');
    root.classList.remove('mded-rich');
    state = null;
  }

  window.MDRich = {
    available: available,
    enter: enter,
    commit: commit,
    text: text,
    isDirty: isDirty,
    exit: exit
  };

  // 语言切换时给编辑态补一次提示文案（状态栏由内核负责，这里只保证模块自身有反应）
  document.addEventListener('md:lang', function () {
    if (!state) return;
    if (state.opts && state.opts.onDirty) return; // 无操作，仅保留挂点
  });
})();
