// MDTN-A1 1.0 12823B20 NbZ2BhohTptwm-_PQ4NNVjlWLAtQNILU_Q0uwSrZ3rfylS4_Ip5Y4rCHg2Qk0wsFUemG-3AWbyk6RcaChc14Cw
/* ============================================================================
 * MDTN-THEME · 主题状态（light / dark / auto）
 * ----------------------------------------------------------------------------
 * 该脚本在 <head> 中以同步方式加载，先于页面绘制执行，避免主题闪烁。
 *
 * 落点：<html data-theme="light|dark"> —— 选 auto 时移除该属性，交给
 *       editor.css 里的 prefers-color-scheme 分支处理。
 * 同时写入 <html data-md-theme="light|dark|auto"> 保留用户的选择，便于调试。
 *
 * 切换后广播 'md:theme'，detail = { key, effective }。
 * ========================================================================== */

(function () {
  'use strict';

  var KEY = 'mded.theme';
  var ORDER = ['light', 'dark', 'auto'];
  var cur = 'auto';

  try {
    var saved = localStorage.getItem(KEY);
    if (ORDER.indexOf(saved) >= 0) cur = saved;
  } catch (e) { /* 隐私模式 / 存储被禁用 */ }

  // 一次性覆盖：?theme=dark 或 #theme=dark
  // 只作用于本次加载，不写入 localStorage —— 方便截图、CI 与演示链接。
  var overridden = false;
  try {
    var q = new URLSearchParams(location.search).get('theme');
    if (!q) {
      var m = /(?:^|[#&])theme=(light|dark|auto)\b/.exec(location.hash || '');
      q = m ? m[1] : null;
    }
    if (ORDER.indexOf(q) >= 0) { cur = q; overridden = true; }
  } catch (e) { /* ignore */ }

  function apply() {
    var el = document.documentElement;
    if (cur === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', cur);
    el.setAttribute('data-md-theme', cur);
  }

  function effective() {
    if (cur !== 'auto') return cur;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function broadcast() {
    try {
      document.dispatchEvent(new CustomEvent('md:theme', { detail: { key: cur, effective: effective() } }));
    } catch (e) { /* 老环境无 CustomEvent 构造器 */ }
  }

  function set(v) {
    cur = ORDER.indexOf(v) >= 0 ? v : 'auto';
    try { localStorage.setItem(KEY, cur); } catch (e) { /* ignore */ }
    apply();
    broadcast();
    return cur;
  }

  function next() {
    return set(ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length]);
  }

  apply();

  // auto 模式下系统主题变化时，CSS 会自行跟随；这里只做广播，便于 JS 侧联动
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystem = function () { if (cur === 'auto') broadcast(); };
    if (mq.addEventListener) mq.addEventListener('change', onSystem);
    else if (mq.addListener) mq.addListener(onSystem);
  } catch (e) { /* ignore */ }

  window.MDTheme = {
    KEY: KEY,
    ORDER: ORDER,
    overridden: overridden,
    get: function () { return cur; },
    effective: effective,
    set: set,
    next: next,
    apply: apply
  };
})();
