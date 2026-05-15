// ============================================================
// タスク計測ツール - メインコード
// ============================================================

const AGGREGATE_SHEET_NAME = '集計';
const CALENDAR_ENABLED_KEY = 'calendarEnabled';
const DAILY_SHEET_PATTERN = /^\d{2}月\d{2}日$/;

// 日次シートの列定義
const COL = {
  DATE: 1,       // A: 日付
  TASK: 2,       // B: タスク
  SCHEDULED: 3,  // C: 予定時間
  START: 4,      // D: 開始
  END: 5,        // E: 終了
  ACTUAL: 6,     // F: 所要時間（計算式）
  DIFF: 7,       // G: 差分（計算式）
  TOTAL_LABEL: 8, // H: 合計時間（ラベル）
  TOTAL_VALUE: 9, // I: 合計時間（値）
  CALENDAR: 10,  // J: カレンダーイベントID
};

// 集計シートの列定義
const AGG_COL = {
  TASK: 1,       // A: タスク
  SCHEDULED: 2,  // B: 予定時間
  ACTUAL: 3,     // C: 実働時間（集計）
  DIFF: 4,       // D: 差分
  TOTAL_LABEL: 5, // E: 合計時間（ラベル）
  TOTAL_VALUE: 6, // F: 合計時間（値）
};

// ============================================================
// 初期化
// ============================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('タスク管理')
    .addItem('タスク計測パネルを開く', 'showSidebar')
    .addSeparator()
    .addItem('今日のシートを作成', 'createTodaySheet')
    .addItem('集計シートを初期化', 'initAggregateSheet')
    .addToUi();

  // 集計シートがなければ作成
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(AGGREGATE_SHEET_NAME)) {
    initAggregateSheet();
  }

  createTodaySheet();
  showSidebar();
}

// タスク列(B列)を変更したら予定時間を自動入力
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const range = e.range;

  if (
    DAILY_SHEET_PATTERN.test(sheet.getName()) &&
    range.getColumn() === COL.TASK &&
    range.getRow() >= 2
  ) {
    const taskName = range.getValue().toString();
    if (taskName) {
      autoFillScheduledTime(sheet, range.getRow(), taskName);
    }
  }
}

// ============================================================
// サイドバー
// ============================================================

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('タスク計測')
    .setWidth(280);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ============================================================
// シート管理
// ============================================================

/**
 * 今日の日付シートを作成してアクティブにする
 */
function createTodaySheet() {
  const today = new Date();
  const sheetName = Utilities.formatDate(today, 'Asia/Tokyo', 'MM月dd日');
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = insertDailySheet(ss, sheetName);
    setupDailySheet(sheet, today);
  }

  ss.setActiveSheet(sheet);
  return sheetName;
}

/**
 * 日付順に正しい位置へシートを挿入
 */
function insertDailySheet(ss, sheetName) {
  const sheets = ss.getSheets();
  let insertIndex = ss.getNumSheets();

  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName();
    if (DAILY_SHEET_PATTERN.test(name) && name > sheetName) {
      insertIndex = i;
      break;
    }
  }

  return ss.insertSheet(sheetName, insertIndex);
}

/**
 * 日次シートの初期セットアップ
 */
