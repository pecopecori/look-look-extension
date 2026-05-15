const STORAGE = globalThis.DEMO_EXT_STORAGE;

const TOOLS = [
  { value: 'pointer', icon: '↖', name: 'ポインター' },
  { value: 'rect', icon: '□', name: '四角で囲む' },
  { value: 'circle', icon: '○', name: '丸で囲む' },
  { value: 'arrow', icon: '↗', name: '矢印' },
  { value: 'pen', icon: '✏️', name: 'フリーハンド' },
  { value: 'text', icon: 'T', name: 'テキスト注釈' },
  { value: 'mosaic', icon: '🫥', name: 'モザイク' },
  { value: 'step', icon: '①', name: 'ステップ番号' },
  { value: 'stamp', icon: '💬', name: 'スタンプ' },
  { value: 'emoji', icon: '😀', name: '絵文字' },
  { value: 'eraser', icon: '🧽', name: '個別消去' },
];

const STROKES = [2, 4, 8, 14];
let selectedColor = STORAGE.DEFAULT_SETTINGS.defaultColor;
let selectedStroke = STORAGE.DEFAULT_SETTINGS.defaultStrokeWidth;

const form = document.getElementById('settingsForm');
const defaultTool = document.getElementById('defaultTool');
const defaultColorPicker = document.getElementById('defaultColorPicker');
const strokeOptions = document.getElementById('strokeOptions');
const saveStatus = document.getElementById('saveStatus');
const resetBtn = document.getElementById('resetSettings');

bootstrap().catch((error) => {
  console.error(error);
  saveStatus.textContent = '設定の読み込みに失敗しました';
});

async function bootstrap() {
  renderToolSelect();
  renderColorPicker();
  renderStrokeOptions();

  const settings = await STORAGE.loadSettings();
  applySettingsToForm(settings);

  form.addEventListener('submit', onSubmit);
  resetBtn.addEventListener('click', onReset);
}

function renderToolSelect() {
  defaultTool.innerHTML = TOOLS
    .map((tool) => `<option value="${tool.value}">${tool.icon} ${tool.name}</option>`)
    .join('');
}

function renderColorPicker() {
  defaultColorPicker.innerHTML = (globalThis.DEMO_EXT_PALETTE || []).map((color) =>
    `<button type="button" class="swatch" data-color="${color}" style="background:${color}" title="${color}"></button>`
  ).join('');

  defaultColorPicker.addEventListener('click', (e) => {
    const swatch = e.target.closest('[data-color]');
    if (!swatch) return;
    selectedColor = swatch.dataset.color;
    syncColorPicker();
  });
}

function renderStrokeOptions() {
  strokeOptions.innerHTML = STROKES.map((stroke) =>
    `<button type="button" class="stroke-option" data-stroke="${stroke}">
      <span class="stroke-dot-preview" style="width:${stroke + 2}px;height:${stroke + 2}px"></span>
      <span>${stroke}px</span>
    </button>`
  ).join('');

  strokeOptions.addEventListener('click', (e) => {
    const button = e.target.closest('[data-stroke]');
    if (!button) return;
    selectedStroke = Number(button.dataset.stroke);
    syncStrokeOptions();
  });
}

function applySettingsToForm(settings) {
  defaultTool.value = settings.defaultTool;
  selectedColor = settings.defaultColor;
  selectedStroke = settings.defaultStrokeWidth;
  document.getElementById('pikonEnabled').checked = settings.pikonEnabled;
  document.getElementById('clickZoomEnabled').checked = Boolean(settings.clickZoomEnabled);
  document.getElementById('spotlightEnabled').checked = settings.spotlightEnabled;
  document.getElementById('magnifierEnabled').checked = settings.magnifierEnabled;
  document.getElementById('keystrokeEnabled').checked = settings.keystrokeEnabled;
  document.getElementById('rememberToolbarPosition').checked = settings.rememberToolbarPosition;
  syncColorPicker();
  syncStrokeOptions();
}

async function onSubmit(event) {
  event.preventDefault();
  const next = {
    defaultTool: defaultTool.value,
    defaultColor: selectedColor,
    defaultStrokeWidth: selectedStroke,
    pikonEnabled: document.getElementById('pikonEnabled').checked,
    clickZoomEnabled: document.getElementById('clickZoomEnabled').checked,
    spotlightEnabled: document.getElementById('spotlightEnabled').checked,
    magnifierEnabled: document.getElementById('magnifierEnabled').checked,
    keystrokeEnabled: document.getElementById('keystrokeEnabled').checked,
    rememberToolbarPosition: document.getElementById('rememberToolbarPosition').checked,
  };

  const saved = await STORAGE.saveSettings(next);
  applySettingsToForm(saved);
  flashStatus('保存しました');
}

async function onReset() {
  const reset = await STORAGE.resetSettings();
  applySettingsToForm(reset);
  flashStatus('初期値に戻しました');
}

function syncColorPicker() {
  defaultColorPicker.querySelectorAll('[data-color]').forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.color === selectedColor);
  });
}

function syncStrokeOptions() {
  strokeOptions.querySelectorAll('[data-stroke]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.stroke) === selectedStroke);
  });
}

function flashStatus(message) {
  saveStatus.textContent = message;
  clearTimeout(flashStatus._timer);
  flashStatus._timer = setTimeout(() => {
    saveStatus.textContent = '';
  }, 2200);
}
