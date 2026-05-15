const POPUP_THEMES = {
  natural: { accent: '#A6B5A5', base: '#F4EBDA', text: '#262724', accentRgb: '166,181,165', textRgb: '38,39,36',   surface: '#ffffff' },
  dark:    { accent: '#4A90E2', base: '#1E1E2E', text: '#E8E8E8', accentRgb: '74,144,226',  textRgb: '232,232,232', surface: '#2A2A3E' },
  pink:    { accent: '#E91E63', base: '#FFF0F5', text: '#262724', accentRgb: '233,30,99',   textRgb: '38,39,36',   surface: '#ffffff' },
  blue:    { accent: '#1E88E5', base: '#E3F2FD', text: '#0D47A1', accentRgb: '30,136,229',  textRgb: '13,71,161',  surface: '#ffffff' },
  black:   { accent: '#FFD600', base: '#262724', text: '#F4EBDA', accentRgb: '255,214,0',   textRgb: '244,235,218', surface: '#363330' },
};

function applyTheme(id) {
  const t = POPUP_THEMES[id] || POPUP_THEMES.natural;
  const root = document.documentElement;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--base', t.base);
  root.style.setProperty('--text', t.text);
  root.style.setProperty('--accent-rgb', t.accentRgb);
  root.style.setProperty('--text-rgb', t.textRgb);
  root.style.setProperty('--surface', t.surface);
}

chrome.storage.local.get('demo-ext-theme', (result) => {
  applyTheme(result['demo-ext-theme'] || 'natural');
});

const toggleBtn = document.getElementById('toggleToolbar');
const recordBtn = document.getElementById('startRecord');
const settingsBtn = document.getElementById('openSettings');
const recordButtonLabel = document.getElementById('recordButtonLabel');
const recordStatus = document.getElementById('recordStatus');

toggleBtn.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'POPUP_TOGGLE_TOOLBAR' });
  if (!res?.ok) {
    showError('このページでは動作しません（chrome://、Chromeウェブストア等）');
    return;
  }
  window.close();
});

recordBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'POPUP_TOGGLE_RECORDING' });
  window.close();
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

void refreshState();
void refreshShortcuts();

async function refreshState() {
  const res = await chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' });
  const status = res?.recorder?.status || 'idle';
  const isRecording = status === 'recording' || status === 'starting';

  recordButtonLabel.textContent = isRecording ? '録画を停止する' : '録画パネルを開く';
  recordStatus.textContent = isRecording ? '録画中です。押すと停止します' : '録画は停止中です';
  recordStatus.classList.toggle('recording', isRecording);
}

async function refreshShortcuts() {
  const commands = await chrome.commands.getAll();
  const toolbar = commands.find((c) => c.name === 'toggle-toolbar');
  const recording = commands.find((c) => c.name === 'toggle-recording');
  document.getElementById('shortcutToolbar').textContent = formatShortcut(toolbar?.shortcut);
  document.getElementById('shortcutRecording').textContent = formatShortcut(recording?.shortcut);
}

function formatShortcut(s) {
  if (!s) return '未設定';
  return s
    .replace('Command', '⌘').replace('Ctrl', '⌃')
    .replace('Shift', '⇧').replace('Alt', '⌥')
    .replace(/\+/g, '');
}

function showError(msg) {
  let el = document.getElementById('popupError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'popupError';
    el.style.cssText = 'margin:0 14px 12px;padding:8px 12px;background:rgba(203,84,87,0.1);border:1.5px solid rgba(203,84,87,0.3);border-radius:10px;color:#CB5457;font-size:11px;font-weight:700;';
    document.querySelector('.app').insertBefore(el, document.querySelector('.status-card'));
  }
  el.textContent = msg;
}
