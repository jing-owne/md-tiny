// MDTN-A1 1.0 12823B20 iz2177Q7oEUhUe5uPPwmVTVHIHsVhi2LITFASIJIEJt_yK4QFHQUHEtCJ5_jyOJB_jvzYz4-VSiBxk3naHp3DA
/* ============================================================================
 * 选项页引导脚本
 * ----------------------------------------------------------------------------
 * 只做三件事：定标题、写明版本、把面板渲染出来。所有交互都在 settings-ui.js。
 * ========================================================================== */

(function () {
  'use strict';

  function T(key) {
    return window.MDI18N ? window.MDI18N.t(key) : key;
  }

  function syncTitle() {
    document.title = T('set.title');
  }

  function boot() {
    var root = document.getElementById('settings-root');
    if (!root) return;

    syncTitle();

    var sub = document.getElementById('opt-sub');
    if (sub && window.MDSettings) {
      sub.textContent = T('app.name') + ' v' + window.MDSettings.VERSION;
    }

    if (window.MDSettingsUI) window.MDSettingsUI.render(root);
  }

  // i18n 的 set() 会把 document.title 改成应用名，这里在语言切换后拉回"设置"
  document.addEventListener('md:lang', syncTitle);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
