const { formatDuration, truncate, escapeHtml } = MeetingExtUtils;
const { getSettings, getRuntimeState, getSetupIssues } = MeetingExtStorage;

let statusTimer = null;
let toastTimer = null;
let pendingStartTab = null;

async function init() {
  bindEvents();
  await refresh();
  statusTimer = setInterval(refresh, 1000);
}

function bindEvents() {
  document.getElementById('startBtn').addEventListener('click', openTitleDialog);
  document.getElementById('stopBtn').addEventListener('click', stopRecording);
  document.getElementById('panelBtn').addEventListener('click', openPanel);
  document.getElementById('reportBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_REPORT' }));
  document.getElementById('settingsBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }));
  document.getElementById('issuesSettingsBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }));
  document.getElementById('reauthBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_REAUTH' });
    await chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
  });
  document.getElementById('titleStartBtn').addEventListener('click', startRecordingFromDialog);
  document.getElementById('titleCancelBtn').addEventListener('click', closeTitleDialog);
  document.getElementById('titleInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startRecordingFromDialog();
    if (event.key === 'Escape') closeTitleDialog();
  });
}

async function refresh() {
  const [settings, runtime, meetings] = await Promise.all([
    getSettings(),
    getRuntimeState(),
    MeetingExtStorage.listMeetings(),
  ]);
  const issues = getSetupIssues(settings);
  const currentMeeting = runtime.activeMeetingId
    ? meetings.find((meeting) => meeting.meetingId === runtime.activeMeetingId)
    : meetings[0] || null;
  const isRecording = !!runtime.recordingLockMeetingId;

  renderStatus(currentMeeting, isRecording);
  renderIssues(issues);
  renderReauth(runtime.reauthRequired);

  document.getElementById('startBtn').disabled = isRecording || issues.length > 0;
  document.getElementById('stopBtn').disabled = !isRecording;
}

function renderStatus(meeting, isRecording) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const sub = document.getElementById('statusSub');
  const title = document.getElementById('meetingTitle');
  const elapsed = document.getElementById('meetingElapsed');

  dot.className = 'status-dot';

  if (!meeting) {
    label.textContent = '待機中';
    sub.textContent = '会議のタブをアクティブにしてから「録音開始」を押してください。';
    title.textContent = '—';
    elapsed.textContent = '00:00:00';
    return;
  }

  title.textContent = truncate(meeting.title || meeting.tabTitle || 'Untitled', 32);
  const startedAt = meeting.startedAt ? new Date(meeting.startedAt).getTime() : 0;
  const endedAt = meeting.endedAt ? new Date(meeting.endedAt).getTime() : Date.now();
  elapsed.textContent = startedAt ? formatDuration(endedAt - startedAt) : '00:00:00';

  if (isRecording) {
    dot.classList.add('recording');
    label.textContent = meeting.micMissing ? '録音中（タブ音のみ）' : '録音中';
    sub.textContent = 'Side Panel で文字起こしを確認できます。';
  } else if ((meeting.state || '').endsWith('_failed')) {
    dot.classList.add('failed');
    label.textContent = '失敗あり';
    sub.textContent = meeting.error || meeting.state;
  } else if (meeting.state === 'done') {
    dot.classList.add('done');
    label.textContent = '完了';
    sub.textContent = 'Docs / Calendar / Sheets まで書き込み済みです。';
  } else if (meeting.state === 'awaiting_approval') {
    dot.classList.add('processing');
    label.textContent = 'タスク承認待ち';
    sub.textContent = 'Side Panel から承認してください。';
  } else {
    dot.classList.add('processing');
    label.textContent = meeting.state || '処理中';
    sub.textContent = '文字起こし・構造化・書き込みを進行中です。';
  }
}

function renderIssues(issues) {
  const card = document.getElementById('issuesCard');
  const list = document.getElementById('issuesList');
  card.hidden = issues.length === 0;
  list.innerHTML = issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('');
}

function renderReauth(needed) {
  document.getElementById('reauthCard').hidden = !needed;
}

async function openTitleDialog() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('アクティブなタブを取得できませんでした');
    pendingStartTab = tab;
    document.getElementById('titleCard').hidden = false;
    const input = document.getElementById('titleInput');
    input.value = '';
    input.placeholder = tab.title ? `例: ${tab.title.slice(0, 30)}` : '例: 〇〇さんMTG / 週次定例';
    input.focus();
  } catch (error) {
    showToast(error.message || String(error));
  }
}

function closeTitleDialog() {
  document.getElementById('titleCard').hidden = true;
  pendingStartTab = null;
}

async function startRecordingFromDialog() {
  const tab = pendingStartTab;
  if (!tab) return;
  const title = document.getElementById('titleInput').value.trim();
  closeTitleDialog();
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      tabId: tab.id,
      tabTitle: tab.title || '',
      tabUrl: tab.url || '',
      windowId: tab.windowId,
      title,
    });
    if (result?.ok === false) throw new Error(result.error || '録音を開始できませんでした');
    showToast('録音を開始しました');
    await refresh();
  } catch (error) {
    showToast(error.message || String(error));
  }
}

async function stopRecording() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    if (result?.ok === false) throw new Error(result.error || '停止できませんでした');
    showToast('録音停止を送信しました');
    await refresh();
  } catch (error) {
    showToast(error.message || String(error));
  }
}

async function openPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await chrome.runtime.sendMessage({
    type: 'OPEN_SIDE_PANEL',
    tabId: tab.id,
    windowId: tab.windowId,
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

window.addEventListener('unload', () => clearInterval(statusTimer));
init();