function setupDailySheet(sheet, date) {
  const headers = [
    '日付', 'タスク', '予定時間', '開始', '終了',
    '所要時間', '差分(+超過/-削減)', '合計時間', '', 'カレンダー'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダースタイル（青）
  [COL.DATE, COL.TASK, COL.SCHEDULED, COL.START, COL.END, COL.DIFF, COL.TOTAL_LABEL, COL.CALENDAR].forEach(col => {
    sheet.getRange(1, col)
      .setBackground('#4472C4')
      .setFontColor('white')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
  });

  // ヘッダースタイル（オレンジ）
  [COL.ACTUAL, COL.TOTAL_VALUE].forEach(col => {
    sheet.getRange(1, col)
      .setBackground('#E6A020')
      .setFontColor('white')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
  });

  // I1: 本日合計時間（計算式）
  sheet.getRange(1, COL.TOTAL_VALUE)
    .setFormula('=IF(COUNTA(F2:F100)>0,TEXT(SUM(F2:F100),"[h]:mm"),"")')
    .setBackground('#E6A020')
    .setFontColor('white')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 列幅
  const colWidths = {
    [COL.DATE]: 95, [COL.TASK]: 150, [COL.SCHEDULED]: 75,
    [COL.START]: 60, [COL.END]: 60, [COL.ACTUAL]: 75,
    [COL.DIFF]: 125, [COL.TOTAL_LABEL]: 75, [COL.TOTAL_VALUE]: 55, [COL.CALENDAR]: 80
  };
  Object.entries(colWidths).forEach(([col, width]) => {
    sheet.setColumnWidth(Number(col), width);
  });

  // 数式とフォーマット（2〜51行）
  sheet.getRange(2, COL.DATE, 50, 1).setNumberFormat('yyyy/MM/dd');
  sheet.getRange(2, COL.SCHEDULED, 50, 1).setNumberFormat('h:mm');
  sheet.getRange(2, COL.START, 50, 1).setNumberFormat('h:mm');
  sheet.getRange(2, COL.END, 50, 1).setNumberFormat('h:mm');
  sheet.getRange(2, COL.ACTUAL, 50, 1).setNumberFormat('[h]:mm');
  sheet.getRange(2, COL.DIFF, 50, 1).setNumberFormat('[h]:mm');

  for (let row = 2; row <= 51; row++) {
    // 所要時間 = 終了 - 開始（深夜またぎ対応）
    sheet.getRange(row, COL.ACTUAL).setFormula(
      `=IF(AND(D${row}<>"",E${row}<>""),MOD(E${row}-D${row},1),"")`
    );
    // 差分 = 所要時間 - 予定時間
    sheet.getRange(row, COL.DIFF).setFormula(
      `=IF(AND(F${row}<>"",C${row}<>""),F${row}-C${row},"")`
    );
  }

  // タスクのドロップダウン設定
  refreshTaskDropdown(sheet);

  // A2に今日の日付を入力
  if (date) {
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    sheet.getRange(2, COL.DATE).setValue(dateOnly).setNumberFormat('yyyy/MM/dd');
  }
}

/**
 * タスクドロップダウンを集計シートのタスク一覧で更新
 */
function refreshTaskDropdown(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aggregateSheet = ss.getSheetByName(AGGREGATE_SHEET_NAME);
  if (!aggregateSheet) return;

  const lastRow = aggregateSheet.getLastRow();
  if (lastRow < 2) return;

  const taskRange = aggregateSheet.getRange(2, 1, lastRow - 1, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(taskRange, true)
    .setAllowInvalid(true)
    .build();

  sheet.getRange(2, COL.TASK, 50, 1).setDataValidation(rule);
}

// ============================================================
// 集計シート
// ============================================================

function initAggregateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AGGREGATE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(AGGREGATE_SHEET_NAME, 0);
  }
  setupAggregateSheet(sheet);
  return true;
}

function setupAggregateSheet(sheet) {
  const headers = ['タスク', '予定時間', '実働時間', '差分(+超過/-削減)', '合計時間', ''];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // 青ヘッダー
  [AGG_COL.TASK, AGG_COL.SCHEDULED, AGG_COL.ACTUAL, AGG_COL.DIFF].forEach(col => {
    sheet.getRange(1, col)
      .setBackground('#4472C4')
      .setFontColor('white')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
  });

  // オレンジヘッダー
  [AGG_COL.TOTAL_LABEL, AGG_COL.TOTAL_VALUE].forEach(col => {
    sheet.getRange(1, col)
      .setBackground('#E6A020')
      .setFontColor('white')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
  });

  // F1: 月合計実働時間
  sheet.getRange(1, AGG_COL.TOTAL_VALUE)
    .setFormula('=IF(COUNTA(C2:C100)>0,TEXT(SUM(C2:C100),"[h]:mm"),"")')
    .setBackground('#E6A020')
    .setFontColor('white')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 列幅
  sheet.setColumnWidth(AGG_COL.TASK, 150);
  sheet.setColumnWidth(AGG_COL.SCHEDULED, 80);
  sheet.setColumnWidth(AGG_COL.ACTUAL, 80);
  sheet.setColumnWidth(AGG_COL.DIFF, 130);
  sheet.setColumnWidth(AGG_COL.TOTAL_LABEL, 80);
  sheet.setColumnWidth(AGG_COL.TOTAL_VALUE, 55);

  // フォーマット
  sheet.getRange(2, AGG_COL.SCHEDULED, 50, 1).setNumberFormat('[h]:mm');
  sheet.getRange(2, AGG_COL.ACTUAL, 50, 1).setNumberFormat('[h]:mm');
  sheet.getRange(2, AGG_COL.DIFF, 50, 1).setNumberFormat('[h]:mm');

  // 差分の計算式
  for (let row = 2; row <= 51; row++) {
    sheet.getRange(row, AGG_COL.DIFF).setFormula(
      `=IF(AND(B${row}<>"",C${row}<>""),C${row}-B${row},"")`
    );
  }
}

// ============================================================
// サイドバーから呼び出すアクション
// ============================================================

/**
 * 開始ボタン
 */
