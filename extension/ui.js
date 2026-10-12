// MDTN-A1 1.0 12823B20 I5zGySKrIY87wgqgql31SBUZaVRC6yMtrPjvUmJDxoHaFwVhCRSWQL2GEHTfszxWaYFg0SNqcuIux1GthKUKBQ
/* ============================================================================
 * MDTN-UI · 交互层
 * ----------------------------------------------------------------------------
 * 与编辑器内核（editor.js）解耦：内核在每次完成渲染后回调 onRender 钩子，
 * 本文件负责在其上叠加「界面装饰」，不改动内核的解析与保存逻辑。
 *
 * 职责：
 *   1. 主题切换（按钮 / Ctrl+Shift+L）
 *   2. 侧栏显示隐藏（按钮 / Ctrl+B）与「文件 / 大纲」分栏
 *   3. 界面语言切换（中 / 英）
 *   4. 大纲（TOC）生成与滚动高亮
 *   5. 代码块复制按钮
 *   6. 图片点击放大（灯箱）
 *   7. 数学公式按需加载（命中才拉 KaTeX，不命中零请求）
 *   8. 设置面板入口（扩展端打开选项页，其余环境打开内嵌弹层）
 *
 * 其中第 4–6 项是否生效由设置面板决定（preview.copy / preview.math /
 * preview.lightbox），本文件只负责"读设置、按设置做"，不持有默认值。
 * ========================================================================== */

