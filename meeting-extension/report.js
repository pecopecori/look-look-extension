const { escapeHtml, formatDateTime, formatDurationShort } = MeetingExtUtils;

async function init() {
  await refresh();
}

async function refresh() {
  const meetings = await MeetingExtStorage.listMeetings();
  renderSummary(meetings);

  const list = document.getElementById('meetingList');
  if (!meetings.length) {
    list.innerHTML = '<div class="empty">まだミーティングはありません。Popup から「録音開始」を試してください。</div>';
    return;
  }

  list.innerHTML = meetings.map((meeting) => {
    const startedAt = meeting.startedAt ? formatDateTime(meeting.startedAt) : '—';
    const duration = (meeting.startedAt && meeting.endedAt)
      ? formatDurationShort(new Date(meeting.endedAt) - new Date(meeting.startedAt))
      : '—';
    const stateBadgeClass = (meeting.state || '').endsWith('_failed') ? 'badge failed' : 'badge';
    return `
    <article class="meeting" data-id="${escapeHtml(meeting.meetingId)}">
      <div class="meeting-head">
        <div>
          <h2>${escapeHtml(meeting.title || meeting.tabTitle || 'Untitled')}</h2>
          <div class="meeting-meta">
            ${escapeHtml(meeting.tool || 'other')} / ${escapeHtml(startedAt)} / 所要 ${escapeHtml(duration)}<br>
            chunks: ${meeting.chunkCount || 0} / 失敗: ${meeting.failedChunkCount || 0} / tasks: ${meeting.taskCount || 0} (approved ${meeting.approvedCount || 0})
            ${meeting.error ? `<br><span style="color: var(--pink-dk)">${escapeHtml(meeting.error)}</span>` : ''}
          </div>
        </div>
        <span class="${stateBadgeClass}">${escapeHtml(meeting.state || 'idle')}</span>
      </div>
      <div class="actions">
        <button class="btn" data-role="select">Side Panel で開く</button>
        <button class="btn" data-role="write">Google に書き込み</button>
        <button class="btn" data-role="retry">再実行</button>
        <button class="btn danger" data-role="delete">削除</button>
      </div>
      <div class="links">
        ${meeting.transcriptDocUrl ? `<a href="${escapeHtml(meeting.transcriptDocUrl)}" target="_blank" rel="noreferrer">Transcript Doc</a>` : ''}
        ${meeting.minutesDocUrl ? `<a href="${escapeHtml(meeting.minutesDocUrl)}" target="_blank" rel="noreferrer">Minutes Doc</a>` : ''}
      </div>
    </article>`;
  }).join('');

  list.querySelectorAll('.meeting').forEach((meetingEl) => {
    const meetingId = meetingEl.dataset.id;
    meetingEl.querySelector('[data-role="select"]').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'SELECT_MEETING', meetingId });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', tabId: tab.id, windowId: tab.windowId });
      }
    });
    meetingEl.querySelector('[data-role="retry"]').addEventListener('click', async () => {
      await safeRun(() => chrome.runtime.sendMessage({ type: 'RETRY_MEETING', meetingId }));
    });
    meetingEl.querySelector('[data-role="write"]').addEventListener('click', async () => {
      await safeRun(() => chrome.runtime.sendMessage({ type: 'WRITE_OUTPUTS', meetingId }));
    });
    meetingEl.querySelector('[data-role="delete"]').addEventListener('click', async () => {
      if (!confirm('このミーティングを削除します。Google 側の Docs / Calendar は残ります。よろしいですか？')) return;
      await safeRun(() => chrome.runtime.sendMessage({ type: 'DELETE_MEETING', meetingId }));
    });
  });
}

function renderSummary(meetings) {
  const box = document.getElementById('summaryBox');
  const total = meetings.length;
  const done = meetings.filter((m) => m.state === 'done').length;
  const failed = meetings.filter((m) => (m.state || '').endsWith('_failed')).length;
  const totalTasks = meetings.reduce((s, m) => s + (m.taskCount || 0), 0);
  box.innerHTML = `
    <div class="stat"><span>会議数</span><strong>${total}</strong></div>
    <div class="stat"><span>完了</span><strong>${done}</strong></div>
    <div class="stat"><span>失敗</span><strong>${failed}</strong></div>
    <div class="stat"><span>タスク総数</span><strong>${totalTasks}</strong></div>
  `;
}

async function safeRun(fn) {
  try {
    const result = await fn();
    if (result?.ok === false) throw new Error(result.error || '操作に失敗しました');
    await refresh();
  } catch (error) {
    alert(error.message || String(error));
  }
}

init();
