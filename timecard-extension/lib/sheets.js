// Google Sheets integration
// Setup: Create OAuth2 credentials at console.cloud.google.com
// Enable: Google Sheets API v4
// Add your extension's OAuth client ID in settings

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function getAuthToken() {
  const manifest = chrome.runtime.getManifest();
  if (!manifest.oauth2?.client_id || manifest.oauth2.client_id.startsWith('YOUR_')) {
    throw new Error(
      'Google OAuth2の設定が必要です。\n' +
      'manifest.json の oauth2.client_id にGoogle Cloud ConsoleのクライアントIDを入力してください。'
    );
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true, scopes: [SCOPES] }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function sheetsRequest(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// Get or create a monthly sheet tab (e.g. "2026-05")
async function ensureMonthSheet(token, spreadsheetId, monthStr) {
  const meta = await sheetsRequest(token, 'GET', `${API_BASE}/${spreadsheetId}?fields=sheets.properties`);
  const existing = meta.sheets?.find(s => s.properties.title === monthStr);
  if (existing) return existing.properties.sheetId;

  const res = await sheetsRequest(token, 'POST', `${API_BASE}/${spreadsheetId}:batchUpdate`, {
    requests: [{
      addSheet: {
        properties: { title: monthStr, gridProperties: { rowCount: 200, columnCount: 10 } }
      }
    }]
  });
  return res.replies[0].addSheet.properties.sheetId;
}

// Prefix formula-starting chars to prevent spreadsheet injection
function sanitizeCell(val) {
  const s = String(val ?? '');
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function buildMonthRows(entries, clients) {
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
  const rows = entries.map(e => {
    const client = clientMap[e.clientId] || { name: e.clientId };
    const durationMin = Math.round((e.duration || 0) / 60000);
    const h = Math.floor(durationMin / 60);
    const m = durationMin % 60;
    return [
      sanitizeCell(e.date),
      sanitizeCell(client.name),
      sanitizeCell(e.startTimeStr || ''),
      sanitizeCell(e.endTimeStr || ''),
      `${h}:${String(m).padStart(2, '0')}`,
      sanitizeCell((e.tags || []).join(', ')),
      sanitizeCell(e.note || ''),
    ];
  });

  const header = [['日付', 'クライアント', '開始', '終了', '稼働時間', 'タグ', 'メモ']];
  return [...header, ...rows];
}

async function syncToSheet(spreadsheetId, entries, clients, monthStr) {
  const token = await getAuthToken();
  const sheetId = await ensureMonthSheet(token, spreadsheetId, monthStr);
  const rows = buildMonthRows(entries, clients);

  // Write data
  const range = `${monthStr}!A1`;
  await sheetsRequest(token, 'PUT',
    `${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { values: rows }
  );

  // Apply formatting: freeze header, bold header, alternating rows
  // Key by sanitized name so it matches what was written to the sheet
  const colorMap = Object.fromEntries(clients.map(c => {
    const hex = c.color || '#A6B5A5';
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [sanitizeCell(c.name), { red: r, green: g, blue: b }];
  }));

  const requests = [
    // Freeze header row
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 }
        },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    // Bold header
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.95, green: 0.93, blue: 0.9 },
          }
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor)'
      }
    },
    // Auto-resize columns
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 7 }
      }
    },
  ];

  // Color rows by client
  const clientNames = clients.map(c => c.name);
  rows.slice(1).forEach((row, i) => {
    const clientName = row[1];
    const color = colorMap[clientName];
    if (!color) return;
    const lightColor = {
      red: Math.min(1, color.red * 0.25 + 0.75),
      green: Math.min(1, color.green * 0.25 + 0.75),
      blue: Math.min(1, color.blue * 0.25 + 0.75),
    };
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: i + 1, endRowIndex: i + 2, startColumnIndex: 0, endColumnIndex: 7 },
        cell: { userEnteredFormat: { backgroundColor: lightColor } },
        fields: 'userEnteredFormat.backgroundColor'
      }
    });
  });

  await sheetsRequest(token, 'POST', `${API_BASE}/${spreadsheetId}:batchUpdate`, { requests });

  return { sheetId, rowCount: rows.length - 1 };
}

function csvCell(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportAsCSV(entries, clients) {
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
  const lines = ['日付,クライアント,開始,終了,稼働時間,タグ,メモ'];
  entries.forEach(e => {
    const client = clientMap[e.clientId] || { name: e.clientId };
    const durationMin = Math.round((e.duration || 0) / 60000);
    const h = Math.floor(durationMin / 60);
    const m = durationMin % 60;
    lines.push([
      e.date, client.name, e.startTimeStr || '', e.endTimeStr || '',
      `${h}:${String(m).padStart(2, '0')}`,
      (e.tags || []).join(' '),
      e.note || '',
    ].map(v => csvCell(sanitizeCell(v))).join(','));
  });
  return lines.join('\n');
}
