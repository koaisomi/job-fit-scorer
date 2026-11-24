// The UI lives in the browser's side panel. Toolbar click opens it (setPanelBehavior); Alt+J opens it too.
const behavior = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  behavior();
  chrome.storage.sync.remove(['panelOpen', 'panelWidth', 'pushPage']).catch(() => {}); // v1.1 in-page panel state
});
chrome.runtime.onStartup.addListener(behavior);
behavior();

chrome.commands.onCommand.addListener((command, tab) => {
  // Must run synchronously in the command's user gesture: no await before open().
  if (command === 'toggle-panel' && tab?.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});
