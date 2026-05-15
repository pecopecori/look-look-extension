const STORAGE = globalThis.DEMO_EXT_STORAGE;

const setupCard = document.getElementById('setupCard');
const countdownCard = document.getElementById('countdownCard');
const countdownNum = document.getElementById('countdownNum');
const recordingCard = document.getElementById('recordingCard');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const pauseBtn = document.getElementById('pauseBtn');
const pauseIcon = document.getElementById('pauseIcon');
const pauseLabel = document.getElementById('pauseLabel');
const recDot = document.getElementById('recDot');
const recLabel = document.getElementById('recLabel');
const useMic = document.getElementById('useMic');
const filenamePrefix = document.getElementById('filenamePrefix');
const timerEl = document.getElementById('timer');
const errorBox = document.getElementById('errorBox');

let display = null;
let micStream = null;
let audioCtx = null;
let recorder = null;
let chunks = [];
let startedAt = 0;
let pausedAt = 0;
let totalPausedMs = 0;
let timerInterval = null;
let cancelStart = false;

bootstrap().catch((error) => {
  console.error(error);
  showError('録画設定の初期化に失敗しました');
});

startBtn.addEventListener('click', () => {
  void startRecording();
});
stopBtn.addEventListener('click', stopRecording);
pauseBtn.addEventListener('click', togglePause);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'RECORDER_STOP') {
    stopRecording();
  }
  if (msg?.type === 'RECORDER_START' && (!recorder || recorder.state === 'inactive')) {
    void startRecording();
  }
});

async function bootstrap() {
  const settings = await STORAGE.loadSettings();
  useMic.checked = settings.recorder.includeMic;
  filenamePrefix.value = settings.recorder.filenamePrefix;
  await notifyStatus('idle');

  if (new URLSearchParams(window.location.search).get('autoStart') === '1') {
    showError('録画を始めるには、このウィンドウで「録画を開始」を押してください。');
  }
}

async function startRecording() {
  hideError();
  startBtn.disabled = true;
  cancelStart = false;
  await notifyStatus('starting');

  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });
  } catch (_) {
    startBtn.disabled = false;
    await notifyStatus('idle');
    showError('画面共有がキャンセルされたか、許可されませんでした。');
    return;
  }

  if (!display.getVideoTracks().length) {
    display.getTracks().forEach((t) => t.stop());
    display = null;
    startBtn.disabled = false;
    await notifyStatus('idle');
    showError('映像を取得できませんでした。macOS の場合は「システム設定 → プライバシーとセキュリティ → 画面収録」でブラウザを許可してください。');
    return;
  }

  if (await abortIfCancelled()) return;

  if (useMic.checked) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      console.warn('マイク取得失敗。システム音声のみで続行します。', error);
    }
  }

  if (await abortIfCancelled()) return;

  let combinedStream;
  try {
    combinedStream = mixStreams(display, micStream);
  } catch (error) {
    cleanup();
    startBtn.disabled = false;
    await notifyStatus('idle');
    showError(`音声ミックスに失敗しました: ${error.message || error}`);
    return;
  }

  if (await abortIfCancelled()) return;

  try {
    const mime = pickSupportedMime();
    recorder = new MediaRecorder(combinedStream, mime ? { mimeType: mime } : undefined);
  } catch (error) {
    cleanup();
    startBtn.disabled = false;
    await notifyStatus('idle');
    showError(`MediaRecorder初期化に失敗しました: ${error.message || error}`);
    return;
  }

  if (await abortIfCancelled()) return;

  await STORAGE.saveSettings({
    recorder: {
      includeMic: useMic.checked,
      filenamePrefix: filenamePrefix.value.trim() || STORAGE.DEFAULT_SETTINGS.recorder.filenamePrefix,
    },
  });

  if (await abortIfCancelled()) return;

  // カウントダウン 3→2→1
  setupCard.classList.add('hidden');
  countdownCard.classList.remove('hidden');
  for (let n = 3; n >= 1; n--) {
    if (cancelStart) { cleanup(); resetUI(); await notifyStatus('idle'); return; }
    countdownNum.textContent = String(n);
    countdownNum.style.animation = 'none';
    void countdownNum.offsetWidth;
    countdownNum.style.animation = '';
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  countdownCard.classList.add('hidden');

  if (await abortIfCancelled()) return;

  chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    void onRecorderStop();
  };
  recorder.onerror = async (event) => {
    showError(`録画エラー: ${event.error?.message || 'unknown'}`);
    cleanup();
    resetUI();
    await notifyStatus('idle');
  };

  display.getVideoTracks()[0].onended = () => {
    if (recorder && recorder.state !== 'inactive') stopRecording();
  };

  recorder.start(1000);
  startedAt = Date.now();
  timerInterval = setInterval(updateTimer, 500);
  recordingCard.classList.remove('hidden');
  await notifyStatus('recording', startedAt);
  // 録画開始後にウィンドウを前面へ
  try { await chrome.runtime.sendMessage({ type: 'RECORDER_FOCUS' }); } catch (_) {}
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
    return;
  }
  cancelStart = true;
}

