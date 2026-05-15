// Look!Look! — service worker
// 役割: ショートカット受信、録画ウィンドウ管理、content.js / recorder.js の中継

const recorderState = {
  windowId: null,
  tabId: null,
  status: 'idle',
  startedAt: null,
};

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-toolbar') {
    const tab = await getActiveTab();
    if (!tab) return;
    const ok = await sendToTab(tab.id, { type: 'TOGGLE_TOOLBAR' });
    if (!ok) notifyUnsupported();
    return;
  }

  if (command === 'toggle-recording') {
    await toggleRecordingFlow();
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

  if (msg?.type === 'POPUP_TOGGLE_RECORDING') {
    (async () => {
      const result = await toggleRecordingFlow();
      sendResponse(result);
    })();
    return true;
  }

  if (msg?.type === 'POPUP_GET_STATE') {
    sendResponse({ ok: true, recorder: snapshotRecorderState() });
    return true;
  }

  if (msg?.type === 'POPUP_OPEN_RECORDER') {
    (async () => {
      const result = await ensureRecorderWindow({ autoStart: Boolean(msg.autoStart) });
      sendResponse(result);
    })();
    return true;
  }

  if (msg?.type === 'RECORDER_STATUS') {
    updateRecorderState(msg.payload, sender.tab);
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === 'RECORDER_FOCUS') {
    if (recorderState.windowId) {
      chrome.windows.update(recorderState.windowId, { focused: true }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === 'CAPTURE_VISIBLE_TAB') {
    (async () => {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: 'png' });
        sendResponse({ ok: true, dataUrl });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || 'capture-failed' });
      }
    })();
    return true;
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === recorderState.windowId) resetRecorderState();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recorderState.tabId) resetRecorderState();
});

async function toggleRecordingFlow() {
  if (recorderState.status === 'recording' || recorderState.status === 'starting') {
    const stopped = await sendRecorderCommand({ type: 'RECORDER_STOP' });
    return { ok: stopped, action: stopped ? 'stop' : 'focus', recorder: snapshotRecorderState() };
  }

  return ensureRecorderWindow({ autoStart: false });
}

async function ensureRecorderWindow({ autoStart = false } = {}) {
  // まず既存ウィンドウが本当に生きているか確認してから focus
  if (recorderState.windowId) {
    try {
      await chrome.windows.get(recorderState.windowId);
      await chrome.windows.update(recorderState.windowId, { focused: true });
      if (autoStart) await sendRecorderCommand({ type: 'RECORDER_START' });
      return { ok: true, action: 'focus', recorder: snapshotRecorderState() };
    } catch (_) {
      resetRecorderState();
    }
  }

  const url = chrome.runtime.getURL(`recorder.html${autoStart ? '?autoStart=1' : ''}`);
  let created;
  try {
    created = await chrome.windows.create({
      url,
      type: 'popup',
      width: 460,
      height: 460,
      focused: true,
    });
  } catch (err) {
    console.error('[Look!Look!] Failed to open recorder window:', err);
    return { ok: false, error: 'window-create-failed' };
  }

  recorderState.windowId = created.id ?? null;
  recorderState.tabId = created.tabs?.[0]?.id ?? null;
  recorderState.status = 'idle';
  recorderState.startedAt = null;

  return { ok: true, action: 'open', recorder: snapshotRecorderState() };
}

async function sendRecorderCommand(message) {
  try {
    await chrome.runtime.sendMessage(message);
    return true;
  } catch (_) {
    return false;
  }
}

function updateRecorderState(payload = {}, tab) {
  if (tab?.id) recorderState.tabId = tab.id;
  if (tab?.windowId) recorderState.windowId = tab.windowId;
  recorderState.status = payload.status || recorderState.status;
  recorderState.startedAt = payload.startedAt ?? recorderState.startedAt;

  if (recorderState.status === 'idle') {
    recorderState.startedAt = null;
  }

  broadcastRecordingStatus();
}

async function broadcastRecordingStatus() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch (_) {
    return;
  }
  const msg = {
    type: 'RECORDING_STATUS_CHANGED',
    status: recorderState.status,
    startedAt: recorderState.startedAt,
  };
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

function snapshotRecorderState() {
  return {
    windowId: recorderState.windowId,
    tabId: recorderState.tabId,
    status: recorderState.status,
    startedAt: recorderState.startedAt,
  };
}

function resetRecorderState() {
  recorderState.windowId = null;
  recorderState.tabId = null;
  recorderState.status = 'idle';
  recorderState.startedAt = null;
}

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
