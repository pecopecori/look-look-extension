(function () {
  const { browserTz, isOauthClientConfigured, nowIso } = globalThis.MeetingExtUtils;

  const DEFAULT_SETTINGS = {
    docsFolderId: '',
    spreadsheetId: '',
    calendarId: 'primary',
    whisperServerUrl: 'http://127.0.0.1:9000',
    whisperLanguage: 'ja',
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash',
    timezone: browserTz(),
    approvalMode: 'manual',
    autoOpenSidePanel: true,
    notifyOnFailure: true,
  };

  const DEFAULT_RUNTIME = {
    activeMeetingId: null,
    recordingLockMeetingId: null,
    selectedMeetingId: null,
    reauthRequired: false,
  };

  let accessLevelEnsured = false;

  async function ensureAccessLevel() {
    if (accessLevelEnsured) return;
    try {
      if (chrome.storage?.local?.setAccessLevel) {
        await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      }
    } catch (_) {
      // 既に設定済み or 未対応バージョン
    } finally {
      accessLevelEnsured = true;
    }
  }

  async function getSettings() {
    await ensureAccessLevel();
    const result = await chrome.storage.local.get('settings');
    return {
      ...DEFAULT_SETTINGS,
      ...(result.settings || {}),
    };
  }

  async function saveSettings(settings) {
    await ensureAccessLevel();
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } });
  }

  async function getRuntimeState() {
    await ensureAccessLevel();
    const result = await chrome.storage.local.get('runtimeState');
    return {
      ...DEFAULT_RUNTIME,
      ...(result.runtimeState || {}),
    };
  }

  async function saveRuntimeState(state) {
    await ensureAccessLevel();
    await chrome.storage.local.set({ runtimeState: { ...DEFAULT_RUNTIME, ...(state || {}) } });
  }

  async function patchRuntimeState(patch) {
    const current = await getRuntimeState();
    const next = { ...current, ...(patch || {}) };
    await saveRuntimeState(next);
    return next;
  }

  async function listMeetings() {
    await ensureAccessLevel();
    const result = await chrome.storage.local.get('meetings');
    return Array.isArray(result.meetings) ? result.meetings : [];
  }

  async function saveMeetings(meetings) {
    await ensureAccessLevel();
    await chrome.storage.local.set({ meetings: meetings || [] });
  }

  async function getMeeting(meetingId) {
    const meetings = await listMeetings();
    return meetings.find((meeting) => meeting.meetingId === meetingId) || null;
  }

  async function upsertMeeting(nextMeeting) {
    const meetings = await listMeetings();
    const index = meetings.findIndex((meeting) => meeting.meetingId === nextMeeting.meetingId);
    const record = {
      updatedAt: nowIso(),
      ...nextMeeting,
    };
    if (index >= 0) {
      meetings[index] = { ...meetings[index], ...record };
    } else {
      meetings.unshift(record);
    }
    await saveMeetings(meetings);
    return record;
  }

  async function patchMeeting(meetingId, patch) {
    const current = await getMeeting(meetingId);
    if (!current) throw new Error(`meeting not found: ${meetingId}`);
    return await upsertMeeting({ ...current, ...(patch || {}) });
  }

  async function deleteMeeting(meetingId) {
    const meetings = await listMeetings();
    await saveMeetings(meetings.filter((meeting) => meeting.meetingId !== meetingId));
    const tasks = await listTasks();
    await saveTasks(tasks.filter((task) => task.meetingId !== meetingId));
  }

  async function listTasks() {
    await ensureAccessLevel();
    const result = await chrome.storage.local.get('tasks');
    return Array.isArray(result.tasks) ? result.tasks : [];
  }

  async function saveTasks(tasks) {
    await ensureAccessLevel();
    await chrome.storage.local.set({ tasks: tasks || [] });
  }

  async function tasksByMeeting(meetingId) {
    const tasks = await listTasks();
    return tasks.filter((task) => task.meetingId === meetingId);
  }

  async function upsertTask(nextTask) {
    const tasks = await listTasks();
    const index = tasks.findIndex((task) => task.taskUuid === nextTask.taskUuid);
    const record = {
      updatedAt: nowIso(),
      ...nextTask,
    };
    if (index >= 0) {
      tasks[index] = { ...tasks[index], ...record };
    } else {
      tasks.push(record);
    }
    await saveTasks(tasks);
    return record;
  }

  async function patchTask(taskUuid, patch) {
    const tasks = await listTasks();
    const index = tasks.findIndex((task) => task.taskUuid === taskUuid);
    if (index < 0) throw new Error(`task not found: ${taskUuid}`);
    tasks[index] = {
      ...tasks[index],
      ...(patch || {}),
      updatedAt: nowIso(),
    };
    await saveTasks(tasks);
    return tasks[index];
  }

  async function replaceMeetingTasks(meetingId, nextTasks) {
    const tasks = await listTasks();
    const keep = tasks.filter((task) => task.meetingId !== meetingId);
    await saveTasks([...keep, ...(nextTasks || [])]);
  }

  function getSetupIssues(settings) {
    const issues = [];
    if (!isOauthClientConfigured()) {
      issues.push('manifest.json の oauth2.client_id を Google Cloud の Chrome 拡張用 OAuth Client ID に置き換えてください');
    }
    if (!settings.whisperServerUrl) {
      issues.push('faster-whisper サーバの URL を Settings から登録してください（デフォルト http://127.0.0.1:9000）');
    }
    if (!settings.geminiApiKey) {
      issues.push('Gemini API キーを Settings から登録してください（Google AI Studio で無料発行）');
    }
    return issues;
  }

  function isSetupComplete(settings) {
    return getSetupIssues(settings).length === 0;
  }

  globalThis.MeetingExtStorage = {
    DEFAULT_RUNTIME,
    DEFAULT_SETTINGS,
    deleteMeeting,
    ensureAccessLevel,
    getMeeting,
    getRuntimeState,
    getSettings,
    getSetupIssues,
    isSetupComplete,
    listMeetings,
    listTasks,
    patchMeeting,
    patchRuntimeState,
    patchTask,
    replaceMeetingTasks,
    saveMeetings,
    saveRuntimeState,
    saveSettings,
    saveTasks,
    tasksByMeeting,
    upsertMeeting,
    upsertTask,
  };
})();
