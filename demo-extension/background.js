// Look!Look! — service worker

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-toolbar') {
    const tab = await getActiveTab();
    if (!tab) return;
    const ok = await sendToTab(tab.id, { type: 'TOGGLE_TOOLBAR' });
    if (!ok) notifyUnsupported();
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  const ok = await sendToTab(tab.id, { type: 'TOGGLE_TOOLBAR' });
  if (!ok) notifyUnsupported();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'POPUP_TOGGLE_TOOLBAR') {
    (async () => {
      const tab = await getActiveTab();
      if (!tab) return sendResponse({ ok: false, error: 'no-tab' });
      const ok = await sendToTab(tab.id, { type: 'TOGGLE_TOOLBAR' });
      sendResponse({ ok, error: ok ? null : 'unsupported-page' });
    })();
    return true;
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (_) {
    return false;
  }
}

function notifyUnsupported() {
  chrome.action.setBadgeText({ text: '✕' });
  chrome.action.setBadgeBackgroundColor({ color: '#CB5457' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1800);
}
