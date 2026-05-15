importScripts('lib/utils.js', 'lib/storage.js', 'lib/idb.js');

const {
  HARD_STOP_MS,
  RETRY_ALARM_NAME,
  addDays,
  buildTaskEventId,
  detectMeetingTool,
  extractJson,
  formatDate,
  isOauthClientConfigured,
  meetingTitleFallback,
  nowIso,
  uuid,
} = MeetingExtUtils;

const {
  deleteMeeting,
  ensureAccessLevel,
  getMeeting,
  getRuntimeState,
  getSettings,
  patchMeeting,
  patchRuntimeState,
  patchTask,
  replaceMeetingTasks,
  saveSettings,
  tasksByMeeting,
  upsertMeeting,
} = MeetingExtStorage;

const {
  clearMeetingData,
  getArtifact,
  listMeetingChunks,
  putChunk,
  saveArtifact,
} = MeetingExtDB;

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar.events',
];

const ICON_URL = chrome.runtime.getURL('icons/icon128.png');
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;

const chunkQueues = new Map();
const writeLocks = new Set();

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAccessLevel();
  try {
    await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
  } catch (_) {}
  await chrome.alarms.create(RETRY_ALARM_NAME, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAccessLevel();
  await chrome.alarms.create(RETRY_ALARM_NAME, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM_NAME) {
    processRetryQueue().catch((error) => console.error('retry queue error', error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'START_RECORDING':
        sendResponse(await handleStartRecording(message));
        return;
      case 'STOP_RECORDING':
        sendResponse(await handleStopRecording());
        return;
      case 'OPEN_SIDE_PANEL':
        try { await chrome.sidePanel.open({ windowId: message.windowId }); } catch (_) {}
        sendResponse({ ok: true });
        return;
      case 'OPEN_REPORT':
        await chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
        sendResponse({ ok: true });
        return;
      case 'OPEN_SETTINGS':
        await chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_RECORDING_STARTED':
        await patchMeeting(message.meetingId, {
          state: 'recording',
          startedAt: message.startedAt,
          micMissing: !!message.micMissing,
        });
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_CHUNK_READY':
        await handleChunkReady(message);
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_RECORDING_STOPPED':
        await handleRecordingStopped(message);
        sendResponse({ ok: true });
        return;
      case 'PROVISION_GOOGLE':
        sendResponse(await provisionGoogleResources());
        return;
      case 'APPROVE_TASK':
        await patchTask(message.taskUuid, { status: 'approved', approvedAt: nowIso() });
        sendResponse({ ok: true });
        return;
      case 'SKIP_TASK':
        await patchTask(message.taskUuid, { status: 'skipped' });
        sendResponse({ ok: true });
        return;
      case 'UPDATE_TASK':
        await patchTask(message.taskUuid, message.patch || {});
        sendResponse({ ok: true });
        return;
      case 'SELECT_MEETING':
        await patchRuntimeState({ selectedMeetingId: message.meetingId });
        sendResponse({ ok: true });
        return;
      case 'STRUCTURE_MEETING':
        await structureMeeting(message.meetingId, true);
        sendResponse({ ok: true });
        return;
      case 'WRITE_OUTPUTS':
        await writeOutputs(message.meetingId, true);
        sendResponse({ ok: true });
        return;
      case 'APPROVE_ALL_AND_WRITE':
        await approveAllTasks(message.meetingId);
        await writeOutputs(message.meetingId, true);
        sendResponse({ ok: true });
        return;
      case 'RETRY_MEETING':
        await retryMeeting(message.meetingId);
        sendResponse({ ok: true });
        return;
      case 'CLEAR_REAUTH':
        await patchRuntimeState({ reauthRequired: false });
        sendResponse({ ok: true });
        return;
      case 'DELETE_MEETING':
        await deleteMeeting(message.meetingId);
        await clearMeetingData(message.meetingId);
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, error: 'unknown-message' });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleStartRecording(message) {
  const settings = await getSettings();
  const issues = MeetingExtStorage.getSetupIssues(settings);
  if (issues.length) throw new Error(issues[0]);

  const runtime = await getRuntimeState();
  if (runtime.recordingLockMeetingId) {
    throw new Error('録音中のため開始できません');
  }

  const meetingId = uuid();
  const tool = detectMeetingTool(message.tabUrl);
  const baseTitle = (message.title || '').trim() || meetingTitleFallback(message.tabTitle, tool);
  const meeting = {
    meetingId,
    state: 'recording',
    startedAt: nowIso(),
    endedAt: null,
    tabUrl: message.tabUrl || '',
    tabTitle: message.tabTitle || '',
    tool,
    title: baseTitle,
    transcriptDocId: '',
    minutesDocId: '',
    transcriptDocUrl: '',
    minutesDocUrl: '',
    ledgerRowIndex: null,
    error: '',
    pendingTranscriptions: 0,
    chunkCount: 0,
    failedChunkCount: 0,
    stopRequested: false,
    hardStop: false,
    taskCount: 0,
    approvedCount: 0,
    micMissing: false,
    updatedAt: nowIso(),
  };

  await upsertMeeting(meeting);
  await saveArtifact(meetingId, {
    meetingId,
    transcriptText: '',
    transcriptSegments: [],
    failedChunks: [],
    minutesJson: null,
  });

  // lock を立てる前にオフスクリーン側を起動。失敗したらメタデータごとロールバック。
  try {
    await ensureOffscreenDocument();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId });
    if (!streamId) throw new Error('タブ音声の取得に失敗しました（このタブはキャプチャ非対応の可能性）');
    const ack = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'START_RECORDING',
      meetingId,
      streamId,
      hardStopMs: HARD_STOP_MS,
    });
    if (!ack || ack.ok !== true) {
      throw new Error(ack?.error || 'オフスクリーン録音の起動に失敗しました');
    }
  } catch (error) {
    await rollbackFailedStart(meetingId);
    throw error;
  }

  // オフスクリーンが ack を返したのでここで lock を確定する
  await patchRuntimeState({
    activeMeetingId: meetingId,
    recordingLockMeetingId: meetingId,
    selectedMeetingId: meetingId,
  });

  if (settings.autoOpenSidePanel && message.windowId) {
    try { await chrome.sidePanel.open({ windowId: message.windowId }); } catch (_) {}
  }

  return { ok: true, meetingId };
}

