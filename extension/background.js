// MDTN-A1 1.0 12823B20 DcHkXDg-muR_k_UjQmpjNMxerZ4d_qfttbSr7-2BajKukTjHskYFIrOW88RZFFOQ4PpsVkEq3JGbBe-5aQWzCg
/**
 * md-tiny · Service Worker
 * ----------------------------------------------------------------------------
 * 职责一：点击扩展图标 / Ctrl+Shift+M -> 打开编辑器
 *   已存在编辑器标签页时直接激活，避免每次点击都新开一个窗口。
 *   用 runtime.getContexts 查找自身标签页，不需要 "tabs" 权限
 *   （避免"读取浏览历史"的权限警告）。
 *
 * 职责二：把全局快捷键 toggle-theme / toggle-sidebar 转达给编辑器页面。
 *   走 chrome.storage 广播而不是 tabs.sendMessage —— 后者需要 host 权限，
 *   前者只用到 "storage"，权限面更小；编辑器页面监听 storage.onChanged 即可。
 *   页面自身也监听同样的组合键（快捷键被系统占用时作为兜底），两条路径
 *   不会同时触发：Chrome 一旦接管组合键，页面就收不到该 keydown。
 */

const EDITOR_URL = chrome.runtime.getURL('editor.html');
const CMD_KEY = 'mded.cmd';

async function findEditorTabId() {
  if (typeof chrome.runtime.getContexts !== 'function') return null;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const hit = (contexts || []).find(
      (c) => typeof c.documentUrl === 'string' && c.documentUrl.indexOf(EDITOR_URL) === 0
    );
    return hit && typeof hit.tabId === 'number' && hit.tabId >= 0 ? hit.tabId : null;
  } catch (e) {
    return null;
  }
}

async function focusEditorTab() {
  const tabId = await findEditorTabId();
  if (tabId === null) return false;
  try {
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    if (tab && typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return true;
  } catch (e) {
    // 标签页已关闭等异常 -> 落回新建
    return false;
  }
}

chrome.action.onClicked.addListener(async () => {
  if (await focusEditorTab()) return;
  await chrome.tabs.create({ url: EDITOR_URL });
});

/** 把命令投递给编辑器页面；页面不存在时先把编辑器打开 */
async function relayCommand(cmd) {
  const opened = await focusEditorTab();
  if (!opened) {
    await chrome.tabs.create({ url: EDITOR_URL });
    return;
  }
  try {
    // 带自增序号，保证连续两次同样的命令也能被页面感知为"新消息"
    const prev = await chrome.storage.local.get(CMD_KEY);
    const seq = ((prev && prev[CMD_KEY] && prev[CMD_KEY].seq) || 0) + 1;
    await chrome.storage.local.set({ [CMD_KEY]: { seq, cmd, at: Date.now() } });
  } catch (e) { /* storage 不可用时静默 */ }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-theme' || command === 'toggle-sidebar') {
    relayCommand(command);
  }
});
