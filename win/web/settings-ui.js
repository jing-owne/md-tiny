// MDTN-A1 1.0 12823B20 35Lx6U7kWYWHfQ3EZD9VuEN9r22QcNISUcGszHc7sZpFEwxQgEVE2fOCxc22uFlEQfZ3tb8Zt9f5obmqVKKDBg
/* ============================================================================
 * MDTN-SETTINGS-UI · 设置面板
 * ----------------------------------------------------------------------------
 * 面板的所有内容都由 settings.js 的 SCHEMA 现场渲染出来 —— 这里没有一条写死的
 * 设置项。加一个设置只需要改 SCHEMA，面板与两端宿主都会自动跟上。
 *
 * 两种宿主形态共用本文件：
 *   · 扩展选项页 —— render(document.getElementById('settings-root'))
 *   · 编辑器内弹层 —— 同一个 render()，外面套一层 #settings-modal 遮罩
 *
 * 交互约定：
 *   · 开关 / 分段控件 / 下拉：点一下即时生效
 *   · 滑杆：拖动时只做视觉预览，松手（change）才落盘，避免每像素写一次存储
 * ========================================================================== */

(function () {
  'use strict';

  var S = window.MDSettings;
  if (!S) {
    if (window.console) console.warn('[settings-ui] MDSettings 未加载，面板不可用');
    return;
  }

  function T(key) {
    var rest = Array.prototype.slice.call(arguments, 1);
    return window.MDI18N ? window.MDI18N.t.apply(window.MDI18N, [key].concat(rest)) : key;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var rootEl = null;     // 面板挂载点
  var activeGroup = null;
  var noteEl = null;
  var noteTimer = null;
  // 控件注册表：[{ node, sync }]。外部变更后只需逐个 sync()，
  // 不用在 DOM 上反查"我是哪一个设置项"——那种做法顺序一错就静默失效。
  var controls = [];

  function register(node, sync) {
    controls.push({ node: node, sync: sync });
    return node;
  }

  // ---------------------------------------------------------------- 提示行

  function note(msg, kind) {
    if (!noteEl) return;
    noteEl.textContent = msg;
    noteEl.className = 'set-note' + (kind ? ' ' + kind : '');
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () {
      noteEl.textContent = T('set.saved');
      noteEl.className = 'set-note';
    }, 2600);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }

  // ---------------------------------------------------------------- 单项渲染

  function valueText(item, v) {
    if (item.type === 'range') {
      if (item.zeroLabel && Number(v) === 0) return T(item.zeroLabel);
      return String(v) + (item.unit || '');
    }
    if (item.type === 'enum') {
      for (var j = 0; j < item.options.length; j++) {
        if (String(item.options[j].value) === String(v)) return T(item.options[j].label);
      }
    }
    return String(v);
  }

  function renderSwitch(item) {
    var btn = el('button', 'set-switch');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');

    function sync() {
      var on = !!S.get(item.key);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.title = on ? T('set.off') : T('set.on');
    }

    btn.addEventListener('click', function () {
      S.set(item.key, !S.get(item.key));
      sync();
      note(T('set.applied', T(item.label)));
    });
    sync();
    return register(btn, sync);
  }

  function renderSegment(item) {
    var wrap = el('div', 'set-seg');
    var btns = [];

    function sync() {
      var cur = String(S.get(item.key));
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('active', String(item.options[j].value) === cur);
      }
    }

    item.options.forEach(function (opt) {
      var b = el('button', 'set-seg-item', T(opt.label));
      b.type = 'button';
      b.addEventListener('click', function () {
        S.set(item.key, opt.value);
        sync();
        note(T('set.applied', T(item.label)));
      });
      btns.push(b);
      wrap.appendChild(b);
    });

    sync();
    return register(wrap, sync);
  }

  function renderRange(item) {
    var box = el('div', 'set-range');
    var head = el('div', 'set-range-head');
    head.appendChild(el('span', 'set-label', T(item.label)));
    var val = el('span', 'set-value', valueText(item, S.get(item.key)));
    head.appendChild(val);
    box.appendChild(head);

    if (item.hint) box.appendChild(el('div', 'set-hint', T(item.hint)));

    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(item.min);
    input.max = String(item.max);
    input.step = String(item.step);
    input.value = String(S.get(item.key));
    input.setAttribute('aria-label', T(item.label));

    // 拖动中：只动 CSS 变量做视觉预览，不写存储
    input.addEventListener('input', function () {
      var v = Number(input.value);
      val.textContent = valueText(item, v);
      var r = document.documentElement;
      if (item.key === 'content.fontSize') r.style.setProperty('--md-content-font-size', v + 'px');
      else if (item.key === 'content.lineHeight') r.style.setProperty('--md-content-line-height', String(v));
      else if (item.key === 'content.width') {
        r.style.setProperty('--md-content-width', v + 'px');
        r.classList.toggle('md-width-limited', v > 0);
      } else if (item.key === 'editor.fontSize') r.style.setProperty('--md-tiny-font-size', v + 'px');
    });

    // 松手才落盘
    input.addEventListener('change', function () {
      S.set(item.key, input.value);
      val.textContent = valueText(item, S.get(item.key));
      note(T('set.applied', T(item.label)));
    });

    box.appendChild(input);
    register(box, function () {
      input.value = String(S.get(item.key));
      val.textContent = valueText(item, S.get(item.key));
    });
    return box;
  }

  function renderInfo(item) {
    var box = el('div', 'set-info');
    box.appendChild(el('span', 'set-label', T(item.label)));
    var v = typeof item.info === 'function' ? item.info() : '';
    var span = el('span', 'set-info-value', v);
    span.title = v;
    box.appendChild(span);
    register(box, function () {
      var next = typeof item.info === 'function' ? item.info() : '';
      span.textContent = next;
      span.title = next;
    });
    return box;
  }

  function renderAction(item) {
    var btn = el('button', 'set-action' + (item.danger ? ' danger' : ''), T(item.label));
    btn.type = 'button';
    if (item.hint) btn.title = T(item.hint);
    btn.addEventListener('click', function () { runAction(item.action); });
    return btn;
  }

  // ---------------------------------------------------------------- 动作

  function runAction(name) {
    if (name === 'reset') {
      if (!window.confirm(T('set.act.reset.confirm'))) return;
      S.reset();
      refresh();
      note(T('set.act.reset.done'), 'ok');
      return;
    }

    if (name === 'export') {
      var text = S.sealText(T('set.act.export.pass'), 3);
      copyText(text).then(function (ok) {
        if (ok) {
          note(T('set.act.export.done', S.fingerprint()), 'ok');
        } else {
          window.prompt(T('set.act.export.manual'), text);
          note(T('set.act.export.manual'), 'warn');
        }
      });
      return;
    }

    if (name === 'import') {
      var raw = window.prompt(T('set.act.import.prompt'), '');
      if (!raw) return;
      var pass = null;
      if (raw.trim().indexOf('MDTN-E1') === 0) {
        pass = window.prompt(T('set.act.import.pass'), '');
        if (pass == null) return;
      }
      var r = S.importText(raw, pass);
      if (!r.ok) {
        note(T('set.act.import.fail.' + r.error, r.error), 'warn');
        return;
      }
      refresh();
      note(T('set.act.import.done', r.applied,
        r.fingerprintOk === true ? T('set.fp.ok')
          : r.fingerprintOk === false ? T('set.fp.bad') : T('set.fp.na')), 'ok');
    }
  }

  // ---------------------------------------------------------------- 整体渲染

  function groupOf(id) {
    for (var j = 0; j < S.GROUPS.length; j++) {
      if (S.GROUPS[j].id === id) return S.GROUPS[j];
    }
    return null;
  }

  function itemsOf(id) {
    var out = [];
    for (var j = 0; j < S.SCHEMA.length; j++) {
      if (S.SCHEMA[j].group === id) out.push(S.SCHEMA[j]);
    }
    return out;
  }

  function build() {
    rootEl.innerHTML = '';
    controls = [];

    var shell = el('div', 'set-shell');

    // ---- 左侧导航 ----
    var nav = el('nav', 'set-nav');
    S.GROUPS.forEach(function (g) {
      var b = el('button', 'set-nav-item', T(g.label));
      b.type = 'button';
      b.setAttribute('data-group', g.id);
      b.addEventListener('click', function () { show(g.id); });
      nav.appendChild(b);
    });
    shell.appendChild(nav);

    // ---- 右侧内容 ----
    var body = el('div', 'set-body');
    S.GROUPS.forEach(function (g) {
      var sec = el('section', 'set-sec');
      sec.setAttribute('data-group', g.id);

      var items = itemsOf(g.id);
      var acts = [];

      items.forEach(function (item) {
        if (item.type === 'action') { acts.push(item); return; }
        var row;
        if (item.type === 'info') {
          row = renderInfo(item);
        } else if (item.type === 'bool') {
          row = el('div', 'set-row');
          var txt = el('div', 'set-text');
          txt.appendChild(el('div', 'set-label', T(item.label)));
          if (item.hint) txt.appendChild(el('div', 'set-hint', T(item.hint)));
          row.appendChild(txt);
          row.appendChild(renderSwitch(item));
        } else if (item.type === 'enum') {
          row = el('div', 'set-row');
          var t2 = el('div', 'set-text');
          t2.appendChild(el('div', 'set-label', T(item.label)));
          if (item.hint) t2.appendChild(el('div', 'set-hint', T(item.hint)));
          row.appendChild(t2);
          row.appendChild(renderSegment(item));
        } else {
          row = renderRange(item);
        }
        sec.appendChild(row);
      });

      if (acts.length) {
        var bar = el('div', 'set-actions');
        acts.forEach(function (a) { bar.appendChild(renderAction(a)); });
        sec.appendChild(bar);
      }

      body.appendChild(sec);
    });
    shell.appendChild(body);

    // ---- 底部状态行 ----
    var foot = el('div', 'set-foot');
    noteEl = el('span', 'set-note', T('set.saved'));
    foot.appendChild(noteEl);
    shell.appendChild(foot);

    rootEl.appendChild(shell);
  }

  function show(id) {
    if (!rootEl) return;
    activeGroup = id || (S.GROUPS[0] && S.GROUPS[0].id);
    var navItems = rootEl.querySelectorAll('.set-nav-item');
    for (var j = 0; j < navItems.length; j++) {
      navItems[j].classList.toggle('active', navItems[j].getAttribute('data-group') === activeGroup);
    }
    var secs = rootEl.querySelectorAll('.set-sec');
    for (var k = 0; k < secs.length; k++) {
      secs[k].classList.toggle('active', secs[k].getAttribute('data-group') === activeGroup);
    }
  }

  /** 外部变更（其它文档改了 / 导入了 / 恢复默认）后把控件值拉回最新 */
  function refresh() {
    if (!rootEl) return;
    for (var j = 0; j < controls.length; j++) {
      var c = controls[j];
      if (!c.node || !c.node.isConnected) continue;
      try { c.sync(); } catch (e) { console.warn('[settings-ui] 同步控件失败', e); }
    }
  }

  function render(target, opts) {
    rootEl = typeof target === 'string' ? document.getElementById(target) : target;
    if (!rootEl) return;
    if (window.MDI18N) window.MDI18N.apply(rootEl);
    build();
    show((opts && opts.group) || activeGroup);
    if (!rootEl.__wired) {
      rootEl.__wired = true;
      S.on(function () { refresh(); });
      document.addEventListener('md:lang', function () {
        if (window.MDI18N) window.MDI18N.apply(rootEl);
        build();
        show(activeGroup);
      });
    }
  }

  // ---------------------------------------------------------------- 弹层

  function modal() { return document.getElementById('settings-modal'); }

  function open() {
    var m = modal();
    if (!m) return false;
    if (!rootEl) render(document.getElementById('settings-root') || m);
    m.classList.add('open');
    var first = m.querySelector('.set-nav-item');
    if (first) first.focus();
    return true;
  }

  function close() {
    var m = modal();
    if (m) m.classList.remove('open');
  }

  function toggle() {
    var m = modal();
    if (!m) return false;
    if (m.classList.contains('open')) { close(); return true; }
    return open();
  }

  function isOpen() {
    var m = modal();
    return !!m && m.classList.contains('open');
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) close();
  });

  window.MDSettingsUI = {
    render: render,
    refresh: refresh,
    show: show,
    note: note,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen
  };
})();