async function rollbackFailedStart(meetingId) {
  try {
    await deleteMeeting(meetingId);
    await clearMeetingData(meetingId);
  } catch (_) {}
  const runtime = await getRuntimeState();
  const patch = {};
  if (runtime.recordingLockMeetingId === meetingId) patch.recordingLockMeetingId = null;
  if (runtime.activeMeetingId === meetingId) patch.activeMeetingId = null;
  if (runtime.selectedMeetingId === meetingId) patch.selectedMeetingId = null;
  if (Object.keys(patch).length) await patchRuntimeState(patch);
}

async function handleStopRecording() {
  const runtime = await getRuntimeState();
  if (!runtime.recordingLockMeetingId) {
    throw new Error('録音中ではありません');
  }
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'STOP_RECORDING',
    reason: 'manual',
  });
  return { ok: true };
}

async function ensureOffscreenDocument() {
  const path = 'offscreen.html';
  const offscreenUrl = chrome.runtime.getURL(path);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['USER_MEDIA'],
    justification: 'Meeting audio recording via chrome.tabCapture and microphone',
  });
}

async function handleChunkReady(message) {
  await enqueueChunkForTranscription(message, { persist: true, incrementCount: true });
}

async function transcribeChunk(message) {
  const settings = await getSettings();
  const result = await transcribeWithLocalWhisper(message.blob, settings, message.mimeType);
  const artifact = await loadArtifactWithDefaults(message.meetingId);
  const prefix = `[${message.sourceLabel.toUpperCase()} ${formatDate(message.startedAt)} ${message.startedAt.slice(11, 16)}]\n`;
  const segment = {
    segmentId: uuid(),
    chunkIndex: message.chunkIndex,
    sourceLabel: message.sourceLabel,
    text: (result.text || '').trim(),
    startedAt: message.startedAt,
    endedAt: message.endedAt,
  };
  const nextFailed = (artifact.failedChunks || []).filter(
    (item) => !(item.chunkIndex === message.chunkIndex && item.sourceLabel === message.sourceLabel),
  );
  await saveArtifact(message.meetingId, {
    transcriptSegments: [...(artifact.transcriptSegments || []), segment],
    transcriptText: `${artifact.transcriptText || ''}${prefix}${segment.text}\n\n`,
    failedChunks: nextFailed,
  });

  const meeting = await getMeeting(message.meetingId);
  if (!meeting) return;
  const pending = Math.max(0, (meeting.pendingTranscriptions || 1) - 1);
  await patchMeeting(message.meetingId, {
    pendingTranscriptions: pending,
    transcriptUpdatedAt: nowIso(),
  });

  if (meeting.stopRequested && pending === 0) {
    await onTranscriptionQueueDrained(message.meetingId);
  }
}

