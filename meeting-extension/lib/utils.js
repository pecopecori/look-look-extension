(function () {
  const CHUNK_MS = 60_000;
  const HARD_STOP_MS = 120 * 60_000;
  const RETRY_ALARM_NAME = 'meeting-ext-retry';

  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function browserTz() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
  }

  function formatDate(input) {
    const date = input instanceof Date ? input : new Date(input);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function formatDateTime(input) {
    const date = input instanceof Date ? input : new Date(input);
    return `${formatDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function formatDurationShort(ms) {
    const totalMin = Math.max(0, Math.round((ms || 0) / 60000));
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return `${hh}:${String(mm).padStart(2, '0')}`;
  }

  function detectMeetingTool(url) {
    const value = String(url || '').toLowerCase();
    if (value.includes('meet.google.com')) return 'meet';
    if (value.includes('zoom.us')) return 'zoom';
    if (value.includes('teams.microsoft.com')) return 'teams';
    if (value.includes('discord.com')) return 'discord';
    return 'other';
  }

  function toolLabel(tool) {
    return {
      meet: 'Google Meet',
      zoom: 'Zoom',
      teams: 'Microsoft Teams',
      discord: 'Discord',
      other: 'Other',
    }[tool] || 'Other';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncate(value, max = 140) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function meetingTitleFallback(tabTitle, tool) {
    const base = String(tabTitle || '').trim();
    if (base) return base;
    return `${toolLabel(tool)} Meeting`;
  }

  function buildTaskEventId(taskId) {
    return `mx${String(taskId || '').replace(/-/g, '').toLowerCase().slice(0, 60)}`;
  }

  function addDays(dateLike, days) {
    const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
    date.setDate(date.getDate() + days);
    return date;
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function blobToText(blob) {
    return await blob.text();
  }

  function extractJson(text) {
    const source = String(text || '').trim();
    if (!source) throw new Error('JSON 応答が空です');
    try {
      return JSON.parse(source);
    } catch (_) {}

    const fenced = source.match(/```json\s*([\s\S]*?)```/i) || source.match(/```\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1]);
    }

    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(source.slice(start, end + 1));
    }
    throw new Error('JSON を抽出できませんでした');
  }

  function isOauthClientConfigured() {
    const manifest = chrome.runtime.getManifest();
    const id = manifest.oauth2?.client_id || '';
    return !!id && !id.startsWith('YOUR_');
  }

  globalThis.MeetingExtUtils = {
    CHUNK_MS,
    HARD_STOP_MS,
    RETRY_ALARM_NAME,
    addDays,
    blobToText,
    browserTz,
    buildTaskEventId,
    detectMeetingTool,
    downloadBlob,
    escapeHtml,
    extractJson,
    formatDate,
    formatDateTime,
    formatDuration,
    formatDurationShort,
    isOauthClientConfigured,
    meetingTitleFallback,
    nowIso,
    toolLabel,
    truncate,
    uuid,
  };
})();
