// MDTN-A1 1.0 12823B20 WNV0-jEeIS7p_gpx09JWjFJi7Sflghy5KhykhlI0-jpJ5Eus8psJXEUj6yy7EjyOiMKIXoYK2G_XEnU94N7nBA
/* ============================================================================
 * MDTN-I18N · 轻量国际化
 * ----------------------------------------------------------------------------
 * 支持语言：zh-CN（简体中文）、en（English）。
 * 其他语言一律回落到 en —— 本项目只维护这两种语言。
 *
 * 用法：
 *   MDI18N.t('btn.open')                       -> 取词
 *   MDI18N.t('status.folder', 12, 'docs')      -> 带 {0} {1} 占位
 *   MDI18N.apply(rootEl)                       -> 扫描 [data-i18n] 等属性并回填
 *   MDI18N.set('en')                           -> 手动切换（写入 localStorage 后广播）
 *
 * 广播：切换语言后会在 document 上派发 'md:lang' 事件，附带 { lang }。
 * ========================================================================== */

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MDI18N = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORE_KEY = 'mded.lang';

  var DICT = {
    'zh-CN': {
      'app.name': 'md-tiny',
      'app.badge.local': '本地服务模式',
      'app.badge.local.tip': '当前页面由本地服务提供，保存会直接写回原文件',

      'btn.open': '打开文件',
      'btn.open.tip': '打开单个 Markdown 文件',
      'btn.openFolder': '打开文件夹',
      'btn.openFolder.tip': '打开文件夹，浏览目录内所有文档',
      'btn.edit': '编辑',
      'btn.preview': '查看预览',
      'btn.toggle.tip': '在预览与编辑之间切换（编辑时保持排版）',
      'btn.source': '源码',
      'btn.source.tip': '切到 Markdown 源码编辑',
      'btn.rich': '所见即所得',
      'btn.rich.tip': '切回"保持排版"的编辑方式（推荐）',
      'btn.save': '保存',
      'btn.save.tip': 'Ctrl+S 保存到原文件',
      'btn.theme': '主题',
      'btn.theme.tip': '切换主题：亮色 / 暗色 / 跟随系统（Ctrl+Shift+L）',
      'btn.sidebar.tip': '显示或隐藏侧栏（Ctrl+B）',
      'btn.lang.tip': '切换界面语言（中文 / English）',
      'btn.settings.tip': '打开设置面板（Ctrl+,）',

      'tab.files': '文件',
      'tab.outline': '大纲',
      'outline.empty': '当前文档没有标题，无法生成大纲',
      'outline.hint': '打开文档后，此处列出全部标题，点击可跳转',

      'search.placeholder': '搜索当前文件夹内容…',

      'tree.hint': '打开文件夹后，此处列出目录内所有 .md 文档',
      'tree.empty': '该文件夹内没有 Markdown 文档',
      'tree.noMatch': '没有匹配的文件',
      'tree.searching': '正在搜索…',
      'tree.noHit': '未找到包含「{0}」的文档',
      'tree.hits': '找到 {0} 处匹配',
      'tree.line': '第{0}行 {1}',
      'tree.count': '{0} 个文档 · {1}',
      'tree.noDoc': '该目录下没有 Markdown 文档',

      'empty.title': 'md-tiny',
      'empty.sub': '「打开文件」选择单个 .md，或「打开文件夹」浏览整个目录',
      'empty.hint': '支持：标题 / 列表 / 表格 / 任务列表 / 代码高亮 / 数学公式 / 引用 / 链接 / 图片 · 多标签 / 全文搜索 / 大纲 / HTML 消毒',

      'status.idle': '未打开文件',
      'status.current': '当前：{0}{1}',
      'status.dirtySuffix': '（未保存）',
      'status.opened': '已打开：{0}',
      'status.openFail': '打开失败：{0}',
      'status.openFolder': '已打开文件夹：{0}（{1} 个文档）',
      'status.openFolderFail': '打开文件夹失败：{0}',
      'status.readFail': '读取失败：{0}',
      'status.fileReadFail': '读取文件失败',
      'status.openedAlt': '已打开：{0}（当前浏览器不支持写回原文件，保存将另存为新文件）',
      'status.editing': '编辑中：{0}（源码 · Ctrl+S 保存）',
      'status.richEditing': '编辑中：{0}（排版不变 · Ctrl+S 保存）',
      'status.richFallback': '{0}：排版编辑不可用，已切到源码（改动仍会原样保存）',
      'status.editingDirty': '编辑中：{0}（未保存 · Ctrl+S 保存）',
      'status.backPreview': '已回到预览：{0}',
      'status.allClosed': '已关闭全部文档',
      'status.saveFail': '保存失败：{0}',
      'status.saveUndone': '未保存：{0}（保存未完成，改动仍在编辑器里）',
      'status.saved': '已保存：{0}',
      'status.needOpen': '请先打开文件',
      'status.located': '定位到：{0} 第{1} 行',
      'status.conflictCancel': '已取消保存（磁盘上的是较新版本）',
      'status.demo': '示例模式：多标签 / 代码高亮 / 数学公式 / HTML 消毒（保存需另存）',
      'status.noFs': '当前浏览器不支持直接写回原文件，保存将另存为新文件（推荐 Chrome / Edge）',
      'status.noFolder': '当前浏览器不支持打开文件夹（推荐 Chrome / Edge）',
      'status.renderFail': '渲染出错：{0}',
      'status.markedMissing': 'marked 库未加载，无法渲染。',
      'status.reading': '读取中：{0}',
      'status.theme': '主题：{0}',
      'status.copied': '已复制到剪贴板',
      'status.copyFail': '复制失败，请手动选中复制',

      'confirm.closeDirty': '「{0}」有未保存的修改，确定关闭？',
      'confirm.overwrite': '「{0}」已被其他程序修改。\n\n用当前编辑器中的内容覆盖磁盘上的版本吗？',

      'theme.light': '亮色',
      'theme.dark': '暗色',
      'theme.auto': '跟随系统',

      'copy.button': '复制',
      'copy.done': '已复制',
      'copy.fail': '复制失败',
      'lightbox.close': '关闭（Esc）',

      'set.title': '设置',
      'set.close': '关闭设置',
      'set.saved': '改动即时生效，已自动保存',
      'set.applied': '已更新：{0}',
      'set.on': '点击关闭',
      'set.off': '点击开启',
      'set.group.appearance': '外观',
      'set.group.editor': '编辑器',
      'set.group.preview': '预览',
      'set.group.files': '文件与存储',
      'set.group.about': '高级',

      'set.theme.label': '主题',
      'set.theme.hint': '跟随系统时，操作系统切换深浅色会自动同步',
      'set.lang.label': '界面语言',
      'set.lang.hint': '除中文外的语言一律回落英文',
      'set.lang.opt.auto': '跟随浏览器',
      'set.lang.opt.zh': '简体中文',
      'set.lang.opt.en': 'English',
      'set.fontSize.label': '正文字号',
      'set.fontSize.hint': '标题按比例同步缩放，不只影响正文',
      'set.lineHeight.label': '正文行高',
      'set.lineHeight.hint': '中文长文档建议 1.6 – 1.8',
      'set.width.label': '阅读宽度',
      'set.width.hint': '限制正文最大宽度并居中，宽屏下更易读',
      'set.width.opt.unlimited': '不限',
      'set.motion.label': '界面动效',
      'set.motion.hint': '关闭后所有过渡动画立即完成',

      'set.edFontSize.label': '源码字号',
      'set.edFontSize.hint': '只影响编辑态，不影响预览',
      'set.tabSize.label': '缩进宽度',
      'set.tabSize.hint': '按 Tab 键插入的空格数',
      'set.tabSize.opt.2': '2 空格',
      'set.tabSize.opt.4': '4 空格',
      'set.spellcheck.label': '拼写检查',
      'set.spellcheck.hint': '中文文档下会误报，默认关闭',

      'set.copy.label': '代码块复制按钮',
      'set.copy.hint': '关闭后悬停代码块不再出现按钮',
      'set.math.label': '数学公式渲染',
      'set.math.hint': '开启也只在文档命中 $…$ 等定界符时才加载 KaTeX（约 550 KB）',
      'set.lightbox.label': '图片点击放大',
      'set.lightbox.hint': '点击正文图片进入灯箱，Esc 退出',
      'set.autoReload.label': '自动刷新已打开文件',
      'set.autoReload.hint': '文件被外部改动时提示重载；本地服务模式下生效',

      'set.confirmClose.label': '关闭未保存标签时确认',
      'set.confirmClose.hint': '关闭后直接丢弃改动，不弹确认',
      'set.warnUnload.label': '离开页面前提醒',
      'set.warnUnload.hint': '存在未保存改动时拦截关闭',
      'set.revealTree.label': '打开文件夹后展开侧栏',
      'set.revealTree.hint': '关闭后可自行用 Ctrl+B 唤出',

      'set.about.version': '版本',
      'set.about.flavor': '分发形态',
      'set.about.spec': '设置指纹',
      'set.about.store': '存储后端',

      'set.act.export': '导出设置',
      'set.act.export.hint': '导出为带指纹的文本，复制到剪贴板',
      'set.act.export.pass': 'mded-settings',
      'set.act.export.done': '已复制到剪贴板 · 指纹 {0}',
      'set.act.export.manual': '剪贴板不可用，请手动复制下面的内容',
      'set.act.import': '导入设置',
      'set.act.import.hint': '粘贴导出的文本，支持 MDTN-E1 密文',
      'set.act.import.prompt': '粘贴设置文本（MDTN-SET/1 或 MDTN-E1）',
      'set.act.import.pass': '该内容已封装，请输入口令',
      'set.act.import.done': '已导入 {0} 项设置 · 指纹校验：{1}',
      'set.act.import.fail.empty': '内容为空',
      'set.act.import.fail.sealed': '这是封装过的内容，需要口令',
      'set.act.import.fail.noSig': '签名模块未加载，无法解封装',
      'set.act.import.fail.badPass': '口令不正确或内容已损坏',
      'set.act.import.fail.badJson': '正文不是合法 JSON',
      'set.act.import.fail.badShape': '内容结构不正确',
      'set.act.import.fail.noKnownKey': '没有可识别的设置项',
      'set.fp.ok': '一致',
      'set.fp.bad': '不一致（内容被改动过）',
      'set.fp.na': '未提供',
      'set.act.reset': '恢复默认',
      'set.act.reset.hint': '把所有设置还原为出厂值',
      'set.act.reset.confirm': '确定把所有设置恢复为默认值吗？',
      'set.act.reset.done': '已恢复默认设置',

      'opt.title': 'Markdown 文件',
      'editor.placeholder': '在此输入 Markdown 源码…',
      'file.demo': '示例.md',
      'file.code': '代码高亮.md',
      'file.todo': '待办事项.md'
    },

    'en': {
      'app.name': 'md-tiny',
      'app.badge.local': 'Local Service',
      'app.badge.local.tip': 'Served by the local helper; saving writes straight back to the file',

      'btn.open': 'Open File',
      'btn.open.tip': 'Open a single Markdown file',
      'btn.openFolder': 'Open Folder',
      'btn.openFolder.tip': 'Open a folder and browse every document inside',
      'btn.edit': 'Edit',
      'btn.preview': 'Preview',
      'btn.toggle.tip': 'Switch between preview and editing (the layout stays put)',
      'btn.source': 'Source',
      'btn.source.tip': 'Edit the raw Markdown source',
      'btn.rich': 'Rich text',
      'btn.rich.tip': 'Go back to editing with the layout kept intact (recommended)',
      'btn.save': 'Save',
      'btn.save.tip': 'Ctrl+S writes back to the original file',
      'btn.theme': 'Theme',
      'btn.theme.tip': 'Theme: light / dark / follow system (Ctrl+Shift+L)',
      'btn.sidebar.tip': 'Show or hide the sidebar (Ctrl+B)',
      'btn.lang.tip': 'Switch interface language (中文 / English)',
      'btn.settings.tip': 'Open settings (Ctrl+,)',

      'tab.files': 'Files',
      'tab.outline': 'Outline',
      'outline.empty': 'This document has no headings, so there is no outline',
      'outline.hint': 'Open a document and its headings will appear here — click to jump',

      'search.placeholder': 'Search inside the current folder…',

      'tree.hint': 'Open a folder and every .md file inside will be listed here',
      'tree.empty': 'No Markdown document in this folder',
      'tree.noMatch': 'No matching file',
      'tree.searching': 'Searching…',
      'tree.noHit': 'No document contains "{0}"',
      'tree.hits': '{0} match(es) found',
      'tree.line': 'line {0} · {1}',
      'tree.count': '{0} document(s) · {1}',
      'tree.noDoc': 'No Markdown document in this folder',

      'empty.title': 'md-tiny',
      'empty.sub': 'Use "Open File" for a single .md, or "Open Folder" to browse a whole directory',
      'empty.hint': 'Supports: headings / lists / tables / task lists / code highlight / math / quotes / links / images · tabs / full-text search / outline / HTML sanitising',

      'status.idle': 'No file opened',
      'status.current': 'Current: {0}{1}',
      'status.dirtySuffix': ' (unsaved)',
      'status.opened': 'Opened: {0}',
      'status.openFail': 'Open failed: {0}',
      'status.openFolder': 'Folder opened: {0} ({1} document(s))',
      'status.openFolderFail': 'Opening the folder failed: {0}',
      'status.readFail': 'Read failed: {0}',
      'status.fileReadFail': 'Reading the file failed',
      'status.openedAlt': 'Opened: {0} (this browser cannot write back, saving will download a copy)',
      'status.editing': 'Editing: {0} (source · Ctrl+S to save)',
      'status.richEditing': 'Editing: {0} (layout kept · Ctrl+S to save)',
      'status.richFallback': '{0}: rich editing unavailable, switched to source — your edits are still saved as-is',
      'status.editingDirty': 'Editing: {0} (unsaved · Ctrl+S to save)',
      'status.backPreview': 'Back to preview: {0}',
      'status.allClosed': 'All documents closed',
      'status.saveFail': 'Save failed: {0}',
      'status.saveUndone': 'Not saved: {0} (save did not complete — your edits are still here)',
      'status.saved': 'Saved: {0}',
      'status.needOpen': 'Open a file first',
      'status.located': 'Jumped to {0}, line {1}',
      'status.conflictCancel': 'Save cancelled (the file on disk is newer)',
      'status.demo': 'Demo mode: tabs / code highlight / math / HTML sanitising (saving downloads a copy)',
      'status.noFs': 'This browser cannot write back to the original file; saving will download a copy (Chrome / Edge recommended)',
      'status.noFolder': 'This browser cannot open a folder (Chrome / Edge recommended)',
      'status.renderFail': 'Render failed: {0}',
      'status.markedMissing': 'The marked library is not loaded; rendering is unavailable.',
      'status.reading': 'Reading: {0}',
      'status.theme': 'Theme: {0}',
      'status.copied': 'Copied to clipboard',
      'status.copyFail': 'Copy failed — please select and copy manually',

      'confirm.closeDirty': '"{0}" has unsaved changes. Close it anyway?',
      'confirm.overwrite': '"{0}" was changed by another program.\n\nOverwrite the file on disk with the content in this editor?',

      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'theme.auto': 'Follow system',

      'copy.button': 'Copy',
      'copy.done': 'Copied',
      'copy.fail': 'Failed',
      'lightbox.close': 'Close (Esc)',

      'set.title': 'Settings',
      'set.close': 'Close settings',
      'set.saved': 'Changes apply instantly and are saved automatically',
      'set.applied': 'Updated: {0}',
      'set.on': 'Click to turn off',
      'set.off': 'Click to turn on',
      'set.group.appearance': 'Appearance',
      'set.group.editor': 'Editor',
      'set.group.preview': 'Preview',
      'set.group.files': 'Files & storage',
      'set.group.about': 'Advanced',

      'set.theme.label': 'Theme',
      'set.theme.hint': 'On "follow system", switching the OS light/dark mode syncs automatically',
      'set.lang.label': 'Interface language',
      'set.lang.hint': 'Every language other than Chinese falls back to English',
      'set.lang.opt.auto': 'Follow browser',
      'set.lang.opt.zh': '简体中文',
      'set.lang.opt.en': 'English',
      'set.fontSize.label': 'Body font size',
      'set.fontSize.hint': 'Headings scale with it — this is not body-only',
      'set.lineHeight.label': 'Body line height',
      'set.lineHeight.hint': '1.6 – 1.8 reads best for long Chinese text',
      'set.width.label': 'Reading width',
      'set.width.hint': 'Caps and centres the text column; far easier to read on wide screens',
      'set.width.opt.unlimited': 'Unlimited',
      'set.motion.label': 'Interface motion',
      'set.motion.hint': 'When off, every transition completes instantly',

      'set.edFontSize.label': 'Source font size',
      'set.edFontSize.hint': 'Affects editing mode only, not the preview',
      'set.tabSize.label': 'Indent width',
      'set.tabSize.hint': 'How many spaces the Tab key inserts',
      'set.tabSize.opt.2': '2 spaces',
      'set.tabSize.opt.4': '4 spaces',
      'set.spellcheck.label': 'Spell check',
      'set.spellcheck.hint': 'Noisy for Chinese text, so it is off by default',

      'set.copy.label': 'Copy button on code blocks',
      'set.copy.hint': 'When off, hovering a code block shows no button',
      'set.math.label': 'Math rendering',
      'set.math.hint': 'Even when on, KaTeX (~550 KB) loads only if the document contains $…$ delimiters',
      'set.lightbox.label': 'Click to zoom images',
      'set.lightbox.hint': 'Click a body image to open the lightbox; Esc closes it',
      'set.autoReload.label': 'Auto-refresh opened files',
      'set.autoReload.hint': 'Prompts to reload when the file changes on disk; local-service mode only',

      'set.confirmClose.label': 'Confirm closing unsaved tabs',
      'set.confirmClose.hint': 'When off, changes are discarded without asking',
      'set.warnUnload.label': 'Warn before leaving the page',
      'set.warnUnload.hint': 'Blocks closing while unsaved changes exist',
      'set.revealTree.label': 'Expand the sidebar after opening a folder',
      'set.revealTree.hint': 'When off, bring it back with Ctrl+B',

      'set.about.version': 'Version',
      'set.about.flavor': 'Distribution',
      'set.about.spec': 'Settings fingerprint',
      'set.about.store': 'Storage backend',

      'set.act.export': 'Export settings',
      'set.act.export.hint': 'Export fingerprinted text and copy it to the clipboard',
      'set.act.export.pass': 'mded-settings',
      'set.act.export.done': 'Copied to clipboard · fingerprint {0}',
      'set.act.export.manual': 'Clipboard unavailable — copy the text below manually',
      'set.act.import': 'Import settings',
      'set.act.import.hint': 'Paste exported text; MDTN-E1 sealed text is supported',
      'set.act.import.prompt': 'Paste the settings text (MDTN-SET/1 or MDTN-E1)',
      'set.act.import.pass': 'This content is sealed — enter the passphrase',
      'set.act.import.done': 'Imported {0} setting(s) · fingerprint: {1}',
      'set.act.import.fail.empty': 'The content is empty',
      'set.act.import.fail.sealed': 'This content is sealed and needs a passphrase',
      'set.act.import.fail.noSig': 'The signature module is not loaded, cannot unseal',
      'set.act.import.fail.badPass': 'Wrong passphrase, or the content is damaged',
      'set.act.import.fail.badJson': 'The body is not valid JSON',
      'set.act.import.fail.badShape': 'The content structure is not valid',
      'set.act.import.fail.noKnownKey': 'No recognisable setting found',
      'set.fp.ok': 'match',
      'set.fp.bad': 'mismatch (content was modified)',
      'set.fp.na': 'not provided',
      'set.act.reset': 'Restore defaults',
      'set.act.reset.hint': 'Reset every setting back to its factory value',
      'set.act.reset.confirm': 'Restore all settings to their default values?',
      'set.act.reset.done': 'Defaults restored',

      'opt.title': 'Markdown file',
      'editor.placeholder': 'Type Markdown here…',
      'file.demo': 'demo.md',
      'file.code': 'code-highlight.md',
      'file.todo': 'todo.md'
    }
  };

  var SUPPORTED = ['zh-CN', 'en'];

  function normalizeLang(tag) {
    var t = String(tag || '').toLowerCase();
    if (t.indexOf('zh') === 0) return 'zh-CN';
    return 'en';
  }

  function detect() {
    var stored = null;
    try { stored = localStorage.getItem(STORE_KEY); } catch (e) { /* 隐私模式 */ }
    if (stored && SUPPORTED.indexOf(stored) >= 0) return stored;
    var nav = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || 'en';
    return normalizeLang(nav);
  }

  var current = 'en';

  /** 取词，支持 {0} {1} 占位 */
  function t(key) {
    var args = Array.prototype.slice.call(arguments, 1);
    var table = DICT[current] || DICT.en;
    var s = table[key];
    if (s == null) s = (DICT.en[key] != null ? DICT.en[key] : key);
    return s.replace(/\{(\d+)\}/g, function (m, i) {
      var v = args[Number(i)];
      return v == null ? m : String(v);
    });
  }

  /** 把一棵子树里的 data-i18n* 属性回填 */
  function apply(rootEl) {
    var rootNode = rootEl || document;
    var nodes = rootNode.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
      k = el.getAttribute('data-i18n-title');
      if (k) el.setAttribute('title', t(k));
      k = el.getAttribute('data-i18n-placeholder');
      if (k) el.setAttribute('placeholder', t(k));
      k = el.getAttribute('data-i18n-aria');
      if (k) el.setAttribute('aria-label', t(k));
    }
    if (rootNode === document || rootNode === document.documentElement) {
      document.documentElement.setAttribute('lang', current === 'zh-CN' ? 'zh-CN' : 'en');
      document.title = t('app.name');
    }
  }

  function set(lang) {
    var next = SUPPORTED.indexOf(lang) >= 0 ? lang : normalizeLang(lang);
    current = next;
    try { localStorage.setItem(STORE_KEY, next); } catch (e) { /* ignore */ }
    apply(document);
    try {
      document.dispatchEvent(new CustomEvent('md:lang', { detail: { lang: next } }));
    } catch (e) { /* 老环境无 CustomEvent 构造器 */ }
    return next;
  }

  /** 在两种语言之间轮换，返回新语言 */
  function toggle() {
    return set(current === 'zh-CN' ? 'en' : 'zh-CN');
  }

  current = detect();

  return {
    SUPPORTED: SUPPORTED,
    lang: function () { return current; },
    t: t,
    apply: apply,
    set: set,
    toggle: toggle
  };
});