async function registerChunkFailure(message, error) {
  const artifact = await loadArtifactWithDefaults(message.meetingId);
  const failedChunks = [
    ...(artifact.failedChunks || []).filter(
      (item) => !(item.chunkIndex === message.chunkIndex && item.sourceLabel === message.sourceLabel),
    ),
    {
      chunkIndex: message.chunkIndex,
      sourceLabel: message.sourceLabel,
      startedAt: message.startedAt,
      endedAt: message.endedAt,
      reason: error.message || String(error),
    },
  ];
  await saveArtifact(message.meetingId, { failedChunks });

  const meeting = await getMeeting(message.meetingId);
  if (!meeting) return;
  const pending = Math.max(0, (meeting.pendingTranscriptions || 1) - 1);
  await patchMeeting(message.meetingId, {
    pendingTranscriptions: pending,
    failedChunkCount: failedChunks.length,
    error: error.message || String(error),
    state: meeting.stopRequested ? 'transcribing_failed' : meeting.state,
  });
  if (meeting.stopRequested) {
    await notify('文字起こしに失敗', error.message || String(error));
  }
  if (meeting.stopRequested && pending === 0) {
    await onTranscriptionQueueDrained(message.meetingId);
  }
}

async function handleRecordingStopped(message) {
  const meeting = await getMeeting(message.meetingId);
  if (!meeting) return;

  await patchMeeting(message.meetingId, {
    endedAt: message.endedAt,
    stopRequested: true,
    hardStop: message.reason === 'hard-stop' || meeting.hardStop || false,
    state: 'transcribing',
  });
  await patchRuntimeState({
    recordingLockMeetingId: null,
    activeMeetingId: message.meetingId,
    selectedMeetingId: message.meetingId,
  });

  if (message.reason === 'hard-stop') {
    await notify('120分で自動停止しました', '長時間録音は手動で新規録音セッションとして再開してください。');
  } else if (message.reason === 'tab-ended') {
    await notify('録音タブが閉じられました', '取得済みのチャンクで処理を続行します。');
  }

  const latest = await getMeeting(message.meetingId);
  if ((latest?.pendingTranscriptions || 0) === 0) {
    await onTranscriptionQueueDrained(message.meetingId);
  }
}

async function onTranscriptionQueueDrained(meetingId) {
  const meeting = await getMeeting(meetingId);
  if (!meeting) return;
  if ((meeting.failedChunkCount || 0) > 0) {
    await patchMeeting(meetingId, { state: 'transcribing_failed' });
    await notify('失敗チャンクがあります', 'Report または Side Panel から再実行できます。');
    await enqueueRetry({ kind: 'transcribe', meetingId });
    return;
  }
  await structureMeeting(meetingId, false).catch(async (error) => {
    await enqueueRetry({ kind: 'structure', meetingId });
    console.error('structure failed', error);
  });
}

async function structureMeeting(meetingId, manualTrigger) {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error('meeting not found');
  const artifact = await getArtifact(meetingId);
  if (!artifact?.transcriptText?.trim()) {
    throw new Error('文字起こしが空です');
  }

  await patchMeeting(meetingId, { state: 'structuring', error: '' });

  try {
    const settings = await getSettings();
    const minutesJson = await structureWithGemini(artifact.transcriptText, meeting, settings);
    await saveArtifact(meetingId, { minutesJson });

    const tasks = (minutesJson.tasks || []).map((task) => ({
      taskUuid: task.task_uuid || uuid(),
      meetingId,
      title: task.title || 'Untitled task',
      owner: task.owner || '',
      due: task.due || '',
      estimateMinutes: Number(task.estimate_minutes || 0) || 0,
      context: task.context || '',
      status: settings.approvalMode === 'auto' ? 'approved' : 'pending',
      calendarEventId: '',
      approvedAt: settings.approvalMode === 'auto' ? nowIso() : '',
      insertedAt: '',
      completedAt: '',
      updatedAt: nowIso(),
    }));

    await replaceMeetingTasks(meetingId, tasks);
    const autoApprove = settings.approvalMode === 'auto' || tasks.length === 0;
    await patchMeeting(meetingId, {
      title: minutesJson.title || meeting.title,
      taskCount: tasks.length,
      approvedCount: settings.approvalMode === 'auto' ? tasks.length : 0,
      state: autoApprove ? 'writing_docs' : 'awaiting_approval',
    });

    if (autoApprove) {
      await writeOutputs(meetingId, false);
    } else if (manualTrigger) {
      await notify('議事録を構造化しました', 'Side Panel でタスクを承認してください。');
    }
  } catch (error) {
    await patchMeeting(meetingId, {
      state: 'structuring_failed',
      error: error.message || String(error),
    });
    await notify('議事録構造化に失敗', error.message || String(error));
    await enqueueRetry({ kind: 'structure', meetingId });
    throw error;
  }
}