function startTask() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row < 2) return { success: false, message: 'タスク行（2行目以降）を選択してください' };

  const taskName = sheet.getRange(row, COL.TASK).getValue().toString();
  if (!taskName) return { success: false, message: 'タスク名を入力してください' };

  const now = new Date();
  const timeValue = new Date(1899, 11, 30, now.getHours(), now.getMinutes(), 0);

  sheet.getRange(row, COL.START).setValue(timeValue).setNumberFormat('h:mm');

  // A列の日付を補完
  if (sheet.getRange(row, COL.DATE).getValue() === '') {
    const dateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    sheet.getRange(row, COL.DATE).setValue(dateOnly).setNumberFormat('yyyy/MM/dd');
  }

  autoFillScheduledTime(sheet, row, taskName);

  return {
    success: true,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm'),
    task: taskName
  };
}

/**
 * 終了ボタン
 */
function endTask() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row < 2) return { success: false, message: 'タスク行（2行目以降）を選択してください' };

  if (sheet.getRange(row, COL.START).getValue() === '') {
    return { success: false, message: '先に「開始」ボタンを押してください' };
  }

  const now = new Date();
  const timeValue = new Date(1899, 11, 30, now.getHours(), now.getMinutes(), 0);

  sheet.getRange(row, COL.END).setValue(timeValue).setNumberFormat('h:mm');

  return {
    success: true,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm')
  };
}

/**
 * リセットボタン
 */
function resetTask() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row < 2) return { success: false, message: 'タスク行（2行目以降）を選択してください' };

  sheet.getRange(row, COL.START).setValue('');
  sheet.getRange(row, COL.END).setValue('');
  sheet.getRange(row, COL.CALENDAR).setValue('');

  return { success: true };
}

/**
 * 集計更新・同期ボタン
 */
function updateAndSync() {
  try {
    updateAggregateFromDailySheets();

    const calendarEnabled = getCalendarEnabled();
    if (calendarEnabled) {
      syncActiveSheetToCalendar();
    }

    // 全日次シートのドロップダウンも更新
    refreshAllDropdowns();

    return {
      success: true,
      message: '集計を更新しました' + (calendarEnabled ? '（カレンダーに同期済み）' : '')
    };
  } catch (e) {
    return { success: false, message: 'エラー: ' + e.message };
  }
}

/**
 * 本日終了ボタン
 */
function endDay() {
  try {
    updateAggregateFromDailySheets();

    const calendarEnabled = getCalendarEnabled();
    if (calendarEnabled) {
      syncActiveSheetToCalendar();
    }

    refreshAllDropdowns();

    return {
      success: true,
      message: '本日の作業を終了しました' + (calendarEnabled ? '\nGoogleカレンダーに同期しました' : '')
    };
  } catch (e) {
    return { success: false, message: 'エラー: ' + e.message };
  }
}

// ============================================================
// 集計処理
// ============================================================

/**
 * 全日次シートを走査して集計シートの実働時間を再計算
 */
function updateAggregateFromDailySheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aggregateSheet = ss.getSheetByName(AGGREGATE_SHEET_NAME);
  if (!aggregateSheet) throw new Error('集計シートが見つかりません');

  const lastAggRow = aggregateSheet.getLastRow();
  if (lastAggRow < 2) return;

  // タスク名 → {row, actual} のマップ
  const taskRows = aggregateSheet.getRange(2, AGG_COL.TASK, lastAggRow - 1, 1).getValues();
  const taskMap = {};
  taskRows.forEach((row, i) => {
    if (row[0]) taskMap[row[0].toString()] = { row: i + 2, actual: 0 };
  });

  // 全日次シートを走査
  ss.getSheets().forEach(sheet => {
    if (!DAILY_SHEET_PATTERN.test(sheet.getName())) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    // B列(タスク) と F列(所要時間) を取得
    const tasks = sheet.getRange(2, COL.TASK, lastRow - 1, 1).getValues();
    const actuals = sheet.getRange(2, COL.ACTUAL, lastRow - 1, 1).getValues();

    tasks.forEach((row, i) => {
      const taskName = row[0] ? row[0].toString() : '';
      const actualVal = actuals[i][0];
      if (taskName && taskMap[taskName] !== undefined && typeof actualVal === 'number') {
        taskMap[taskName].actual += actualVal;
      }
    });
  });

  // 集計シートに書き込み
  Object.values(taskMap).forEach(task => {
    const cell = aggregateSheet.getRange(task.row, AGG_COL.ACTUAL);
    if (task.actual > 0) {
      cell.setValue(task.actual).setNumberFormat('[h]:mm');
    } else {
      cell.setValue('');
    }
  });
}

/**
 * 全日次シートのタスクドロップダウンを更新（新タスク追加時など）
 */