(function () {
  'use strict';

  var T = function (k) {
    var rest = Array.prototype.slice.call(arguments, 1);
    return window.MDI18N ? window.MDI18N.t.apply(window.MDI18N, [k].concat(rest)) : k;
  };

  /** 读设置。settings 模块缺失时（例如被裁掉的老版本页面）回落到给定默认值 */
  function setting(key, fallback) {
    if (!window.MDSettings) return fallback;
    var v = window.MDSettings.get(key);
    return v === undefined ? fallback : v;
  }

  var preview = document.getElementById('preview');
  var sidebar = document.getElementById('sidebar');
  var tocBox = document.getElementById('toc');
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = lightbox ? lightbox.querySelector('img') : null;

  // ------------------------------------------------------------- 内核钩子

  function onRender(ctx) {
    if (setting('preview.copy', true)) decorateCodeBlocks(ctx.preview);
    buildToc(ctx.preview);
    if (setting('preview.math', true)) renderMath(ctx);
  }

  if (window.MDTiny && typeof window.MDTiny.onRender === 'function') {
    window.MDTiny.onRender(onRender);
  } else {
    // 内核晚于本文件加载时的兜底（正常不会走到）
    document.addEventListener('DOMContentLoaded', function () {
      if (window.MDTiny && window.MDTiny.onRender) window.MDTiny.onRender(onRender);
    });
  }

  // ------------------------------------------------------------- 1. 主题

  var btnTheme = document.getElementById('btn-theme');
  var THEME_ICON = { light: '☀', dark: '☾', auto: '◐' };

  function syncThemeButton() {
    if (!btnTheme || !window.MDTheme) return;
    var key = window.MDTheme.get();
    btnTheme.textContent = THEME_ICON[key] || '◐';
    btnTheme.setAttribute('title', T('btn.theme.tip') + ' — ' + T('theme.' + key));
  }

  function cycleTheme() {
    if (!window.MDTheme) return;
    var next = window.MDTheme.next();
    syncThemeButton();
    if (window.MDTiny && window.MDTiny.setStatus) {
      window.MDTiny.setStatus(T('status.theme', T('theme.' + next)));
    }
  }

  if (btnTheme) btnTheme.addEventListener('click', cycleTheme);
  syncThemeButton();

  // ------------------------------------------------------------- 2. 侧栏

  var btnSidebar = document.getElementById('btn-sidebar');
  var tabFiles = document.getElementById('side-tab-files');
  var tabOutline = document.getElementById('side-tab-outline');
  var paneFiles = document.getElementById('pane-files');
  var paneOutline = document.getElementById('pane-outline');

  function sidebarVisible() {
    return !!sidebar && sidebar.style.display !== 'none' && getComputedStyle(sidebar).display !== 'none';
  }

  function toggleSidebar() {
    if (!sidebar) return;
    sidebar.style.display = sidebarVisible() ? 'none' : 'flex';
    if (sidebarVisible()) refreshToc();
  }

  function switchPane(which) {
    var isFiles = which === 'files';
    if (tabFiles) tabFiles.classList.toggle('active', isFiles);
    if (tabOutline) tabOutline.classList.toggle('active', !isFiles);
    if (paneFiles) paneFiles.classList.toggle('active', isFiles);
    if (paneOutline) paneOutline.classList.toggle('active', !isFiles);
    if (!isFiles) refreshToc();
  }

  if (btnSidebar) btnSidebar.addEventListener('click', toggleSidebar);
  if (tabFiles) tabFiles.addEventListener('click', function () { switchPane('files'); });
  if (tabOutline) tabOutline.addEventListener('click', function () { switchPane('outline'); });

  // ------------------------------------------------------------- 3. 语言

  var btnLang = document.getElementById('btn-lang');

  function syncLangButton() {
    if (!btnLang || !window.MDI18N) return;
    btnLang.textContent = window.MDI18N.lang() === 'zh-CN' ? '中' : 'EN';
  }

  if (btnLang) {
    btnLang.addEventListener('click', function () {
      if (!window.MDI18N) return;
      window.MDI18N.toggle();
      syncLangButton();
      rebuildHints();
      syncThemeButton();
    });
  }
  syncLangButton();

  document.addEventListener('md:lang', function () {
    syncLangButton();
    rebuildHints();
    buildToc(preview);
  });

  // ------------------------------------------------------------- 4. 大纲

  var tocHeads = [];
  var tocButtons = [];
  var tocTimer = null;
  var activeTocIndex = -1;

  function buildToc(root) {
    if (!tocBox || !root) return;
    var heads = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    tocHeads = [];
    tocButtons = [];
    activeTocIndex = -1;
    tocBox.innerHTML = '';

    if (heads.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'tree-hint';
      empty.setAttribute('data-i18n', 'outline.empty');
      empty.textContent = T('outline.empty');
      tocBox.appendChild(empty);
      return;
    }

    for (var i = 0; i < heads.length; i++) {
      (function (h, idx) {
        if (!h.id) h.id = 'md-heading-' + idx;
        var level = Number(h.tagName.charAt(1)) || 1;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toc-item toc-l' + level;
        btn.textContent = (h.textContent || '').trim() || h.id;
        btn.title = btn.textContent;
        btn.addEventListener('click', function () { jumpTo(h); });
        tocBox.appendChild(btn);
        tocHeads.push(h);
        tocButtons.push(btn);
      })(heads[i], i);
    }
    updateActiveHeading();
  }

  function jumpTo(heading) {
    // 用 scrollTop 直接定位，避免 hashchange 触发浏览器的原生跳转
    var target = heading.offsetTop - 12;
    preview.scrollTop = Math.max(0, target);
    setActiveHeading(tocHeads.indexOf(heading));
  }

  function setActiveHeading(idx) {
    if (idx === activeTocIndex) return;
    activeTocIndex = idx;
    for (var i = 0; i < tocButtons.length; i++) {
      tocButtons[i].classList.toggle('active', i === idx);
    }
    if (idx >= 0 && tocButtons[idx] && !sidebarCollapsed()) {
      var btn = tocButtons[idx];
      var box = tocBox;
      if (box && (btn.offsetTop < box.scrollTop || btn.offsetTop + btn.offsetHeight > box.scrollTop + box.clientHeight)) {
        box.scrollTop = Math.max(0, btn.offsetTop - box.clientHeight / 2);
      }
    }
  }

  function sidebarCollapsed() {
    return !sidebar || sidebar.style.display === 'none';
  }

  function updateActiveHeading() {
    if (!tocHeads.length) return;
    var top = preview.scrollTop + 16;
    var idx = 0;
    for (var i = 0; i < tocHeads.length; i++) {
      if (tocHeads[i].offsetTop <= top) idx = i;
      else break;
    }
    setActiveHeading(idx);
  }

  if (preview) {
    preview.addEventListener('scroll', function () {
      if (tocTimer) return;
      tocTimer = setTimeout(function () {
        tocTimer = null;
        updateActiveHeading();
      }, 100);
    }, { passive: true });
  }

  function refreshToc() {
    if (tocHeads.length) updateActiveHeading();
  }

  // ------------------------------------------------------------- 5. 代码复制

  function decorateCodeBlocks(root) {
    if (!root) return;
    var pres = root.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      (function (pre) {
        if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('md-code-wrap')) return;
        var wrap = document.createElement('div');
        wrap.className = 'md-code-wrap';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-copy-btn';
        btn.textContent = T('copy.button');
        btn.setAttribute('aria-label', T('copy.button'));
        btn.addEventListener('click', function () {
          var code = pre.querySelector('code');
          copyText((code ? code.innerText : pre.innerText) || '').then(function (ok) {
            btn.textContent = ok ? T('copy.done') : T('copy.fail');
            btn.classList.toggle('done', ok);
            setTimeout(function () {
              btn.textContent = T('copy.button');
              btn.classList.remove('done');
            }, 1400);
            if (window.MDTiny && window.MDTiny.setStatus) {
              window.MDTiny.setStatus(ok ? T('status.copied') : T('status.copyFail'));
            }
          });
        });
        wrap.appendChild(btn);
      })(pres[i]);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------- 6. 图片灯箱

  function openLightbox(src, alt) {
    if (!lightbox || !lightboxImg) return;
    lightboxImg.setAttribute('src', src);
    lightboxImg.setAttribute('alt', alt || '');
    lightbox.classList.add('open');
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    if (lightboxImg) lightboxImg.removeAttribute('src');
  }

  if (preview) {
    preview.addEventListener('click', function (e) {
      var el = e.target;
      // 富文本编辑态里点图片是"把光标放过去"，不是放大看图
      if (window.MDTiny && window.MDTiny.editKind && window.MDTiny.editKind() === 'rich') return;
      if (el && el.tagName === 'IMG' && setting('preview.lightbox', true)) {
        e.preventDefault();
        openLightbox(el.getAttribute('src'), el.getAttribute('alt'));
      }
    });
  }

  if (lightbox) {
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox || e.target === lightboxImg) closeLightbox();
    });
  }

  // ------------------------------------------------------------- 7. 数学公式

  var KATEX_DIR = 'lib/katex/';
  var katexState = 0;      // 0 未加载 / 1 加载中 / 2 已就绪
  var katexPromise = null;

  // 保守探测：先剥掉代码块与行内代码，再找成对的数学定界符
  var MATH_RE = new RegExp([
    '\\$\\$[\\s\\S]+?\\$\\$',                                   // $$ ... $$
    '\\\\\\[[\\s\\S]+?\\\\\\]',                                 // \[ ... \]
    '\\\\\\([\\s\\S]+?\\\\\\)',                                 // \( ... \)
    '\\\\begin\\{(?:equation|align|alignat|gather|multline|cases|matrix|bmatrix|pmatrix|vmatrix|array)\\*?\\}',
    '(?:^|[^\\w\\\\$])\\$[^\\s$][^\\n$]*?[^\\s$\\\\]\\$(?!\\d)'  // $ ... $（排除 $100 这类金额）
  ].join('|'));

  function hasMath(text) {
    var s = String(text || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/~~~[\s\S]*?~~~/g, '')
      .replace(/`[^`\n]*`/g, '');
    MATH_RE.lastIndex = 0;
    return MATH_RE.test(s);
  }

  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      var old = document.querySelector('script[data-mded="' + src + '"]');
      if (old) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-mded', src);
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadStyleOnce(href) {
    if (document.querySelector('link[data-mded="' + href + '"]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.setAttribute('data-mded', href);
    document.head.appendChild(l);
  }

  function loadKatex() {
    if (katexState === 2) return Promise.resolve();
    if (katexPromise) return katexPromise;
    katexState = 1;
    loadStyleOnce(KATEX_DIR + 'katex.min.css');
    katexPromise = loadScriptOnce(KATEX_DIR + 'katex.min.js')
      .then(function () { return loadScriptOnce(KATEX_DIR + 'contrib/auto-render.min.js'); })
      .then(function () { katexState = 2; })
      .catch(function (err) {
        katexState = 0;
        katexPromise = null;
        console.warn('[katex] 加载失败', err);
      });
    return katexPromise;
  }

  function renderMath(ctx) {
    if (!ctx || !ctx.preview || !hasMath(ctx.text)) return;
    loadKatex().then(function () {
      if (typeof window.renderMathInElement !== 'function') return;
      try {
        window.renderMathInElement(ctx.preview, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false }
          ],
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
          throwOnError: false
        });
      } catch (e) {
        console.warn('[katex] 渲染失败', e);
      }
    });
  }

  // ------------------------------------------------------------- 8. 设置面板

  var btnSettings = document.getElementById('btn-settings');

  function openSettings() {
    // 扩展端有独立的选项页（空间更大，还能用右键菜单进入），优先用它
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
        return;
      }
    } catch (e) { /* 非扩展环境 */ }
    if (window.MDSettingsUI) window.MDSettingsUI.toggle();
  }

  if (btnSettings) btnSettings.addEventListener('click', openSettings);

  var settingsClose = document.getElementById('settings-close');
  if (settingsClose) {
    settingsClose.addEventListener('click', function () {
      if (window.MDSettingsUI) window.MDSettingsUI.close();
    });
  }

  var settingsModal = document.getElementById('settings-modal');
  if (settingsModal) {
    settingsModal.addEventListener('click', function (e) {
      if (e.target === settingsModal && window.MDSettingsUI) window.MDSettingsUI.close();
    });
  }

  // 影响渲染结果的设置变更后重绘预览，保证"关掉复制按钮"是立刻消失而不是下次渲染才生效
  document.addEventListener('md:settings', function (e) {
    var key = e.detail && e.detail.key;
    if (key !== '*' && key !== 'preview.copy' && key !== 'preview.math') return;
    if (window.MDTiny && window.MDTiny.rerender) window.MDTiny.rerender();
  });

  // ------------------------------------------------------------- 9. 快捷键

  document.addEventListener('keydown', function (e) {
    if (lightbox && lightbox.classList.contains('open') && e.key === 'Escape') {
      closeLightbox();
      return;
    }
    if (!e.ctrlKey || e.altKey) return;
    var k = (e.key || '').toLowerCase();

    if (e.shiftKey && k === 'l') {
      e.preventDefault();
      cycleTheme();
      return;
    }
    if (!e.shiftKey && k === 'b') {
      e.preventDefault();
      toggleSidebar();
      return;
    }
    if (!e.shiftKey && k === ',') {
      e.preventDefault();
      openSettings();
    }
  });

  // 全局快捷键（扩展）：Service Worker 收到命令后经 chrome.storage 投递过来。
  // Windows 本地启动版没有 chrome 对象，本段自动跳过。
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes['mded.cmd'] || !changes['mded.cmd'].newValue) return;
        var cmd = changes['mded.cmd'].newValue.cmd;
        if (cmd === 'toggle-theme') cycleTheme();
        else if (cmd === 'toggle-sidebar') toggleSidebar();
      });
    }
  } catch (e) { /* 非扩展环境 */ }


  // ------------------------------------------------------------- 初始化

  function rebuildHints() {
    var hints = document.querySelectorAll('.tree-hint[data-i18n]');
    for (var i = 0; i < hints.length; i++) {
      var k = hints[i].getAttribute('data-i18n');
      if (k) hints[i].textContent = T(k);
    }
    var btns = document.querySelectorAll('.md-copy-btn');
    for (var j = 0; j < btns.length; j++) {
      if (!btns[j].classList.contains('done')) btns[j].textContent = T('copy.button');
    }
  }

  if (window.MDI18N) window.MDI18N.apply(document);
  syncLangButton();
  syncThemeButton();
})();