async function approveAllTasks(meetingId) {
  const tasks = await tasksByMeeting(meetingId);
  await Promise.all(tasks.map((task) => patchTask(task.taskUuid, {
    status: task.status === 'skipped' ? 'skipped' : 'approved',
    approvedAt: task.status === 'skipped' ? task.approvedAt : nowIso(),
  })));
  const approved = (await tasksByMeeting(meetingId)).filter((task) => task.status === 'approved').length;
  await patchMeeting(meetingId, { approvedCount: approved });
}

async function writeOutputs(meetingId, manualTrigger) {
  if (writeLocks.has(meetingId)) return;
  writeLocks.add(meetingId);

  try {
    let meeting = await getMeeting(meetingId);
    let artifact = await getArtifact(meetingId);
    const settings = await getSettings();
    let tasks = await tasksByMeeting(meetingId);

    if (!artifact?.minutesJson) {
      if (manualTrigger) {
        await structureMeeting(meetingId, true);
        meeting = await getMeeting(meetingId);
        artifact = await getArtifact(meetingId);
        tasks = await tasksByMeeting(meetingId);
      } else {
        throw new Error('議事録 JSON がまだありません');
      }
    }

    await patchMeeting(meetingId, { state: 'writing_docs', error: '' });
    const ready = await ensureGoogleResources(settings);
    const transcriptDoc = await ensureTranscriptDoc(meeting, artifact, ready.folderId);
    const minutesDoc = await ensureMinutesDoc(meeting, artifact, ready.folderId);

    await patchMeeting(meetingId, {
      transcriptDocId: transcriptDoc.id,
      minutesDocId: minutesDoc.id,
      transcriptDocUrl: transcriptDoc.webViewLink || '',
      minutesDocUrl: minutesDoc.webViewLink || '',
      state: 'writing_calendar',
    });

    const approvedTasks = tasks.filter((task) => task.status === 'approved');
    for (const task of approvedTasks) {
      const eventId = await ensureCalendarEvent(
        ready.calendarId,
        task,
        meeting,
        minutesDoc.webViewLink || transcriptDoc.webViewLink || '',
      );
      await patchTask(task.taskUuid, {
        status: 'inserted',
        calendarEventId: eventId,
        insertedAt: nowIso(),
      });
    }

    await patchMeeting(meetingId, { state: 'writing_sheets' });
    await ensureMeetingLedgerRow(ready.spreadsheetId, meetingId);
    await ensureTaskLedgerRows(ready.spreadsheetId, meetingId);
    await patchMeeting(meetingId, { state: 'done', error: '' });
    await notify('Google への書き込みが完了', `${meeting.title} を Docs / Calendar / Sheets に記録しました。`);
  } catch (error) {
    const meeting = await getMeeting(meetingId);
    const failedState = inferWriteFailedState(meeting?.state);
    await patchMeeting(meetingId, {
      state: failedState,
      error: error.message || String(error),
    });
    if (error?.code === 'reauth-required') {
      await notify('Google 再認証が必要です', 'Settings から認証ボタンを押し直してください。');
    } else {
      await notify('Google 書き込みに失敗', error.message || String(error));
    }
    await enqueueRetry({ kind: 'write', meetingId });
    throw error;
  } finally {
    writeLocks.delete(meetingId);
  }
}

function inferWriteFailedState(state) {
  if (state === 'writing_calendar') return 'writing_calendar_failed';
  if (state === 'writing_sheets') return 'writing_sheets_failed';
  return 'writing_docs_failed';
}

