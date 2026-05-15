const { escapeHtml, formatDateTime, downloadBlob } = MeetingExtUtils;
let refreshTimer = null;

async function init() {
  bindEvents();
  await refresh();
  refreshTimer = setInterval(refresh, 1500);
}

function bindEvents() {
  document.getElementById('structureBtn').addEventListener('click', async () => {
    const meetingId = await currentMeetingId();
    if (!meetingId) return;
    await safeRun(() => chrome.runtime.sendMessage({ type: 'STRUCTURE_MEETING', meetingId }), '構造化を開始しました');
  });
  document.getElementById('approveWriteBtn').addEventListener('click', async () => {
    const meetingId = await currentMeetingId();
    if (!meetingId) return;
    await safeRun(() => chrome.runtime.sendMessage({ type: 'APPROVE_ALL_AND_WRITE', meetingId }), '承認して書き込みを開始しました');
  });
  document.getElementById('retryBtn').addEventListener('click', async () => {
    const meetingId = await currentMeetingId();
    if (!meetingId) return;
    await safeRun(() => chrome.runtime.sendMessage({ type: 'RETRY_MEETING', meetingId }), '再実行しました');
  });
  document.getElementById('downloadAudioBtn').addEventListener('click', downloadAudio);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
}

async function currentMeetingId() {
  const runtime = await MeetingExtStorage.getRuntimeState();
  return runtime.activeMeetingId || runtime.selectedMeetingId || null;
}

async function refresh() {
  const meetingId = await currentMeetingId();
  if (!meetingId) return renderEmpty();

  const [meeting, tasks, artifact] = await Promise.all([
    MeetingExtStorage.getMeeting(meetingId),
    MeetingExtStorage.tasksByMeeting(meetingId),
    MeetingExtDB.getArtifact(meetingId),
  ]);

  if (!meeting) return renderEmpty();

  document.getElementById('meetingTitle').textContent = meeting.title || 'Untitled Meeting';
  document.getElementById('meetingMeta').textContent = `${meeting.tool || 'other'} / ${meeting.startedAt ? formatDateTime(meeting.startedAt) : '—'} / ${meeting.state}`;
  document.getElementById('stateBadge').textContent = meeting.state || 'idle';
  document.getElementById('transcriptBox').textContent = artifact?.transcriptText?.trim() || 'まだ文字起こしはありません。';
  renderMinutes(artifact?.minutesJson);
  renderTasks(tasks);
}

function renderEmpty() {
  document.getElementById('meetingTitle').textContent = 'Meeting Extension';
  document.getElementById('meetingMeta').textContent = '録音開始後にこのパネルへ逐次文字起こしが流れます。';
  document.getElementById('stateBadge').textContent = 'idle';
  document.getElementById('transcriptBox').textContent = 'まだ文字起こしはありません。';
  document.getElementById('minutesBox').innerHTML = '録音停止後に構造化結果を表示します。';
  document.getElementById('tasksBox').innerHTML = '';
}

function renderMinutes(minutesJson) {
  const box = document.getElementById('minutesBox');
  if (!minutesJson) {
    box.innerHTML = '録音停止後に構造化結果を表示します。';
    return;
  }
  box.innerHTML = `
    <strong>${escapeHtml(minutesJson.title || 'Untitled')}</strong>
    <h3>Summary</h3>
    ${(minutesJson.summaryParagraphs || []).map((item) => `<p>${escapeHtml(item)}</p>`).join('') || '<p>なし</p>'}
    <h3>Decisions</h3>
    <ul>${(minutesJson.decisions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>なし</li>'}</ul>
    <h3>Improvements</h3>
    <ul>${(minutesJson.improvements || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>なし</li>'}</ul>
  `;
}

function renderTasks(tasks) {
  const box = document.getElementById('tasksBox');
  if (!tasks.length) {
    box.innerHTML = '<p class="task-meta">タスクはまだありません。</p>';
    return;
  }
  box.innerHTML = tasks.map((task) => `
    <article class="task" data-id="${escapeHtml(task.taskUuid)}">
      <input type="text" value="${escapeHtml(task.title)}" data-role="title">
      <div class="task-meta">
        owner: ${escapeHtml(task.owner || '-')}<br>
        due: ${escapeHtml(task.due || '-')}<br>
        status: ${escapeHtml(task.status || 'pending')}
      </div>
      <div class="task-actions">
        <button class="btn ghost" data-role="save">保存</button>
        <button class="btn ghost" data-role="approve">承認</button>
        <button class="btn ghost" data-role="skip">スキップ</button>
      </div>
    </article>
  `).join('');

  box.querySelectorAll('.task').forEach((taskEl) => {
    const taskId = taskEl.dataset.id;
    taskEl.querySelector('[data-role="save"]').addEventListener('click', () => {
      const title = taskEl.querySelector('[data-role="title"]').value.trim();
      safeRun(() => chrome.runtime.sendMessage({ type: 'UPDATE_TASK', taskUuid: taskId, patch: { title } }), 'タスクを更新しました');
    });
    taskEl.querySelector('[data-role="approve"]').addEventListener('click', () => {
      safeRun(() => chrome.runtime.sendMessage({ type: 'APPROVE_TASK', taskUuid: taskId }), '承認しました');
    });
    taskEl.querySelector('[data-role="skip"]').addEventListener('click', () => {
      safeRun(() => chrome.runtime.sendMessage({ type: 'SKIP_TASK', taskUuid: taskId }), 'スキップしました');
    });
  });
}

async function downloadAudio() {
  const meetingId = await currentMeetingId();
  if (!meetingId) return;
  const [tabChunks, selfChunks] = await Promise.all([
    MeetingExtDB.listMeetingChunksBySource(meetingId, 'tab'),
    MeetingExtDB.listMeetingChunksBySource(meetingId, 'self'),
  ]);
  if (tabChunks.length) {
    downloadBlob(`${meetingId}-tab.webm`, new Blob(tabChunks.sort(sortChunk).map((item) => item.blob), { type: tabChunks[0].mimeType || 'audio/webm' }));
  }
  if (selfChunks.length) {
    downloadBlob(`${meetingId}-self.webm`, new Blob(selfChunks.sort(sortChunk).map((item) => item.blob), { type: selfChunks[0].mimeType || 'audio/webm' }));
  }
}

async function exportJson() {
  const meetingId = await currentMeetingId();
  if (!meetingId) return;
  const [meeting, tasks, artifact] = await Promise.all([
    MeetingExtStorage.getMeeting(meetingId),
    MeetingExtStorage.tasksByMeeting(meetingId),
    MeetingExtDB.getArtifact(meetingId),
  ]);
  const blob = new Blob([JSON.stringify({ meeting, tasks, artifact }, null, 2)], { type: 'application/json' });
  downloadBlob(`${meetingId}.json`, blob);
}

function sortChunk(a, b) {
  return (a.chunkIndex || 0) - (b.chunkIndex || 0);
}

async function safeRun(fn, _message) {
  try {
    const result = await fn();
    if (result?.ok === false) throw new Error(result.error || '操作に失敗しました');
    await refresh();
  } catch (error) {
    alert(error.message || String(error));
  }
}

window.addEventListener('unload', () => clearInterval(refreshTimer));
init();
