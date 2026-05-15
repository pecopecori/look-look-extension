const { CHUNK_MS, HARD_STOP_MS, nowIso } = MeetingExtUtils;

let session = null;
let monitorAudio = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return;
  (async () => {
    if (message.type === 'START_RECORDING') {
      await startRecordingSession(message);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'STOP_RECORDING') {
      await stopRecordingSession(message.reason || 'manual');
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: 'unknown-message' });
  })().catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function startRecordingSession(message) {
  if (session) throw new Error('すでに録音中です');

  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: message.streamId,
      },
    },
    video: false,
  });

  let micStream = null;
  let micMissing = false;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch (_) {
    micMissing = true;
  }

  // tabCapture はキャプチャ中ミュート扱いになるので、ユーザー側にも音を返す
  monitorAudio = new AudioContext();
  const source = monitorAudio.createMediaStreamSource(tabStream);
  source.connect(monitorAudio.destination);

  const hardStopMs = Math.max(60_000, Number(message.hardStopMs) || HARD_STOP_MS);

  session = {
    meetingId: message.meetingId,
    startedAtMs: Date.now(),
    tabStream,
    micStream,
    micMissing,
    stopped: false,
    recorders: [],
    nextChunkBySource: { tab: 0, self: 0 },
    hardStopTimer: setTimeout(() => {
      stopRecordingSession('hard-stop').catch(() => {});
    }, hardStopMs),
  };

  tabStream.getAudioTracks().forEach((track) => {
    track.onended = () => stopRecordingSession('tab-ended').catch(() => {});
  });
  if (micStream) {
    micStream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        // マイクの停止のみでは録音継続（タブ音だけになる）
      };
    });
  }

  session.recorders.push(buildRecorder('tab', tabStream));
  if (micStream) session.recorders.push(buildRecorder('self', micStream));

  session.recorders.forEach(({ recorder }) => recorder.start(CHUNK_MS));

  await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_RECORDING_STARTED',
    meetingId: session.meetingId,
    micMissing,
    startedAt: nowIso(),
  });
}

function buildRecorder(sourceLabel, stream) {
  const mimeType = pickMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const pendingSends = [];
  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0 || !session) return;
    const chunkIndex = session.nextChunkBySource[sourceLabel]++;
    const startedAt = new Date(session.startedAtMs + chunkIndex * CHUNK_MS).toISOString();
    const endedAt = new Date(Math.min(Date.now(), session.startedAtMs + (chunkIndex + 1) * CHUNK_MS)).toISOString();
    const sendPromise = chrome.runtime.sendMessage({
      type: 'OFFSCREEN_CHUNK_READY',
      meetingId: session.meetingId,
      sourceLabel,
      chunkIndex,
      mimeType: event.data.type || recorder.mimeType || 'audio/webm',
      blob: event.data,
      startedAt,
      endedAt,
    }).catch((error) => console.error('chunk send failed', error));
    pendingSends.push(sendPromise);
  };
  return { sourceLabel, recorder, stream, pendingSends };
}

async function stopRecordingSession(reason) {
  if (!session || session.stopped) return;
  session.stopped = true;

  const current = session;
  if (current.hardStopTimer) clearTimeout(current.hardStopTimer);

  // recorder.stop() は最後に ondataavailable → 'stop' の順でイベントを出すので、
  // 'stop' を待ったあと pendingSends がすべて完了するのを待つ
  await Promise.all(current.recorders.map(({ recorder }) => stopRecorder(recorder)));
  await Promise.all(current.recorders.flatMap(({ pendingSends }) => pendingSends));

  current.recorders.forEach(({ stream }) => stream.getTracks().forEach((track) => track.stop()));
  current.tabStream?.getTracks().forEach((track) => track.stop());
  current.micStream?.getTracks().forEach((track) => track.stop());
  if (monitorAudio) {
    await monitorAudio.close().catch(() => {});
    monitorAudio = null;
  }

  await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_RECORDING_STOPPED',
    meetingId: current.meetingId,
    reason,
    endedAt: nowIso(),
  });
  session = null;
}

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

function stopRecorder(recorder) {
  return new Promise((resolve) => {
    if (recorder.state === 'inactive') {
      resolve();
      return;
    }
    recorder.addEventListener('stop', () => resolve(), { once: true });
    recorder.stop();
  });
}
