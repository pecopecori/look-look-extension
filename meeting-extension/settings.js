const toastEl = document.getElementById('toast');
let toastTimer = null;

async function init() {
  const [settings, runtime] = await Promise.all([
    MeetingExtStorage.getSettings(),
    MeetingExtStorage.getRuntimeState(),
  ]);
  document.getElementById('docsFolderId').value = settings.docsFolderId || '';
  document.getElementById('spreadsheetId').value = settings.spreadsheetId || '';
  document.getElementById('calendarId').value = settings.calendarId || 'primary';
  document.getElementById('whisperServerUrl').value = settings.whisperServerUrl || 'http://127.0.0.1:9000';
  document.getElementById('whisperLanguage').value = settings.whisperLanguage || 'ja';
  document.getElementById('geminiApiKey').value = settings.geminiApiKey || '';
  document.getElementById('geminiModel').value = settings.geminiModel || 'gemini-2.0-flash';
  document.getElementById('timezone').value = settings.timezone || MeetingExtUtils.browserTz();
  document.getElementById('approvalMode').value = settings.approvalMode || 'manual';
  document.getElementById('autoOpenSidePanel').checked = settings.autoOpenSidePanel !== false;
  document.getElementById('notifyOnFailure').checked = settings.notifyOnFailure !== false;

  document.getElementById('reauthCard').hidden = !runtime.reauthRequired;

  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('provisionBtn').addEventListener('click', provision);
  document.getElementById('testWhisperBtn').addEventListener('click', testWhisper);
}

async function readForm() {
  return {
    docsFolderId: document.getElementById('docsFolderId').value.trim(),
    spreadsheetId: document.getElementById('spreadsheetId').value.trim(),
    calendarId: document.getElementById('calendarId').value.trim() || 'primary',
    whisperServerUrl: document.getElementById('whisperServerUrl').value.trim() || 'http://127.0.0.1:9000',
    whisperLanguage: document.getElementById('whisperLanguage').value.trim() || 'ja',
    geminiApiKey: document.getElementById('geminiApiKey').value.trim(),
    geminiModel: document.getElementById('geminiModel').value.trim() || 'gemini-2.0-flash',
    timezone: document.getElementById('timezone').value.trim() || MeetingExtUtils.browserTz(),
    approvalMode: document.getElementById('approvalMode').value,
    autoOpenSidePanel: document.getElementById('autoOpenSidePanel').checked,
    notifyOnFailure: document.getElementById('notifyOnFailure').checked,
  };
}

async function save() {
  const current = await MeetingExtStorage.getSettings();
  const patch = await readForm();
  await MeetingExtStorage.saveSettings({ ...current, ...patch });
  showToast('保存しました');
}

async function provision() {
  try {
    if (!MeetingExtUtils.isOauthClientConfigured()) {
      throw new Error('先に manifest.json の oauth2.client_id を実値に置き換えてください。');
    }
    await save();
    const result = await chrome.runtime.sendMessage({ type: 'PROVISION_GOOGLE' });
    if (!result?.ok) throw new Error(result?.error || 'Google 初期化に失敗しました');
    document.getElementById('docsFolderId').value = result.folderId || '';
    document.getElementById('spreadsheetId').value = result.spreadsheetId || '';
    document.getElementById('calendarId').value = result.calendarId || 'primary';
    document.getElementById('reauthCard').hidden = true;
    await save();
    showToast('Google リソースを作成しました');
  } catch (error) {
    showToast(error.message || String(error));
  }
}

async function testWhisper() {
  const url = document.getElementById('whisperServerUrl').value.trim() || 'http://127.0.0.1:9000';
  const status = document.getElementById('whisperStatus');
  status.textContent = '確認中…';
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    status.textContent = `✓ 応答 OK: model=${json.model || '?'} device=${json.device || '?'} compute=${json.compute || '?'}`;
    showToast('whisper サーバ疎通 OK');
  } catch (error) {
    status.textContent = `✗ 接続失敗: ${error.message || error}（install.sh は実行済み？）`;
    showToast('whisper サーバに接続できません');
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

init();