async function retryMeeting(meetingId) {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error('meeting not found');
  if (meeting.state === 'transcribing_failed') {
    const artifact = await getArtifact(meetingId);
    const failed = artifact?.failedChunks || [];
    const chunks = await listMeetingChunks(meetingId);
    await saveArtifact(meetingId, { failedChunks: [] });
    await patchMeeting(meetingId, { failedChunkCount: 0, state: 'transcribing', error: '' });
    for (const chunkMeta of failed) {
      const chunk = chunks.find((item) => item.chunkIndex === chunkMeta.chunkIndex && item.sourceLabel === chunkMeta.sourceLabel);
      if (chunk) await enqueueChunkForTranscription(chunk, { persist: false, incrementCount: false });
    }
    const latest = await getMeeting(meetingId);
    if ((latest?.pendingTranscriptions || 0) === 0) await onTranscriptionQueueDrained(meetingId);
    return;
  }
  if (meeting.state === 'structuring_failed') {
    await structureMeeting(meetingId, true);
    return;
  }
  if ((meeting.state || '').startsWith('writing_')) {
    await writeOutputs(meetingId, true);
  }
}

async function transcribeWithLocalWhisper(blob, settings, mimeType) {
  const baseUrl = (settings.whisperServerUrl || 'http://127.0.0.1:9000').replace(/\/+$/, '');
  const form = new FormData();
  const ext = mimeType?.includes('mp4') ? 'mp4' : 'webm';
  form.append('file', blob, `chunk.${ext}`);
  if (settings.whisperLanguage) form.append('language', settings.whisperLanguage);

  let response;
  try {
    response = await fetch(`${baseUrl}/transcribe`, { method: 'POST', body: form });
  } catch (error) {
    throw new Error(`ローカル whisper サーバに接続できません (${baseUrl}): ${error.message || error}. install.sh は実行済みですか？`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`whisper サーバ失敗 (${response.status}): ${text.slice(0, 300)}`);
  }
  const json = await response.json();
  return { text: json.text || '' };
}

async function enqueueChunkForTranscription(message, options) {
  const { persist, incrementCount } = options || {};

  if (persist) {
    const chunkId = `${message.meetingId}:${message.sourceLabel}:${message.chunkIndex}`;
    await putChunk({
      id: chunkId,
      meetingId: message.meetingId,
      sourceLabel: message.sourceLabel,
      chunkIndex: message.chunkIndex,
      blob: message.blob,
      mimeType: message.mimeType,
      startedAt: message.startedAt,
      endedAt: message.endedAt,
      createdAt: nowIso(),
    });
  }

  const meeting = await getMeeting(message.meetingId);
  if (!meeting) return;

  await patchMeeting(message.meetingId, {
    chunkCount: incrementCount ? (meeting.chunkCount || 0) + 1 : meeting.chunkCount || 0,
    pendingTranscriptions: (meeting.pendingTranscriptions || 0) + 1,
    error: '',
  });

  let queue = chunkQueues.get(message.meetingId) || Promise.resolve();
  queue = queue
    .then(() => transcribeChunk(message))
    .catch(async (error) => {
      await registerChunkFailure(message, error);
    });
  const trackedQueue = queue.finally(() => {
    if (chunkQueues.get(message.meetingId) === trackedQueue) {
      chunkQueues.delete(message.meetingId);
    }
  });
  chunkQueues.set(message.meetingId, trackedQueue);
}