function refreshAllDropdowns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(sheet => {
    if (DAILY_SHEET_PATTERN.test(sheet.getName())) {
      refreshTaskDropdown(sheet);
    }
  });
}

// ============================================================
// Google カレンダー連携
// ============================================================

/**
 * アクティブな日次シートのタスクをGoogleカレンダーに同期
 */
function syncActiveSheetToCalendar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const sheetName = sheet.getName();

  if (!DAILY_SHEET_PATTERN.test(sheetName)) {
    throw new Error('日付シートをアクティブにしてから実行してください');
  }

  // シート名(MM月DD日)から日付を解析
  const baseDate = parseDateFromSheetName(sheetName);
  if (!baseDate) throw new Error('シート名から日付を解析できませんでした');

  const calendar = CalendarApp.getDefaultCalendar();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, COL.CALENDAR).getValues();

  data.forEach((row, i) => {
    const sheetRow = i + 2;
    const taskName = row[COL.TASK - 1] ? row[COL.TASK - 1].toString() : '';
    const startTime = row[COL.START - 1];
    const endTime = row[COL.END - 1];
    const savedEventId = row[COL.CALENDAR - 1] ? row[COL.CALENDAR - 1].toString() : '';

    if (!taskName || !startTime || !endTime) return;

    const startDt = buildDateTime(baseDate, startTime);
    const endDt = buildDateTime(baseDate, endTime);
    if (!startDt || !endDt) return;

    try {
      if (savedEventId) {
        // 既存イベントを更新（削除された場合は再作成）
        try {
          const event = calendar.getEventById(savedEventId);
          if (event) {
            event.setTitle(taskName);
            event.setTime(startDt, endDt);
            return;
          }
        } catch (_) { /* 存在しない場合は再作成 */ }
      }
      // 新規作成
      const newEvent = calendar.createEvent(taskName, startDt, endDt);
      sheet.getRange(sheetRow, COL.CALENDAR).setValue(newEvent.getId());
    } catch (e) {
      Logger.log('カレンダー同期エラー (行' + sheetRow + '): ' + e.message);
    }
  });
}

/**
 * "MM月DD日" のシート名から Date を生成
 */
function parseDateFromSheetName(sheetName) {
  const match = sheetName.match(/^(\d{2})月(\d{2})日$/);
  if (!match) return null;

  const month = parseInt(match[1]) - 1;
  const day = parseInt(match[2]);
  const now = new Date();
  let year = now.getFullYear();

  // 年またぎ対応: 現在月より大幅に先の月は前年
  if (month > now.getMonth() + 3) year--;

  return new Date(year, month, day);
}

/**
 * 日付 + 時刻値から Date を構築
 */
function buildDateTime(baseDate, timeValue) {
  try {
    let hours = 0, minutes = 0;
    if (timeValue instanceof Date) {
      hours = timeValue.getHours();
      minutes = timeValue.getMinutes();
    } else if (typeof timeValue === 'number') {
      const totalMin = Math.round(timeValue * 24 * 60);
      hours = Math.floor(totalMin / 60) % 24;
      minutes = totalMin % 60;
    } else {
      return null;
    }
    return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hours, minutes, 0);
  } catch (_) {
    return null;
  }
}

// ============================================================
// ユーティリティ
// ============================================================

/**
 * 集計シートから予定時間を自動入力（未入力の場合のみ）
 */
function autoFillScheduledTime(sheet, row, taskName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aggregateSheet = ss.getSheetByName(AGGREGATE_SHEET_NAME);
  if (!aggregateSheet) return;

  const scheduledCell = sheet.getRange(row, COL.SCHEDULED);
  if (scheduledCell.getValue() !== '') return; // 既に入力済みなら上書きしない

  const lastRow = aggregateSheet.getLastRow();
  if (lastRow < 2) return;

  const tasks = aggregateSheet.getRange(2, AGG_COL.TASK, lastRow - 1, 2).getValues();
  for (const task of tasks) {
    if (task[0].toString() === taskName && task[1] !== '') {
      scheduledCell.setValue(task[1]).setNumberFormat('h:mm');
      break;
    }
  }
}

/**
 * カレンダー連携設定を取得
 */
function getCalendarEnabled() {
  return PropertiesService.getUserProperties().getProperty(CALENDAR_ENABLED_KEY) === 'true';
}

/**
 * カレンダー連携設定を保存
 */
function setCalendarEnabled(enabled) {
  PropertiesService.getUserProperties().setProperty(CALENDAR_ENABLED_KEY, enabled ? 'true' : 'false');
  return { success: true };
}

/**
 * サイドバーの初期表示用情報を取得
 */
function getSheetInfo() {
  return {
    calendarEnabled: getCalendarEnabled()
  };
}
