// MDTN-A1 1.0 12823B20 QiC97BeDNiGnz7iXA4G8G_ekfF_76eAv6d3S65Qw7XWufufrqeEncGs-lLlnng8562zyY3tsgfrgLUg8w0YjDQ
/* ============================================================================
 * MDTN-SETTINGS · 配置中心
 * ----------------------------------------------------------------------------
 * 一处定义，处处生效：SCHEMA 是"有哪些设置项、取值范围、默认值、怎么显示"的
 * 唯一事实来源，界面（settings-ui.js）与行为（editor.js / ui.js / server-bridge.js）
 * 都只读它，不各自维护一份。
 *
 * ── 存储策略（重点在"首屏不闪"）────────────────────────────────────────────
 *   · localStorage        同步可读，充当首屏缓存；扩展的 editor.html 与
 *                         options.html 同源，天然共享同一份
 *   · chrome.storage.sync 异步，仅承担跨设备同步；读到的值回填缓存
 *   · 两者都不可用时退化为内存存储，功能不中断（只是关掉页面就丢）
 *
 * ── 两个桥接项 ─────────────────────────────────────────────────────────────
 *   theme / lang 不存本模块的 JSON，而是委托给 MDTheme / MDI18N。原因是它们
 *   必须在首帧绘制前同步落地（否则会先亮后暗）；本模块只提供统一的读写入口，
 *   不接管它们的存储，避免出现两份值互相打架。
 *
 * ── 广播 ───────────────────────────────────────────────────────────────────
 *   任何变更都会向 document 派发 'md:settings'，detail = { key, value, all }。
 *   跨文档变更（选项页改了、编辑器正开着）靠 localStorage 的 storage 事件与
 *   chrome.storage.onChanged 拉回。
 *
 * ── 导出格式 ───────────────────────────────────────────────────────────────
 *   明文：MDTN-SET/1 头 + 指纹 + 正文 JSON（指纹由 MDTinySig 生成，导入时校验）
 *   口令：复用 MDTN-E1 封装格式，整段包成密文串
 * ========================================================================== */

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MDSettings = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var G = (typeof self !== 'undefined') ? self
    : (typeof global !== 'undefined') ? global : {};

  var SIG = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./sig.js')
    : (G.MDTinySig || null);

  var VERSION = '1.0';
  var SPEC = 'MDTN-SET/1';
  var NS = 'mded.settings.v1';        // localStorage 键
  var SYNC_KEY = 'mded-settings-v1';  // chrome.storage.sync 键

  // ==========================================================================
  // 1. SCHEMA —— 设置项定义（唯一事实来源）
  // ==========================================================================
  //
  //  group   分组，对应面板左侧导航
  //  type    enum | range | bool | info
  //  def     默认值（出厂值，恢复默认即回到这里）
  //  bridged 该键的真实存储由外部模块持有（theme / lang）
  //
  var SCHEMA = [
    // ---------------------------------------------------------------- 外观
    {
      key: 'theme', group: 'appearance', type: 'enum', def: 'auto', bridged: 'theme',
      label: 'set.theme.label', hint: 'set.theme.hint',
      options: [
        { value: 'light', label: 'theme.light' },
        { value: 'dark', label: 'theme.dark' },
        { value: 'auto', label: 'theme.auto' }
      ]
    },
    {
      key: 'lang', group: 'appearance', type: 'enum', def: 'auto', bridged: 'lang',
      label: 'set.lang.label', hint: 'set.lang.hint',
      options: [
        { value: 'auto', label: 'set.lang.opt.auto' },
        { value: 'zh-CN', label: 'set.lang.opt.zh' },
        { value: 'en', label: 'set.lang.opt.en' }
      ]
    },
    {
      key: 'content.fontSize', group: 'appearance', type: 'range', def: 16,
      min: 13, max: 22, step: 1, unit: 'px',
      label: 'set.fontSize.label', hint: 'set.fontSize.hint'
    },
    {
      key: 'content.lineHeight', group: 'appearance', type: 'range', def: 1.5,
      min: 1.2, max: 2.2, step: 0.05, decimals: 2,
      label: 'set.lineHeight.label', hint: 'set.lineHeight.hint'
    },
    {
      key: 'content.width', group: 'appearance', type: 'range', def: 900,
      min: 0, max: 1400, step: 20, unit: 'px', zeroLabel: 'set.width.opt.unlimited',
      label: 'set.width.label', hint: 'set.width.hint'
    },
    {
      key: 'ui.motion', group: 'appearance', type: 'bool', def: true,
      label: 'set.motion.label', hint: 'set.motion.hint'
    },

    // -------------------------------------------------------------- 编辑器
    {
      key: 'editor.fontSize', group: 'editor', type: 'range', def: 14,
      min: 11, max: 20, step: 1, unit: 'px',
      label: 'set.edFontSize.label', hint: 'set.edFontSize.hint'
    },
    {
      key: 'editor.tabSize', group: 'editor', type: 'enum', def: 2,
      label: 'set.tabSize.label', hint: 'set.tabSize.hint',
      options: [
        { value: 2, label: 'set.tabSize.opt.2' },
        { value: 4, label: 'set.tabSize.opt.4' }
      ]
    },
    {
      key: 'editor.spellcheck', group: 'editor', type: 'bool', def: false,
      label: 'set.spellcheck.label', hint: 'set.spellcheck.hint'
    },

    // ---------------------------------------------------------------- 预览
    {
      key: 'preview.copy', group: 'preview', type: 'bool', def: true,
      label: 'set.copy.label', hint: 'set.copy.hint'
    },
    {
      key: 'preview.math', group: 'preview', type: 'bool', def: true,
      label: 'set.math.label', hint: 'set.math.hint'
    },
    {
      key: 'preview.lightbox', group: 'preview', type: 'bool', def: true,
      label: 'set.lightbox.label', hint: 'set.lightbox.hint'
    },
    {
      key: 'preview.autoReload', group: 'preview', type: 'bool', def: false,
      label: 'set.autoReload.label', hint: 'set.autoReload.hint'
    },

    // ----------------------------------------------------------- 文件与存储
    {
      key: 'files.confirmClose', group: 'files', type: 'bool', def: true,
      label: 'set.confirmClose.label', hint: 'set.confirmClose.hint'
    },
    {
      key: 'files.warnUnload', group: 'files', type: 'bool', def: true,
      label: 'set.warnUnload.label', hint: 'set.warnUnload.hint'
    },
    {
      key: 'files.revealTree', group: 'files', type: 'bool', def: true,
      label: 'set.revealTree.label', hint: 'set.revealTree.hint'
    },

    // ---------------------------------------------------------------- 高级
    { key: 'about.version', group: 'about', type: 'info', label: 'set.about.version', info: function () { return VERSION; } },
    { key: 'about.flavor', group: 'about', type: 'info', label: 'set.about.flavor', info: flavor },
    { key: 'about.spec', group: 'about', type: 'info', label: 'set.about.spec', info: specLine },
    { key: 'about.store', group: 'about', type: 'info', label: 'set.about.store', info: storageLabel },
    { key: 'about.export', group: 'about', type: 'action', action: 'export', label: 'set.act.export', hint: 'set.act.export.hint' },
    { key: 'about.import', group: 'about', type: 'action', action: 'import', label: 'set.act.import', hint: 'set.act.import.hint' },
    { key: 'about.reset', group: 'about', type: 'action', action: 'reset', label: 'set.act.reset', hint: 'set.act.reset.hint', danger: true }
  ];

  var GROUPS = [
    { id: 'appearance', label: 'set.group.appearance' },
    { id: 'editor', label: 'set.group.editor' },
    { id: 'preview', label: 'set.group.preview' },
    { id: 'files', label: 'set.group.files' },
    { id: 'about', label: 'set.group.about' }
  ];

  var BY_KEY = {};
  for (var i = 0; i < SCHEMA.length; i++) BY_KEY[SCHEMA[i].key] = SCHEMA[i];

  function itemOf(key) { return BY_KEY[key] || null; }

  function defaults() {
    var out = {};
    for (var j = 0; j < SCHEMA.length; j++) {
      if (SCHEMA[j].type === 'info' || SCHEMA[j].type === 'action') continue;
      out[SCHEMA[j].key] = SCHEMA[j].def;
    }
    return out;
  }

  // ==========================================================================
  // 2. 存储后端
  // ==========================================================================

  function tryLocal() {
    try {
      var ls = G.localStorage;
      if (!ls) return null;
      ls.setItem('mded.probe', '1');
      ls.removeItem('mded.probe');
      return ls;
    } catch (e) {
      // 隐私模式 / 存储被策略禁用：不要抛出，退化为内存
      return null;
    }
  }

  var LS = tryLocal();
  var MEM = null; // 无 localStorage 时的内存兜底

  function syncArea() {
    try {
      return (G.chrome && G.chrome.storage && G.chrome.storage.sync) || null;
    } catch (e) {
      return null;
    }
  }

  function rawRead() {
    if (LS) {
      try { return LS.getItem(NS); } catch (e) { return null; }
    }
    return MEM;
  }

  function rawWrite(text) {
    if (LS) {
      try { LS.setItem(NS, text); } catch (e) { /* 配额满等：忽略 */ }
    } else {
      MEM = text;
    }
    var sync = syncArea();
    if (sync) {
      try { sync.set({ mded_settings_v1: text }); } catch (e) { /* 无 storage 权限：忽略 */ }
    }
  }

  function rawClear() {
    if (LS) { try { LS.removeItem(NS); } catch (e) { /* ignore */ } }
    MEM = null;
    var sync = syncArea();
    if (sync) { try { sync.remove('mded_settings_v1'); } catch (e) { /* ignore */ } }
  }

  function storageLabel() {
    if (LS && syncArea()) return 'localStorage + chrome.storage.sync';
    if (LS) return 'localStorage';
    return 'memory（当前环境不可持久化）';
  }

  function flavor() {
    try {
      if (G.chrome && G.chrome.runtime && G.chrome.runtime.id) return 'browser-extension';
      if (G.location && /^https?:$/.test(G.location.protocol)) return 'local-service';
      return 'file';
    } catch (e) {
      return 'unknown';
    }
  }

  // ==========================================================================
  // 3. 取值 / 校验
  // ==========================================================================

  var values = defaults();

  /** 把任意输入收敛到该设置项允许的取值；非法输入一律回落到默认值 */
  function coerce(item, raw) {
    if (!item || item.type === 'info' || item.type === 'action') return undefined;

    if (item.type === 'bool') {
      if (typeof raw === 'string') return raw === 'true' || raw === '1' || raw === 'on';
      return !!raw;
    }

    if (item.type === 'range') {
      var n = Number(raw);
      if (!isFinite(n)) return item.def;
      if (typeof item.min === 'number' && n < item.min) n = item.min;
      if (typeof item.max === 'number' && n > item.max) n = item.max;
      if (item.step) n = Math.round(n / item.step) * item.step;
      return item.decimals ? Number(n.toFixed(item.decimals)) : Math.round(n);
    }

    if (item.type === 'enum') {
      for (var k = 0; k < item.options.length; k++) {
        if (String(item.options[k].value) === String(raw)) return item.options[k].value;
      }
      return item.def;
    }

    return raw;
  }

  function loadFromDisk() {
    var text = rawRead();
    var stored = null;
    if (text) {
      try { stored = JSON.parse(text); } catch (e) { stored = null; }
    }
    var next = defaults();
    if (stored && typeof stored === 'object') {
      for (var j = 0; j < SCHEMA.length; j++) {
        var it = SCHEMA[j];
        if (it.type === 'info' || it.type === 'action' || it.bridged) continue;
        if (Object.prototype.hasOwnProperty.call(stored, it.key)) {
          next[it.key] = coerce(it, stored[it.key]);
        }
      }
    }
    values = next;
  }

  loadFromDisk();

  // ---------------------------------------------------------------- 桥接项

  function bridgeGet(name) {
    if (name === 'theme') {
      return (G.MDTheme && G.MDTheme.get) ? G.MDTheme.get() : (values.theme || 'auto');
    }
    if (name === 'lang') {
      // i18n 只会写"手动选择过的语言"，没有记录即代表"跟随浏览器"
      try {
        var s = LS ? LS.getItem('mded.lang') : null;
        if (s) return s;
      } catch (e) { /* ignore */ }
      return 'auto';
    }
    return undefined;
  }

  function bridgeSet(name, v) {
    if (name === 'theme') {
      if (G.MDTheme && G.MDTheme.set) G.MDTheme.set(v);
      else values.theme = v;
      return;
    }
    if (name === 'lang') {
      if (!G.MDI18N) return;
      if (v === 'auto') {
        try { if (LS) LS.removeItem('mded.lang'); } catch (e) { /* ignore */ }
        var nav = (G.navigator && (G.navigator.language || G.navigator.userLanguage)) || 'en';
        G.MDI18N.set(nav);
      } else {
        G.MDI18N.set(v);
      }
    }
  }

  function bridgeReset(name) {
    if (name === 'theme') {
      if (G.MDTheme && G.MDTheme.set) G.MDTheme.set('auto');
      return;
    }
    if (name === 'lang') {
      try { if (LS) LS.removeItem('mded.lang'); } catch (e) { /* ignore */ }
      if (G.MDI18N) {
        var nav = (G.navigator && (G.navigator.language || G.navigator.userAgent)) || 'en';
        G.MDI18N.set(nav);
      }
    }
  }

  // ==========================================================================
  // 4. 读写 API
  // ==========================================================================

  function all() {
    var out = {};
    for (var j = 0; j < SCHEMA.length; j++) {
      var it = SCHEMA[j];
      if (it.type === 'info' || it.type === 'action') continue;
      out[it.key] = it.bridged ? bridgeGet(it.bridged) : values[it.key];
    }
    return out;
  }

  function get(key) {
    var it = itemOf(key);
    if (!it) return undefined;
    return it.bridged ? bridgeGet(it.bridged) : values[key];
  }

  var listeners = [];

  function emit(key) {
    var detail = { key: key, value: get(key), all: all() };
    for (var j = 0; j < listeners.length; j++) {
      try { listeners[j](detail); } catch (e) { console.warn('[settings] 监听器异常', e); }
    }
    if (typeof G.document !== 'undefined' && G.document.dispatchEvent) {
      try {
        G.document.dispatchEvent(new G.CustomEvent('md:settings', { detail: detail }));
      } catch (e) { /* 老环境无 CustomEvent 构造器 */ }
    }
  }

  /** 写入一项设置；返回收敛后的实际值。silent=true 时不落盘（供内部批量使用） */
  function set(key, raw, silent) {
    var it = itemOf(key);
    if (!it || it.type === 'info' || it.type === 'action') return undefined;
    var v = coerce(it, raw);

    if (it.bridged) {
      bridgeSet(it.bridged, v);
    } else {
      if (values[key] === v) return v;
      values[key] = v;
      if (!silent) rawWrite(JSON.stringify(values));
    }
    if (!silent) { apply(); emit(key); }
    return v;
  }

  /** 批量写入，只落盘一次、只广播一次 */
  function merge(patch) {
    var changed = [];
    for (var key in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      var it = itemOf(key);
      if (!it || it.type === 'info' || it.type === 'action') continue;
      var before = get(key);
      set(key, patch[key], true);
      if (get(key) !== before) changed.push(key);
    }
    rawWrite(JSON.stringify(values));
    apply();
    if (changed.length) emit(changed.length === 1 ? changed[0] : '*');
    return changed;
  }

  function reset() {
    for (var j = 0; j < SCHEMA.length; j++) {
      var it = SCHEMA[j];
      if (it.type === 'info' || it.type === 'action') continue;
      if (it.bridged) bridgeReset(it.bridged);
    }
    values = defaults();
    rawClear();
    apply();
    emit('*');
    return all();
  }

  // ==========================================================================
  // 5. 落地到 DOM（CSS 变量 + 状态类）
  // ==========================================================================

  function px(n) { return (Number(n) || 0) + 'px'; }

  function apply() {
    if (typeof G.document === 'undefined' || !G.document.documentElement) return;
    var el = G.document.documentElement;
    var s = values;

    el.style.setProperty('--md-content-font-size', px(s['content.fontSize']));
    el.style.setProperty('--md-content-line-height', String(s['content.lineHeight']));
    el.style.setProperty('--md-content-width', px(s['content.width']));
    el.style.setProperty('--md-tiny-font-size', px(s['editor.fontSize']));
    el.style.setProperty('--md-tiny-tab-size', String(s['editor.tabSize']));

    // 宽度为 0 表示不限制，交给 CSS 分支处理，避免算出 50% 的巨大内边距
    el.classList.toggle('md-width-limited', Number(s['content.width']) > 0);
    el.classList.toggle('md-reduce-motion', !s['ui.motion']);

    var ed = G.document.getElementById('editor');
    if (ed) ed.setAttribute('spellcheck', s['editor.spellcheck'] ? 'true' : 'false');
  }

  // ==========================================================================
  // 6. 跨文档同步
  // ==========================================================================

  function adopt(text) {
    if (!text || text === rawRead()) return false;
    if (LS) { try { LS.setItem(NS, text); } catch (e) { /* ignore */ } }
    MEM = text;
    loadFromDisk();
    apply();
    emit('*');
    return true;
  }

  function watch() {
    if (typeof G.addEventListener === 'function') {
      G.addEventListener('storage', function (e) {
        if (e && e.key === NS && e.newValue) adopt(e.newValue);
      });
    }
    var sync = syncArea();
    if (sync && G.chrome && G.chrome.storage && G.chrome.storage.onChanged) {
      try {
        G.chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'sync' || !changes.mded_settings_v1) return;
          adopt(changes.mded_settings_v1.newValue || '');
        });
      } catch (e) { /* ignore */ }
    }
  }

  // ==========================================================================
  // 7. 导出 / 导入（复用自有 MDED 格式）
  // ==========================================================================

  function canonical(obj) {
    var keys = Object.keys(obj).sort();
    var out = [];
    for (var j = 0; j < keys.length; j++) out.push(keys[j] + '=' + String(obj[keys[j]]));
    return out.join('\n');
  }

  function fingerprintOf(obj) {
    if (!SIG || !SIG.fingerprint) return '(MDTinySig 未加载)';
    return SIG.fingerprint(canonical(obj), VERSION);
  }

  function specLine() {
    return SPEC + ' ' + fingerprintOf(all());
  }

  /** 明文导出：头部带指纹，导入时用于校验是否被改动过 */
  function exportText() {
    var snap = all();
    return SPEC + '\n' +
      'version: ' + VERSION + '\n' +
      'fingerprint: ' + fingerprintOf(snap) + '\n' +
      '---\n' +
      JSON.stringify(snap, null, 2) + '\n';
  }

  /** 口令导出：整段明文包进 MDTN-E1 密文串 */
  function sealText(passphrase, rounds) {
    if (!SIG || !SIG.seal) return exportText();
    return SIG.seal(exportText(), passphrase || 'mded-settings', rounds || 3);
  }

  /**
   * 导入。带口令的密文需显式传入 passphrase。
   * 返回 { ok, applied, fingerprintOk, error }
   */
  function importText(text, passphrase) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return { ok: false, error: 'empty' };

    if (t.indexOf('MDTN-E1') === 0) {
      if (!passphrase) return { ok: false, error: 'sealed' };
      if (!SIG || !SIG.unseal) return { ok: false, error: 'noSig' };
      var plain = SIG.unseal(t, passphrase);
      if (!plain) return { ok: false, error: 'badPass' };
      var inner = importText(plain);
      // MDTN-E1 是流式混淆，没有内建校验：口令错时解出来的是乱码。
      // 乱码必然过不了"头部指纹 / JSON 结构"这两关，把它翻译成"口令不正确"，
      // 否则用户会看到"正文不是合法 JSON"这种毫无指向性的提示。
      if (!inner.ok && (inner.error === 'badJson' || inner.error === 'badShape')) {
        return { ok: false, error: 'badPass' };
      }
      return inner;
    }

    var idx = t.indexOf('\n---');
    var head = idx >= 0 ? t.slice(0, idx) : '';
    var body = idx >= 0 ? t.slice(idx + 4) : t;

    var json;
    try { json = JSON.parse(body); } catch (e) { return { ok: false, error: 'badJson' }; }
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, error: 'badShape' };

    var fpOk = null;
    var m = /fingerprint:\s*(.+)/.exec(head);
    if (m && SIG && SIG.fingerprint) fpOk = (fingerprintOf(json) === m[1].trim());

    var patch = {};
    var applied = 0;
    for (var j = 0; j < SCHEMA.length; j++) {
      var it = SCHEMA[j];
      if (it.type === 'info' || it.type === 'action') continue;
      if (Object.prototype.hasOwnProperty.call(json, it.key)) {
        patch[it.key] = json[it.key];
        applied++;
      }
    }
    if (!applied) return { ok: false, error: 'noKnownKey' };

    merge(patch);
    return { ok: true, applied: applied, fingerprintOk: fpOk };
  }

  // ==========================================================================
  // 8. 对外接口
  // ==========================================================================

  var api = {
    VERSION: VERSION,
    SPEC: SPEC,
    NS: NS,
    SCHEMA: SCHEMA,
    GROUPS: GROUPS,
    item: itemOf,
    defaults: defaults,
    all: all,
    get: get,
    set: set,
    merge: merge,
    reset: reset,
    apply: apply,
    watch: watch,
    exportText: exportText,
    sealText: sealText,
    importText: importText,
    fingerprint: function () { return fingerprintOf(all()); },
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    storageKind: storageLabel
  };

  // 载入即落地，避免首帧用默认排版渲染
  apply();
  watch();
  // 本文件在 <head> 中加载，#editor 等元素尚未解析出来，解析完再补一次
  if (typeof G.document !== 'undefined' && G.document.readyState === 'loading') {
    G.document.addEventListener('DOMContentLoaded', apply);
  }

  return api;
});