async function structureWithGemini(transcriptText, meeting, settings) {
  if (!settings.geminiApiKey) {
    throw new Error('Gemini API キーが未設定です（Google AI Studio で発行 → Settings に登録）');
  }

  const prompt = [
    '以下の会議文字起こしから、JSON のみを返してください。',
    'キーは title, summary_paragraphs, decisions, improvements, tasks とします。',
    'tasks は配列で、各要素は task_uuid, title, owner, due, estimate_minutes, context を持たせてください。',
    'due は YYYY-MM-DD 形式（不明なら空文字）、estimate_minutes は数値、task_uuid は UUID 形式にしてください。',
    '余計な前置き、Markdown、コードブロックは禁止です。',
    '',
    `会議タイトル候補: ${meeting.title}`,
    '',
    '文字起こし:',
    transcriptText,
  ].join('\n');

  const model = settings.geminiModel || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API 失敗 (${response.status}): ${text.slice(0, 300)}`);
  }

  const json = await response.json();
  const candidate = json.candidates?.[0];
  if (!candidate) throw new Error('Gemini 応答に candidates が含まれていません');
  const text = (candidate.content?.parts || [])
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n');
  if (!text.trim()) throw new Error('Gemini 応答が空でした');

  const parsed = extractJson(text);

  return {
    title: parsed.title || meeting.title,
    summaryParagraphs: parsed.summary_paragraphs || parsed.summaryParagraphs || [],
    decisions: parsed.decisions || [],
    improvements: parsed.improvements || [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
  };
}

// ───── Google OAuth: 401 自動リトライ付き ─────

function getAuthTokenAsync(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: GOOGLE_SCOPES }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error('Google 認証トークンを取得できませんでした'));
      } else {
        resolve(token);
      }
    });
  });
}

function removeCachedTokenAsync(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function getGoogleToken({ allowInteractive = true } = {}) {
  if (!isOauthClientConfigured()) {
    throw new Error('manifest.json の oauth2.client_id を設定してください');
  }
  try {
    return await getAuthTokenAsync(false);
  } catch (silentError) {
    if (!allowInteractive) throw silentError;
    return await getAuthTokenAsync(true);
  }
}

async function callGoogle({ method, url, body, isJson = true, expectBlob = false, allowInteractive = false }) {
  const attempt = async (interactive) => {
    const token = await getGoogleToken({ allowInteractive: interactive });
    const headers = { Authorization: `Bearer ${token}` };
    if (isJson && body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? (isJson ? JSON.stringify(body) : body) : undefined,
    });
    return { token, response };
  };

  let token;
  let response;
  try {
    ({ token, response } = await attempt(allowInteractive));
  } catch (silentError) {
    if (allowInteractive) throw silentError;
    // 初回トークン取得不可（未認証）。対話的認証は明示的に許可された経路でのみ。
    const error = new Error('Google 再認証が必要です。Settings から再ログインしてください。');
    error.code = 'reauth-required';
    await patchRuntimeState({ reauthRequired: true });
    throw error;
  }

  if (response.status === 401) {
    await removeCachedTokenAsync(token);
    try {
      ({ token, response } = await attempt(allowInteractive));
    } catch (_) {
      const error = new Error('Google 再認証が必要です。Settings から再ログインしてください。');
      error.code = 'reauth-required';
      await patchRuntimeState({ reauthRequired: true });
      throw error;
    }
    if (response.status === 401) {
      const error = new Error('Google 再認証が必要です。Settings から再ログインしてください。');
      error.code = 'reauth-required';
      await patchRuntimeState({ reauthRequired: true });
      throw error;
    }
  }

  if (response.status === 409) return { status: 409, body: null };

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google API ${response.status}: ${text.slice(0, 300)}`);
  }

  if (response.status === 204) return { status: 204, body: null };
  if (expectBlob) return { status: response.status, body: await response.blob() };
  return { status: response.status, body: isJson ? await response.json() : await response.text() };
}

async function googleJson(method, url, body, options = {}) {
  const { body: json } = await callGoogle({ method, url, body, ...options });
  return json;
}

async function provisionGoogleResources() {
  // 設定画面の認証ボタンからの呼び出し。ユーザー操作なので対話的認証を許可する。
  const settings = await getSettings();
  const ready = await ensureGoogleResources(settings, { allowInteractive: true });
  await patchRuntimeState({ reauthRequired: false });
  return { ok: true, ...ready };
}

async function ensureGoogleResources(settings, options = {}) {
  let folderId = settings.docsFolderId;
  let spreadsheetId = settings.spreadsheetId;
  const calendarId = settings.calendarId || 'primary';

  if (!folderId) {
    const folder = await googleJson('POST', 'https://www.googleapis.com/drive/v3/files?fields=id,name', {
      mimeType: 'application/vnd.google-apps.folder',
      name: 'Meeting Extension',
    }, options);
    folderId = folder.id;
  }

  if (!spreadsheetId) {
    const sheet = await googleJson('POST', 'https://sheets.googleapis.com/v4/spreadsheets', {
      properties: { title: 'Meeting Extension Ledger' },
      sheets: [
        { properties: { title: 'meetings_log' } },
        { properties: { title: 'tasks_log' } },
      ],
    }, options);
    spreadsheetId = sheet.spreadsheetId;
    await googleJson(
      'PUT',
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('meetings_log!A1')}?valueInputOption=RAW`,
      {
        values: [[
          'meeting_uuid', 'date', 'title', 'duration_min', 'tool',
          'transcript_url', 'minutes_url', 'task_count', 'approved_count', 'status',
        ]],
      },
      options,
    );
    await googleJson(
      'PUT',
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('tasks_log!A1')}?valueInputOption=RAW`,
      {
        values: [[
          'task_uuid', 'meeting_uuid', 'title', 'owner', 'due',
          'status', 'event_id', 'completed_at',
        ]],
      },
      options,
    );
    // フォルダ内に移動
    try {
      const drv = await googleJson('GET', `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=id,parents`, undefined, options);
      const previousParents = (drv.parents || []).join(',');
      await googleJson(
        'PATCH',
        `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${encodeURIComponent(folderId)}${previousParents ? `&removeParents=${encodeURIComponent(previousParents)}` : ''}&fields=id,parents`,
        {},
        options,
      );
    } catch (_) {
      // フォルダ移動の失敗は致命でないので握りつぶす
    }
  }

  await saveSettings({
    ...settings,
    docsFolderId: folderId,
    spreadsheetId,
    calendarId,
  });
  return { folderId, spreadsheetId, calendarId };
}