function togglePause() {
  if (!recorder) return;
  if (recorder.state === 'recording') {
    recorder.pause();
    pausedAt = Date.now();
    clearInterval(timerInterval);
    timerInterval = null;
    pauseBtn.classList.add('paused');
    pauseIcon.textContent = '▶';
    pauseLabel.textContent = '再開';
    recDot.classList.add('paused');
    recLabel.textContent = '一時停止中';
  } else if (recorder.state === 'paused') {
    recorder.resume();
    totalPausedMs += Date.now() - pausedAt;
    pausedAt = 0;
    timerInterval = setInterval(updateTimer, 500);
    pauseBtn.classList.remove('paused');
    pauseIcon.textContent = '⏸';
    pauseLabel.textContent = '一時停止';
    recDot.classList.remove('paused');
    recLabel.textContent = '録画中';
  }
}

async function abortIfCancelled() {
  if (!cancelStart) return false;
  cleanup();
  resetUI();
  await notifyStatus('idle');
  return true;
}

async function onRecorderStop() {
  const mimeType = recorder?.mimeType || 'video/webm';
  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const prefix = sanitizePrefix(filenamePrefix.value) || STORAGE.DEFAULT_SETTINGS.recorder.filenamePrefix;
  const filename = `${prefix}-${timestamp}.${extension}`;

  cleanup();
  resetUI();
  await notifyStatus('idle');

  let downloadId = null;
  try {
    downloadId = await chrome.downloads.download({ url, filename, saveAs: true });
  } catch (_) {
    // fallback: link click
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
  }

  setTimeout(() => URL.revokeObjectURL(url), 10000);

  const doneCard = document.getElementById('doneCard');
  document.getElementById('doneFilename').textContent = filename;
  doneCard.classList.remove('hidden');

  document.getElementById('showFileBtn').onclick = () => {
    if (downloadId != null) chrome.downloads.show(downloadId);
  };
  document.getElementById('newRecordBtn').onclick = () => {
    doneCard.classList.add('hidden');
  };
}

function cleanup() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (display) {
    display.getTracks().forEach((track) => track.stop());
    display = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  recorder = null;
  startedAt = 0;
  pausedAt = 0;
  totalPausedMs = 0;
}

function resetUI() {
  recordingCard.classList.add('hidden');
  countdownCard.classList.add('hidden');
  setupCard.classList.remove('hidden');
  startBtn.disabled = false;
  timerEl.textContent = '00:00';
  pauseBtn.classList.remove('paused');
  pauseIcon.textContent = '⏸';
  pauseLabel.textContent = '一時停止';
  recDot.classList.remove('paused');
  recLabel.textContent = '録画中';
}

function updateTimer() {
  const elapsed = Date.now() - startedAt - totalPausedMs;
  const sec = Math.floor(elapsed / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
}

function mixStreams(displayStream, mic) {
  const videoTrack = displayStream.getVideoTracks()[0];
  const displayAudio = displayStream.getAudioTracks();
  const micAudio = mic ? mic.getAudioTracks() : [];

  if (displayAudio.length === 0 && micAudio.length === 0) {
    return new MediaStream([videoTrack]);
  }
  if (displayAudio.length > 0 && micAudio.length === 0) {
    return new MediaStream([videoTrack, ...displayAudio]);
  }
  if (displayAudio.length === 0 && micAudio.length > 0) {
    return new MediaStream([videoTrack, ...micAudio]);
  }

  audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaStreamSource(new MediaStream(displayAudio)).connect(dest);
  audioCtx.createMediaStreamSource(new MediaStream(micAudio)).connect(dest);
  return new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);
}

function pickSupportedMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

function sanitizePrefix(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .slice(0, 80);
}

async function notifyStatus(status, started = null) {
  try {
    await chrome.runtime.sendMessage({
      type: 'RECORDER_STATUS',
      payload: { status, startedAt: started },
    });
  } catch (_) {
    // recorder window が閉じる直前は握りつぶす
  }
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}

window.addEventListener('beforeunload', () => {
  cleanup();
  void notifyStatus('idle');
});