async function findExistingDoc(meetingId, kind) {
  const q = encodeURIComponent(
    `appProperties has { key='meeting_uuid' and value='${meetingId}' } and ` +
    `appProperties has { key='doc_kind' and value='${kind}' } and trashed=false`,
  );
  const response = await googleJson('GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)`);
  return response.files?.[0] || null;
}

async function ensureTranscriptDoc(meeting, artifact, folderId) {
  const existing = await findExistingDoc(meeting.meetingId, 'transcript');
  if (existing) return existing;
  const created = await googleJson('POST', 'https://docs.googleapis.com/v1/documents', {
    title: `[文字起こし] ${formatDate(meeting.startedAt)} ${meeting.title}`,
  });
  await googleJson('POST', `https://docs.googleapis.com/v1/documents/${created.documentId}:batchUpdate`, {
    requests: [{ insertText: { location: { index: 1 }, text: artifact.transcriptText || '' } }],
  });
  return await attachDriveMetadata(created.documentId, folderId, meeting.meetingId, 'transcript');
}

async function ensureMinutesDoc(meeting, artifact, folderId) {
  const existing = await findExistingDoc(meeting.meetingId, 'minutes');
  if (existing) return existing;
  const created = await googleJson('POST', 'https://docs.googleapis.com/v1/documents', {
    title: `[議事録] ${formatDate(meeting.startedAt)} ${meeting.title}`,
  });
  await googleJson('POST', `https://docs.googleapis.com/v1/documents/${created.documentId}:batchUpdate`, {
    requests: [{ insertText: { location: { index: 1 }, text: buildMinutesText(artifact.minutesJson) } }],
  });
  return await attachDriveMetadata(created.documentId, folderId, meeting.meetingId, 'minutes');
}

async function attachDriveMetadata(fileId, folderId, meetingId, kind) {
  return await googleJson(
    'PATCH',
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${encodeURIComponent(folderId)}&fields=id,webViewLink`,
    { appProperties: { meeting_uuid: meetingId, doc_kind: kind } },
  );
}

function buildMinutesText(minutesJson) {
  const sections = [];
  sections.push(minutesJson.title || 'Meeting Minutes');
  sections.push('');
  sections.push('Summary');
  sections.push(...(minutesJson.summaryParagraphs || []), '');
  sections.push('Decisions');
  if ((minutesJson.decisions || []).length) {
    minutesJson.decisions.forEach((item) => sections.push(`- ${item}`));
  } else {
    sections.push('- なし');
  }
  sections.push('', 'Improvements');
  if ((minutesJson.improvements || []).length) {
    minutesJson.improvements.forEach((item) => sections.push(`- ${item}`));
  } else {
    sections.push('- なし');
  }
  sections.push('', 'Tasks');
  if ((minutesJson.tasks || []).length) {
    minutesJson.tasks.forEach((task) => {
      sections.push(`- ${task.title} / owner: ${task.owner || '-'} / due: ${task.due || '-'} / estimate: ${task.estimate_minutes || 0}m`);
      if (task.context) sections.push(`  context: ${task.context}`);
    });
  } else {
    sections.push('- なし');
  }
  return sections.join('\n');
}

async function ensureCalendarEvent(calendarId, task, meeting, docUrl) {
  const eventId = buildTaskEventId(task.taskUuid);
  const dueDate = task.due ? new Date(task.due) : addDays(meeting.endedAt || nowIso(), 1);
  const startDate = formatDate(dueDate);
  const endDate = formatDate(addDays(dueDate, 1));
  const body = {
    id: eventId,
    summary: task.title,
    description: `${task.context || ''}\n\nMeeting: ${meeting.title}\n${docUrl || ''}`.trim(),
    start: { date: startDate },
    end: { date: endDate },
  };
  const { status, body: json } = await callGoogle({
    method: 'POST',
    url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    body,
  });
  if (status === 409) return eventId;
  return json?.id || eventId;
}

async function getSheetColumnValues(spreadsheetId, range) {
  const result = await googleJson('GET', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  return result.values || [];
}

async function appendSheetRow(spreadsheetId, range, row) {
  await googleJson(
    'POST',
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [row] },
  );
}

async function ensureMeetingLedgerRow(spreadsheetId, meetingId) {
  const meeting = await getMeeting(meetingId);
  const values = await getSheetColumnValues(spreadsheetId, 'meetings_log!A:A');
  if (values.some((row) => row[0] === meetingId)) return;
  const startedAt = new Date(meeting.startedAt);
  const endedAt = new Date(meeting.endedAt || meeting.startedAt);
  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  await appendSheetRow(spreadsheetId, 'meetings_log!A:J', [
    meetingId,
    formatDate(meeting.startedAt),
    meeting.title,
    Math.round(durationMs / 60000),
    meeting.tool,
    meeting.transcriptDocUrl || '',
    meeting.minutesDocUrl || '',
    meeting.taskCount || 0,
    meeting.approvedCount || 0,
    meeting.state,
  ]);
}

async function ensureTaskLedgerRows(spreadsheetId, meetingId) {
  const rows = await getSheetColumnValues(spreadsheetId, 'tasks_log!A:A');
  const existing = new Set(rows.map((row) => row[0]).filter(Boolean));
  const tasks = await tasksByMeeting(meetingId);
  for (const task of tasks) {
    if (existing.has(task.taskUuid)) continue;
    await appendSheetRow(spreadsheetId, 'tasks_log!A:H', [
      task.taskUuid,
      task.meetingId,
      task.title,
      task.owner || '',
      task.due || '',
      task.status,
      task.calendarEventId || '',
      task.completedAt || '',
    ]);
  }
}

async function loadArtifactWithDefaults(meetingId) {
  const artifact = await getArtifact(meetingId);
  return artifact || {
    meetingId,
    transcriptText: '',
    transcriptSegments: [],
    failedChunks: [],
    minutesJson: null,
  };
}

async function notify(title, message) {
  const settings = await getSettings();
  if (settings.notifyOnFailure === false && /失敗|エラー/.test(title)) return;
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: ICON_URL,
      title,
      message: String(message || '').slice(0, 200),
    });
  } catch (_) {}
}

// ───── 永続リトライキュー（chrome.alarms） ─────

async function getRetryQueue() {
  const result = await chrome.storage.local.get('retryQueue');
  return Array.isArray(result.retryQueue) ? result.retryQueue : [];
}

async function saveRetryQueue(queue) {
  await chrome.storage.local.set({ retryQueue: queue || [] });
}

async function enqueueRetry(item) {
  const queue = await getRetryQueue();
  const existing = queue.find((entry) => entry.kind === item.kind && entry.meetingId === item.meetingId);
  if (existing) {
    existing.attempts = (existing.attempts || 0) + 1;
    existing.nextAt = Date.now() + retryBackoff(existing.attempts);
    existing.error = item.error || existing.error || '';
  } else {
    queue.push({
      kind: item.kind,
      meetingId: item.meetingId,
      attempts: 1,
      nextAt: Date.now() + RETRY_BASE_MS,
      enqueuedAt: nowIso(),
      error: item.error || '',
    });
  }
  await saveRetryQueue(queue);
}

function retryBackoff(attempts) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

async function processRetryQueue() {
  const queue = await getRetryQueue();
  if (!queue.length) return;
  const now = Date.now();
  const due = queue.filter((entry) => entry.nextAt <= now);
  if (!due.length) return;

  const remaining = queue.filter((entry) => !due.includes(entry));
  await saveRetryQueue(remaining);

  for (const entry of due) {
    try {
      await runRetry(entry);
    } catch (error) {
      await enqueueRetry({ ...entry, attempts: (entry.attempts || 1) + 1, error: error.message || String(error) });
    }
  }
}

async function runRetry(entry) {
  const meeting = await getMeeting(entry.meetingId);
  if (!meeting) return;
  if (entry.kind === 'transcribe') {
    if (meeting.state === 'transcribing_failed') await retryMeeting(entry.meetingId);
    return;
  }
  if (entry.kind === 'structure') {
    if (meeting.state === 'structuring_failed' || meeting.state === 'transcribing') {
      await structureMeeting(entry.meetingId, false);
    }
    return;
  }
  if (entry.kind === 'write') {
    if ((meeting.state || '').startsWith('writing_')) {
      await writeOutputs(entry.meetingId, true);
    }
  }
}
