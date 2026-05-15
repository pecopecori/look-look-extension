// Look!Look! — content script
// オーバーレイUI + 永続設定 + 画面キャプチャルーペ

(function () {
  if (window.__DEMO_EXT_INITED__) return;
  window.__DEMO_EXT_INITED__ = true;

  const PALETTE = globalThis.DEMO_EXT_PALETTE;
  const THEME = globalThis.DEMO_EXT_THEME;
  const STAMPS = globalThis.DEMO_EXT_STAMPS;
  const EMOJIS = globalThis.DEMO_EXT_EMOJIS;
  const STORAGE = globalThis.DEMO_EXT_STORAGE;
  const DEFAULT_SETTINGS = STORAGE?.DEFAULT_SETTINGS || {
    defaultTool: 'pointer',
    defaultColor: THEME.accent,
    defaultStrokeWidth: 4,
    pikonEnabled: true,
    clickZoomEnabled: false,
    spotlightEnabled: false,
    magnifierEnabled: false,
    keystrokeEnabled: false,
    selectedStampIndex: 0,
    selectedEmojiIndex: 0,
    rememberToolbarPosition: true,
    toolbarPosition: { top: 20, left: 20 },
    recorder: { includeMic: true, filenamePrefix: 'pointer-recording' },
  };

  const state = {
    enabled: false,
    tool: DEFAULT_SETTINGS.defaultTool,
    color: DEFAULT_SETTINGS.defaultColor,
    strokeWidth: DEFAULT_SETTINGS.defaultStrokeWidth,
    stepCounter: 1,
    selectedStamp: STAMPS[DEFAULT_SETTINGS.selectedStampIndex] || STAMPS[0],
    selectedStampIndex: DEFAULT_SETTINGS.selectedStampIndex,
    selectedEmoji: EMOJIS[DEFAULT_SETTINGS.selectedEmojiIndex] || EMOJIS[0],
    selectedEmojiIndex: DEFAULT_SETTINGS.selectedEmojiIndex,
    spotlightOn: DEFAULT_SETTINGS.spotlightEnabled,
    keystrokeOn: DEFAULT_SETTINGS.keystrokeEnabled,
    pikonOn: DEFAULT_SETTINGS.pikonEnabled,
    clickZoomOn: DEFAULT_SETTINGS.clickZoomEnabled,
    rememberToolbarPosition: DEFAULT_SETTINGS.rememberToolbarPosition,
    toolbarPosition: { ...DEFAULT_SETTINGS.toolbarPosition },
  };

  const UI_THEMES = [
    { id: 'natural', name: 'ナチュラル', accent: '#A6B5A5', base: '#F4EBDA', text: '#262724' },
    { id: 'dark',    name: 'ダーク',     accent: '#4A90E2', base: '#1E1E2E', text: '#E8E8E8' },
    { id: 'pink',    name: 'ピンク',     accent: '#E91E63', base: '#FFF0F5', text: '#262724' },
    { id: 'blue',    name: 'ブルー',     accent: '#1E88E5', base: '#E3F2FD', text: '#0D47A1' },
    { id: 'black',   name: 'ブラック',   accent: '#FFD600', base: '#262724', text: '#F4EBDA' },
  ];
  let currentThemeId = (() => {
    try { return localStorage.getItem('demo-ext-theme') || 'natural'; } catch (_) { return 'natural'; }
  })();

  let host, shadow, toolbar, svgOverlay, htmlOverlay, spotlightEl, keystrokeEl;
  let currentSettings = cloneSettings(DEFAULT_SETTINGS);
  let settingsLoaded = false;

  const settingsReady = loadStoredSettings();

  // ページロード時に録画中かどうかを確認してバッジを復元
  chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }).then((res) => {
    const { status, startedAt } = res?.recorder || {};
    if (status === 'recording') updateRecBadge('recording', startedAt);
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'TOGGLE_TOOLBAR') {
      void toggleToolbar();
    }
    if (msg?.type === 'RECORDING_STATUS_CHANGED') {
      updateRecBadge(msg.status, msg.startedAt);
    }
  });

  if (chrome?.storage?.onChanged && STORAGE?.STORAGE_KEY) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE.STORAGE_KEY]?.newValue) return;
      currentSettings = STORAGE.normalizeSettings(changes[STORAGE.STORAGE_KEY].newValue);
      applySettingsToState(currentSettings);
      applyStateToUi();
    });
  }

  async function loadStoredSettings() {
    if (!STORAGE?.loadSettings) {
      settingsLoaded = true;
      return;
    }
    currentSettings = await STORAGE.loadSettings();
    applySettingsToState(currentSettings);
    settingsLoaded = true;
    applyStateToUi();
  }

  async function ensureSettingsLoaded() {
    if (!settingsLoaded) await settingsReady;
  }

  async function toggleToolbar() {
    await ensureSettingsLoaded();
    if (!host) initUI();
    state.enabled = !state.enabled;
    host.style.display = state.enabled ? 'block' : 'none';
    if (state.enabled) {
      applyStateToUi();
      return;
    }
    setTool(currentSettings.defaultTool, { persist: false });
    closePanels();
  }

  function initUI() {
    injectEffectStyles();

    host = document.createElement('div');
    host.id = '__demo_ext_host__';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:none;user-select:none;-webkit-user-select:none;';
    document.documentElement.appendChild(host);

    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;

    toolbar = shadow.getElementById('toolbar');
    svgOverlay = shadow.getElementById('svgOverlay');
    htmlOverlay = shadow.getElementById('htmlOverlay');
    spotlightEl = shadow.getElementById('spotlight');
    keystrokeEl = shadow.getElementById('keystroke');

    bindToolbar();
    bindDrawing();
    bindClickEffect();
    bindHtmlMove();
    bindKeystroke();
    bindSpotlight();
    renderColorPalette();
    renderStampPanel();
    renderEmojiPanel();
    renderThemePanel();
    applyTheme(currentThemeId);
    makeDraggable(toolbar, shadow.getElementById('dragHandle'));
    applyStateToUi();
  }

  const TEMPLATE = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;900&display=swap');
      :host { all: initial; }
      * { box-sizing: border-box; font-family: 'M PLUS Rounded 1c', sans-serif; }

      #svgOverlay, #htmlOverlay {
        position: fixed; inset: 0; pointer-events: none;
      }
      #svgOverlay { z-index: 2147483640; overflow: visible; }
      #htmlOverlay { z-index: 2147483641; }

      #svgOverlay.mode-draw { pointer-events: auto; cursor: crosshair; }
      #svgOverlay.mode-stamp { pointer-events: auto; cursor: copy; }
      #svgOverlay.mode-erase { pointer-events: auto; cursor: not-allowed; }

      #spotlight {
        position: fixed; inset: 0; pointer-events: none;
        background: radial-gradient(circle 120px at var(--mx,50%) var(--my,50%),
                    rgba(0,0,0,0) 0%, rgba(0,0,0,0) 80px, rgba(0,0,0,0.7) 200px);
        z-index: 2147483639; display: none;
      }
      #spotlight.on { display: block; }

      #keystroke {
        position: fixed; top: 24px; left: 80px;
        display: none; gap: 8px; z-index: 2147483645; pointer-events: none;
        flex-wrap: wrap; max-width: 480px;
      }
      #keystroke.on { display: flex; }
      .key-chip {
        background: rgba(38,39,36,0.92); color: #FFD93D;
        padding: 14px 22px; border-radius: 12px; font-weight: 900; font-size: 24px;
        border: 2px solid #FFD93D; box-shadow: 0 4px 16px rgba(0,0,0,0.35);
        animation: keyPop 0.3s ease;
      }
      @keyframes keyPop {
        0% { transform: scale(0.6); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }

      #toolbar {
        position: fixed; top: 20px; left: 20px;
        background: var(--demo-base);
        border: 2px solid var(--demo-accent);
        border-radius: 18px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        padding: 8px; pointer-events: auto;
        z-index: 2147483647;
        display: flex; flex-direction: column; gap: 6px;
        min-width: 56px;
        max-height: calc(100vh - 40px);
        overflow-y: auto;
        scrollbar-width: thin;
      }
      #toolbar::-webkit-scrollbar { width: 4px; }
      #toolbar::-webkit-scrollbar-thumb {
        background: rgba(166,181,165,0.5); border-radius: 4px;
      }
      #dragHandle {
        height: 16px; cursor: grab;
        background: repeating-linear-gradient(90deg,
          var(--demo-accent) 0 3px, transparent 3px 7px);
        border-radius: 6px; opacity: 0.6;
        transition: opacity 0.15s;
      }
      #dragHandle:hover { opacity: 1; }
      #dragHandle:active { cursor: grabbing; }
      #toolbar { cursor: default; }
      #toolbar.dragging { cursor: grabbing; user-select: none; }

      .tool-row { display: flex; gap: 4px; flex-wrap: wrap; }
      .tool-btn {
        width: 40px; height: 40px;
        background: #fff;
        border: 1.5px solid rgba(166,181,165,0.3);
        border-radius: 10px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; transition: all 0.15s;
        position: relative;
      }
      .tool-btn:hover {
        border-color: var(--demo-accent);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      }
      .tool-btn.active {
        background: var(--demo-accent);
        border-color: var(--demo-accent);
        color: #fff;
        box-shadow: 0 3px 10px rgba(166,181,165,0.4);
      }

      .divider {
        height: 1px; background: rgba(166,181,165,0.25); margin: 4px 2px;
      }

      .panel {
        position: fixed;
        background: var(--demo-base);
        border: 2px solid var(--demo-accent);
        border-radius: 14px; padding: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        display: none; min-width: 220px; max-width: 280px;
        z-index: 2147483647; pointer-events: auto;
      }
      .panel.open { display: block; }
      .panel * { pointer-events: auto; }

      .picker-row {
        display: flex; align-items: center; gap: 6px; margin-top: 8px;
      }
      #colorPickerInput {
        width: 32px; height: 28px; border: none; border-radius: 6px;
        padding: 2px; cursor: pointer; background: none;
      }
      .picker-btn {
        width: 28px; height: 28px; border-radius: 6px; border: 1.5px solid rgba(166,181,165,0.4);
        background: #fff; cursor: pointer; font-size: 14px;
        display: flex; align-items: center; justify-content: center;
      }
      .picker-btn:hover { background: rgba(166,181,165,0.15); }
      .picker-label {
        font-size: 11px; font-weight: 700; color: var(--demo-text);
        opacity: 0.7; font-family: monospace;
      }
      .panel-title {
        font-size: 11px; font-weight: 900; color: var(--demo-text);
        opacity: 0.6; letter-spacing: 1px; margin-bottom: 8px; text-transform: uppercase;
      }

      #colorPanel .swatches {
        display: grid; grid-template-columns: repeat(10, 18px); gap: 4px;
      }
      .swatch {
        width: 18px; height: 18px; border-radius: 5px; cursor: pointer;
        border: 2px solid transparent; transition: transform 0.1s;
      }
      .swatch:hover { transform: scale(1.2); }
      .swatch.active { border-color: var(--demo-text); }

      .stroke-row { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
      .stroke-preview-dot {
        flex-shrink: 0; border-radius: 50%; background: var(--demo-text);
        transition: width 0.15s, height 0.15s;
      }
      .stroke-num {
        flex-shrink: 0; font-size: 11px; font-weight: 900;
        color: var(--demo-text); width: 26px; text-align: right;
      }
      #strokeSlider {
        flex: 1; -webkit-appearance: none; height: 4px;
        border-radius: 2px; background: rgba(166,181,165,0.35);
        outline: none; cursor: pointer;
      }
      #strokeSlider::-webkit-slider-thumb {
        -webkit-appearance: none; width: 16px; height: 16px;
        border-radius: 50%; background: var(--demo-accent); cursor: pointer;
        border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      }

      #stampPanel .stamp-list {
        display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
      }
      .stamp-chip {
        padding: 8px 10px; border-radius: 10px; cursor: pointer;
        font-weight: 900; font-size: 13px; text-align: center;
        border: 2px solid transparent; transition: transform 0.1s;
      }
      .stamp-chip:hover { transform: translateY(-2px); }
      .stamp-chip.active { box-shadow: 0 0 0 3px var(--demo-text); }

      #emojiPanel .emoji-list {
        display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
      }
      .emoji-chip {
        font-size: 22px; padding: 4px; cursor: pointer; border-radius: 8px;
        border: 2px solid transparent; text-align: center;
        background: #fff;
      }
      .emoji-chip:hover { background: rgba(166,181,165,0.15); }
      .emoji-chip.active { border-color: var(--demo-accent); }

      .theme-list { display: flex; flex-direction: column; gap: 6px; }
      .theme-chip {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 10px; border-radius: 10px; cursor: pointer;
        border: 2px solid transparent; transition: all 0.15s;
        background: #fff;
      }
      .theme-chip:hover { transform: translateX(3px); }
      .theme-chip.active { border-color: var(--demo-accent); font-weight: 900; }
      .theme-swatch-group { display: flex; gap: 3px; }
      .theme-dot {
        width: 14px; height: 14px; border-radius: 50%;
        border: 1.5px solid rgba(0,0,0,0.1);
      }
      .theme-name { font-size: 12px; font-weight: 700; color: var(--demo-text); }

      .draw-shape { fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .draw-text {
        font-family: 'M PLUS Rounded 1c', sans-serif;
        font-weight: 900; pointer-events: auto;
      }
      .text-editor {
        position: fixed; background: transparent; border: 2px dashed var(--demo-accent);
        font-family: 'M PLUS Rounded 1c', sans-serif; font-weight: 900;
        outline: none; padding: 2px 6px; pointer-events: auto;
        z-index: 2147483647; min-width: 80px;
        user-select: text; -webkit-user-select: text;
      }

      .pikon {
        position: fixed; pointer-events: none; z-index: 2147483644;
        animation: pikonFade 0.7s ease-out forwards;
      }
      @keyframes pikonFade {
        0% { transform: translate(-50%,-50%) scale(0.3); opacity: 1; }
        60% { transform: translate(-50%,-50%) scale(1.2); opacity: 1; }
        100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; }
      }

      .click-zoom {
        position: fixed; width: 90px; height: 90px;
        border-radius: 50%;
        border: 4px solid #FFD93D;
        background: radial-gradient(circle, rgba(255,217,61,0.25) 0%, rgba(255,217,61,0.05) 60%, transparent 100%);
        box-shadow: 0 0 24px rgba(255,217,61,0.6), inset 0 0 12px rgba(255,217,61,0.4);
        pointer-events: none; z-index: 2147483644;
        animation: clickZoom 0.65s cubic-bezier(0.18, 0.9, 0.4, 1) forwards;
        transform: translate(-50%, -50%) scale(0.2);
      }
      @keyframes clickZoom {
        0%   { transform: translate(-50%,-50%) scale(0.2); opacity: 0.4; }
        35%  { transform: translate(-50%,-50%) scale(1.35); opacity: 1; }
        70%  { transform: translate(-50%,-50%) scale(1.0); opacity: 0.8; }
        100% { transform: translate(-50%,-50%) scale(1.6); opacity: 0; }
      }

      .step-badge {
        position: fixed; transform: translate(-50%,-50%);
        width: 36px; height: 36px; border-radius: 50%;
        background: #FF6B6B; color: #fff; font-weight: 900;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        font-size: 17px; pointer-events: none;
        animation: stepPop 0.3s ease;
      }
      @keyframes stepPop {
        from { transform: translate(-50%,-50%) scale(0.3); }
        to { transform: translate(-50%,-50%) scale(1); }
      }

      .placed-stamp {
        position: fixed; transform: translate(-50%,-50%);
        padding: 8px 14px; border-radius: 14px;
        font-weight: 900; font-size: 16px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.18);
        pointer-events: none; animation: stepPop 0.3s ease;
        border: 2px solid rgba(0,0,0,0.08);
      }
      .placed-emoji {
        position: fixed; transform: translate(-50%,-50%);
        font-size: 48px; pointer-events: none;
        animation: stepPop 0.3s ease;
        text-shadow: 0 2px 6px rgba(0,0,0,0.15);
      }
      #htmlOverlay.mode-erase .step-badge,
      #htmlOverlay.mode-erase .placed-stamp,
      #htmlOverlay.mode-erase .placed-emoji {
        pointer-events: auto; cursor: not-allowed;
      }
      #svgOverlay.mode-move { pointer-events: auto; cursor: default; }
      #svgOverlay.mode-move .draw-shape,
      #svgOverlay.mode-move .mosaic-rect,
      #svgOverlay.mode-move .draw-text { cursor: grab; }
      #svgOverlay.mode-move .draw-shape:active,
      #svgOverlay.mode-move .mosaic-rect:active,
      #svgOverlay.mode-move .draw-text:active { cursor: grabbing; }
      #htmlOverlay.mode-move .step-badge,
      #htmlOverlay.mode-move .placed-stamp,
      #htmlOverlay.mode-move .placed-emoji { pointer-events: auto; cursor: grab; }
      #htmlOverlay.mode-move .step-badge:active,
      #htmlOverlay.mode-move .placed-stamp:active,
      #htmlOverlay.mode-move .placed-emoji:active { cursor: grabbing; }
    </style>

    <div id="spotlight"></div>
    <svg id="svgOverlay" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
      <rect id="svgHitArea" x="0" y="0" width="9999" height="9999" fill="transparent" pointer-events="all"></rect>
    </svg>
    <div id="htmlOverlay"></div>
    <div id="keystroke"></div>

    <div id="toolbar">
      <div id="dragHandle" title="ドラッグで移動"></div>

      <button class="tool-btn active" data-tool="pointer" title="ポインター">↖</button>
      <button class="tool-btn" data-tool="move" title="要素を移動">✋</button>
      <div class="divider"></div>

      <button class="tool-btn" data-tool="rect" title="四角">□</button>
      <button class="tool-btn" data-tool="circle" title="丸">○</button>
      <button class="tool-btn" data-tool="arrow" title="矢印">↗</button>
      <button class="tool-btn" data-tool="pen" title="ペン">✏️</button>
      <button class="tool-btn" data-tool="text" title="テキスト">T</button>
      <div class="divider"></div>

      <button class="tool-btn" data-toggle="spotlight" title="スポットライト">🔦</button>
      <button class="tool-btn" data-toggle="magnifier" title="押している間ズームイン">🔍</button>
      <button class="tool-btn" data-toggle="keystroke" title="キーストローク表示">⌨️</button>
      <button class="tool-btn" data-toggle="pikon" title="ピコーン エフェクト">✨</button>
      <button class="tool-btn" data-tool="mosaic" title="モザイク">🫥</button>
      <button class="tool-btn" data-tool="step" title="ステップ番号">①</button>
      <div class="divider"></div>

      <button class="tool-btn" data-panel="colorPanel" title="色">🎨</button>
      <button class="tool-btn" data-panel="stampPanel" title="スタンプ">💬</button>
      <button class="tool-btn" data-panel="emojiPanel" title="絵文字">😀</button>
      <div class="divider"></div>

      <button class="tool-btn" data-tool="eraser" title="個別消去">🧽</button>
      <button class="tool-btn" data-action="clear" title="全消去">🗑️</button>
      <button class="tool-btn" data-action="record" title="録画パネル">🎥</button>
      <button class="tool-btn" data-panel="themePanel" title="UIテーマ">🌈</button>
      <button class="tool-btn" data-action="close" title="閉じる">✕</button>
    </div>

    <div class="panel" id="colorPanel">
      <div class="panel-title">色 / 線の太さ</div>
      <div class="swatches"></div>
      <div class="picker-row">
        <input type="color" id="colorPickerInput" title="カスタムカラー">
        <button class="picker-btn" id="eyeDropperBtn" title="スポイト">🔬</button>
        <span class="picker-label" id="pickerColorLabel"></span>
      </div>
      <div class="stroke-row">
        <span class="stroke-preview-dot" id="strokePreviewDot"></span>
        <input type="range" id="strokeSlider" min="1" max="20" step="1">
        <span class="stroke-num" id="strokeNum"></span>
      </div>
    </div>

    <div class="panel" id="stampPanel">
      <div class="panel-title">スタンプ</div>
      <div class="stroke-row">
        <span class="stroke-preview-dot size-dot" id="stampSizeDot"></span>
        <input type="range" class="size-slider" id="stampSizeSlider" min="1" max="20" step="1">
        <span class="stroke-num" id="stampSizeNum"></span>
      </div>
      <div class="stamp-list"></div>
    </div>

    <div class="panel" id="emojiPanel">
      <div class="panel-title">絵文字</div>
      <div class="stroke-row">
        <span class="stroke-preview-dot size-dot" id="emojiSizeDot"></span>
        <input type="range" class="size-slider" id="emojiSizeSlider" min="1" max="20" step="1">
        <span class="stroke-num" id="emojiSizeNum"></span>
      </div>
      <div class="emoji-list"></div>
    </div>

    <div class="panel" id="themePanel">
      <div class="panel-title">UIテーマ</div>
      <div class="theme-list"></div>
    </div>
  `;

  function bindToolbar() {
    toolbar.addEventListener('click', (e) => {
      const target = e.target.closest('[data-tool],[data-toggle],[data-panel],[data-action]');
      if (!target) return;
      e.stopPropagation();

      if (target.dataset.tool) {
        if (state.tool === target.dataset.tool && target.dataset.tool !== 'pointer') setTool('pointer');
        else setTool(target.dataset.tool);
      }
      else if (target.dataset.toggle) toggleFeature(target.dataset.toggle);
      else if (target.dataset.panel) togglePanel(target.dataset.panel);
      else if (target.dataset.action === 'clear') clearAll();
      else if (target.dataset.action === 'record') openRecorder();
      else if (target.dataset.action === 'close') void toggleToolbar();
    });

    shadow.querySelectorAll('.size-slider').forEach((slider) => {
      slider.addEventListener('input', () => {
        state.strokeWidth = Number(slider.value);
        syncStrokeSlider();
        persistSettings({ defaultStrokeWidth: state.strokeWidth });
      });
    });
    const strokeSlider = shadow.getElementById('strokeSlider');
    strokeSlider?.addEventListener('input', () => {
      state.strokeWidth = Number(strokeSlider.value);
      syncStrokeSlider();
      persistSettings({ defaultStrokeWidth: state.strokeWidth });
    });
  }

  function setTool(tool, { persist = true } = {}) {
    state.tool = tool;
    if (shadow) {
      shadow.querySelectorAll('[data-tool]').forEach((button) => {
        button.classList.toggle('active', button.dataset.tool === tool);
      });
    }
    svgOverlay?.classList.remove('mode-draw', 'mode-stamp', 'mode-erase', 'mode-move');
    htmlOverlay?.classList.remove('mode-erase', 'mode-move');
    if (['rect', 'circle', 'arrow', 'pen', 'text', 'mosaic'].includes(tool)) svgOverlay?.classList.add('mode-draw');
    if (['step', 'stamp', 'emoji', 'text'].includes(tool)) svgOverlay?.classList.add('mode-stamp');
    if (tool === 'eraser') {
      svgOverlay?.classList.add('mode-erase');
      htmlOverlay?.classList.add('mode-erase');
    }
    if (tool === 'move') {
      svgOverlay?.classList.add('mode-move');
      htmlOverlay?.classList.add('mode-move');
    }
    if (persist) persistSettings({ defaultTool: tool });
  }

  function toggleFeature(name) {
    if (name === 'spotlight') {
      state.spotlightOn = !state.spotlightOn;
      setSpotlight(state.spotlightOn);
      persistSettings({ spotlightEnabled: state.spotlightOn });
    }
    if (name === 'magnifier') {
      state.clickZoomOn = !state.clickZoomOn;
      if (!state.clickZoomOn) endBodyZoom();
      syncToggleButtons();
      persistSettings({ clickZoomEnabled: state.clickZoomOn });
    }
    if (name === 'keystroke') {
      state.keystrokeOn = !state.keystrokeOn;
      setKeystroke(state.keystrokeOn);
      persistSettings({ keystrokeEnabled: state.keystrokeOn });
    }
    if (name === 'pikon') {
      state.pikonOn = !state.pikonOn;
      if (state.pikonOn) spawnPikon(window.innerWidth / 2, window.innerHeight / 2);
      syncToggleButtons();
      persistSettings({ pikonEnabled: state.pikonOn });
    }
    syncToggleButtons();
  }

  function togglePanel(id) {
    const panel = shadow.getElementById(id);
    if (!panel) return;
    const isOpening = !panel.classList.contains('open');
    shadow.querySelectorAll('.panel').forEach((node) => node.classList.remove('open'));
    if (isOpening) {
      const rect = toolbar.getBoundingClientRect();
      panel.style.left = `${rect.right + 8}px`;
      panel.style.top = `${rect.top}px`;
      panel.classList.add('open');
    }
  }

  function closePanels() {
    if (!shadow) return;
    shadow.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('open'));
  }

  function renderColorPalette() {
    const wrap = shadow.querySelector('#colorPanel .swatches');
    wrap.innerHTML = PALETTE.map((color) =>
      `<div class="swatch${color === state.color ? ' active' : ''}" data-color="${color}" style="background:${color}"></div>`
    ).join('');

    wrap.addEventListener('click', (e) => {
      const swatch = e.target.closest('.swatch');
      if (!swatch) return;
      applyColor(swatch.dataset.color);
    });

    const pickerInput = shadow.getElementById('colorPickerInput');
    if (pickerInput) {
      pickerInput.value = state.color.startsWith('#') ? state.color : '#ff6b6b';
      pickerInput.addEventListener('input', () => applyColor(pickerInput.value));
    }

    const eyeBtn = shadow.getElementById('eyeDropperBtn');
    if (eyeBtn) {
      if (!window.EyeDropper) {
        eyeBtn.style.display = 'none';
      } else {
        eyeBtn.addEventListener('click', async () => {
          try {
            const result = await new window.EyeDropper().open();
            applyColor(result.sRGBHex);
            if (pickerInput) pickerInput.value = result.sRGBHex;
          } catch (_) {}
        });
      }
    }
  }

  function applyColor(color) {
    state.color = color;
    const label = shadow.getElementById('pickerColorLabel');
    if (label) label.textContent = color;
    syncColorPalette();
    persistSettings({ defaultColor: color });
  }

  function renderStampPanel() {
    const wrap = shadow.querySelector('#stampPanel .stamp-list');
    wrap.innerHTML = STAMPS.map((stamp, index) =>
      `<div class="stamp-chip${index === state.selectedStampIndex ? ' active' : ''}" data-i="${index}" style="background:${stamp.bg};color:${stamp.color}">${stamp.label}</div>`
    ).join('');

    wrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.stamp-chip');
      if (!chip) return;
      state.selectedStampIndex = parseInt(chip.dataset.i, 10);
      state.selectedStamp = STAMPS[state.selectedStampIndex] || STAMPS[0];
      syncStampPanel();
      setTool('stamp');
      persistSettings({ selectedStampIndex: state.selectedStampIndex, defaultTool: 'stamp' });
    });
  }

  function renderEmojiPanel() {
    const wrap = shadow.querySelector('#emojiPanel .emoji-list');
    wrap.innerHTML = EMOJIS.map((emoji, index) =>
      `<div class="emoji-chip${index === state.selectedEmojiIndex ? ' active' : ''}" data-i="${index}">${emoji}</div>`
    ).join('');

    wrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.emoji-chip');
      if (!chip) return;
      state.selectedEmojiIndex = parseInt(chip.dataset.i, 10);
      state.selectedEmoji = EMOJIS[state.selectedEmojiIndex] || EMOJIS[0];
      syncEmojiPanel();
      setTool('emoji');
      persistSettings({ selectedEmojiIndex: state.selectedEmojiIndex, defaultTool: 'emoji' });
    });
  }

  function renderThemePanel() {
    const wrap = shadow.querySelector('#themePanel .theme-list');
    wrap.innerHTML = UI_THEMES.map((t) => `
      <div class="theme-chip${t.id === currentThemeId ? ' active' : ''}" data-theme="${t.id}">
        <div class="theme-swatch-group">
          <div class="theme-dot" style="background:${t.base}"></div>
          <div class="theme-dot" style="background:${t.accent}"></div>
          <div class="theme-dot" style="background:${t.text}"></div>
        </div>
        <span class="theme-name">${t.name}</span>
      </div>
    `).join('');

    wrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.theme-chip');
      if (!chip) return;
      applyTheme(chip.dataset.theme);
    });
  }

  function applyTheme(themeId) {
    const theme = UI_THEMES.find((t) => t.id === themeId) || UI_THEMES[0];
    currentThemeId = theme.id;
    host.style.setProperty('--demo-accent', theme.accent);
    host.style.setProperty('--demo-base', theme.base);
    host.style.setProperty('--demo-text', theme.text);
    shadow?.querySelectorAll('.theme-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.theme === theme.id);
    });
    try { localStorage.setItem('demo-ext-theme', theme.id); } catch (_) {}
    try { chrome.storage.local.set({ 'demo-ext-theme': theme.id }); } catch (_) {}
  }

  let dragData = null;

  function bindDrawing() {
    svgOverlay.addEventListener('pointerdown', onPointerDown);
    svgOverlay.addEventListener('pointermove', onPointerMove);
    svgOverlay.addEventListener('pointerup', onPointerUp);
    svgOverlay.addEventListener('click', onSvgClick);
  }

  function svgPoint(e) {
    return { x: e.clientX, y: e.clientY };
  }

  function onPointerDown(e) {
    const { tool } = state;

    if (tool === 'move') {
      const shape = findMovableShape(e.target);
      if (shape) {
        svgOverlay.setPointerCapture(e.pointerId);
        dragData = {
          mode: 'move-svg',
          el: shape,
          startX: e.clientX,
          startY: e.clientY,
          origTx: parseFloat(shape.dataset.tx || 0),
          origTy: parseFloat(shape.dataset.ty || 0),
        };
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (!['rect', 'circle', 'arrow', 'pen', 'mosaic'].includes(tool)) return;
    svgOverlay.setPointerCapture(e.pointerId);
    const point = svgPoint(e);

    if (tool === 'pen') {
      const path = createSvg('path', {
        class: 'draw-shape',
        stroke: state.color,
        'stroke-width': state.strokeWidth,
        d: `M${point.x} ${point.y}`,
      });
      svgOverlay.appendChild(path);
      bindShapeForErase(path);
      dragData = { tool, el: path };
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (tool === 'mosaic') {
      const rect = createSvg('rect', {
        class: 'mosaic-rect',
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        fill: 'rgba(0,0,0,0)',
        stroke: '#FFD93D',
        'stroke-dasharray': '6 4',
        'stroke-width': 2,
      });
      svgOverlay.appendChild(rect);
      bindShapeForErase(rect);
      dragData = { tool, el: rect, start: point };
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    let element;
    if (tool === 'rect') {
      element = createSvg('rect', {
        class: 'draw-shape',
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        stroke: state.color,
        'stroke-width': state.strokeWidth,
      });
    } else if (tool === 'circle') {
      element = createSvg('ellipse', {
        class: 'draw-shape',
        cx: point.x,
        cy: point.y,
        rx: 0,
        ry: 0,
        stroke: state.color,
        'stroke-width': state.strokeWidth,
      });
    } else {
      const g = createSvg('g', { class: 'draw-shape draw-arrow' });
      const line = createSvg('line', {
        x1: point.x, y1: point.y, x2: point.x, y2: point.y,
        stroke: state.color, 'stroke-width': state.strokeWidth, 'stroke-linecap': 'round',
      });
      const head = createSvg('polyline', { fill: state.color, stroke: 'none', points: '' });
      g.appendChild(line);
      g.appendChild(head);
      svgOverlay.appendChild(g);
      bindShapeForErase(g);
      dragData = { tool, el: g, line, head, start: point };
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    svgOverlay.appendChild(element);
    bindShapeForErase(element);
    dragData = { tool, el: element, start: point };
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerMove(e) {
    if (!dragData) return;
    const point = svgPoint(e);

    if (dragData.mode === 'move-svg') {
      const dx = e.clientX - dragData.startX;
      const dy = e.clientY - dragData.startY;
      dragData.el.style.transform = `translate(${dragData.origTx + dx}px, ${dragData.origTy + dy}px)`;
      return;
    }

    const { tool, el, start } = dragData;

    if (tool === 'pen') {
      el.setAttribute('d', `${el.getAttribute('d')} L${point.x} ${point.y}`);
      return;
    }

    if (tool === 'rect' || tool === 'mosaic') {
      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      el.setAttribute('x', x);
      el.setAttribute('y', y);
      el.setAttribute('width', Math.abs(point.x - start.x));
      el.setAttribute('height', Math.abs(point.y - start.y));
      return;
    }

    if (tool === 'circle') {
      el.setAttribute('cx', (start.x + point.x) / 2);
      el.setAttribute('cy', (start.y + point.y) / 2);
      el.setAttribute('rx', Math.abs(point.x - start.x) / 2);
      el.setAttribute('ry', Math.abs(point.y - start.y) / 2);
      return;
    }

    if (tool === 'arrow') {
      dragData.line.setAttribute('x2', point.x);
      dragData.line.setAttribute('y2', point.y);
      const size = state.strokeWidth * 4 + 6;
      dragData.head.setAttribute('points', arrowheadPoints(start.x, start.y, point.x, point.y, size));
    }
  }

  function arrowheadPoints(x1, y1, x2, y2, size) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const p1x = x2 - size * Math.cos(angle - Math.PI / 6);
    const p1y = y2 - size * Math.sin(angle - Math.PI / 6);
    const p2x = x2 - size * Math.cos(angle + Math.PI / 6);
    const p2y = y2 - size * Math.sin(angle + Math.PI / 6);
    return `${p1x},${p1y} ${x2},${y2} ${p2x},${p2y}`;
  }

  function onPointerUp(e) {
    if (!dragData) return;
    if (dragData.mode === 'move-svg') {
      const dx = e.clientX - dragData.startX;
      const dy = e.clientY - dragData.startY;
      dragData.el.dataset.tx = String(dragData.origTx + dx);
      dragData.el.dataset.ty = String(dragData.origTy + dy);
      dragData = null;
      return;
    }
    if (dragData.tool === 'mosaic') applyMosaic(dragData.el);
    dragData = null;
  }

  function onSvgClick(e) {
    const point = svgPoint(e);
    const tool = state.tool;
    if (tool === 'text') createTextAt(point);
    else if (tool === 'step') addStepBadge(point);
    else if (tool === 'stamp') addPlacedStamp(point, state.selectedStamp);
    else if (tool === 'emoji') addPlacedEmoji(point, state.selectedEmoji);
    else if (tool === 'eraser') eraseNearest(point);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function findMovableShape(el) {
    let node = el;
    while (node && node !== svgOverlay) {
      if (node.classList && (
        node.classList.contains('draw-shape') ||
        node.classList.contains('mosaic-rect') ||
        node.classList.contains('draw-text')
      )) return node;
      node = node.parentElement;
    }
    return null;
  }

  function bindHtmlMove() {
    htmlOverlay.addEventListener('pointerdown', (e) => {
      if (state.tool !== 'move') return;
      const el = e.target.closest('.step-badge, .placed-stamp, .placed-emoji');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const origLeft = parseFloat(el.style.left || 0);
      const origTop = parseFloat(el.style.top || 0);
      const startX = e.clientX;
      const startY = e.clientY;

      function onMove(me) {
        el.style.left = `${origLeft + me.clientX - startX}px`;
        el.style.top = `${origTop + me.clientY - startY}px`;
      }
      function onUp() {
        htmlOverlay.removeEventListener('pointermove', onMove);
        htmlOverlay.removeEventListener('pointerup', onUp);
      }
      htmlOverlay.addEventListener('pointermove', onMove);
      htmlOverlay.addEventListener('pointerup', onUp);
    });
  }

  function eraseNearest(point) {
    const ERASE_RADIUS = 24;
    const candidates = [
      ...svgOverlay.querySelectorAll('.draw-shape, .mosaic-rect, .draw-text'),
      ...htmlOverlay.querySelectorAll('.step-badge, .placed-stamp, .placed-emoji'),
    ];
    let best = null;
    let bestDist = Infinity;
    candidates.forEach((el) => {
      const d = distanceToElement(el, point);
      if (d < bestDist) { bestDist = d; best = el; }
    });
    if (best && bestDist <= ERASE_RADIUS) best.remove();
  }

  function distanceToElement(el, point) {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'line') {
      const x1 = parseFloat(el.getAttribute('x1'));
      const y1 = parseFloat(el.getAttribute('y1'));
      const x2 = parseFloat(el.getAttribute('x2'));
      const y2 = parseFloat(el.getAttribute('y2'));
      return distanceToSegment(point, x1, y1, x2, y2);
    }
    if (tag === 'path' && typeof el.getTotalLength === 'function') {
      try {
        const total = el.getTotalLength();
        if (total > 0) {
          const steps = Math.min(60, Math.max(10, Math.floor(total / 6)));
          let min = Infinity;
          for (let i = 0; i <= steps; i++) {
            const p = el.getPointAtLength((total * i) / steps);
            const d = Math.hypot(point.x - p.x, point.y - p.y);
            if (d < min) min = d;
          }
          return min;
        }
      } catch (_) { /* fallthrough to bbox */ }
    }
    const r = el.getBoundingClientRect();
    const cx = Math.max(r.left, Math.min(point.x, r.right));
    const cy = Math.max(r.top, Math.min(point.y, r.bottom));
    return Math.hypot(point.x - cx, point.y - cy);
  }

  function distanceToSegment(p, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - x1, p.y - y1);
    let t = ((p.x - x1) * dx + (p.y - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
  }

  function createSvg(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const key in attrs) el.setAttribute(key, attrs[key]);
    return el;
  }

  function bindShapeForErase(el) {
    el.addEventListener('click', (e) => {
      if (state.tool === 'eraser') {
        e.stopPropagation();
        el.remove();
      }
    });
  }

  function createTextAt(point) {
    const input = document.createElement('input');
    input.className = 'text-editor';
    input.type = 'text';
    input.style.left = `${point.x}px`;
    input.style.top = `${point.y - 14}px`;
    input.style.color = state.color;
    input.style.fontSize = `${state.strokeWidth * 4 + 10}px`;
    htmlOverlay.appendChild(input);
    input.focus();
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });

    function commit() {
      if (input.value) {
        const text = createSvg('text', {
          class: 'draw-text',
          x: point.x,
          y: point.y,
          fill: state.color,
          'font-size': state.strokeWidth * 4 + 10,
        });
        text.textContent = input.value;
        svgOverlay.appendChild(text);
        bindShapeForErase(text);
      }
      input.remove();
    }
  }

  function addStepBadge(point) {
    const div = document.createElement('div');
    div.className = 'step-badge';
    div.style.left = `${point.x}px`;
    div.style.top = `${point.y}px`;
    div.style.background = state.color;
    const badgeSize = 24 + state.strokeWidth * 3;
    div.style.width = `${badgeSize}px`;
    div.style.height = `${badgeSize}px`;
    div.style.fontSize = `${badgeSize * 0.48}px`;
    div.textContent = state.stepCounter++;
    div.addEventListener('click', (e) => {
      if (state.tool === 'eraser') {
        e.stopPropagation();
        div.remove();
      }
    });
    htmlOverlay.appendChild(div);
  }

  function addPlacedStamp(point, stamp) {
    const div = document.createElement('div');
    div.className = 'placed-stamp';
    div.style.left = `${point.x}px`;
    div.style.top = `${point.y}px`;
    div.style.background = stamp.bg;
    div.style.color = stamp.color;
    div.style.fontSize = `${10 + state.strokeWidth * 2}px`;
    div.style.padding = `${4 + state.strokeWidth}px ${8 + state.strokeWidth * 2}px`;
    div.textContent = stamp.label;
    div.addEventListener('click', (e) => {
      if (state.tool === 'eraser') {
        e.stopPropagation();
        div.remove();
      }
    });
    htmlOverlay.appendChild(div);
  }

  function addPlacedEmoji(point, emoji) {
    const div = document.createElement('div');
    div.className = 'placed-emoji';
    div.style.left = `${point.x}px`;
    div.style.top = `${point.y}px`;
    div.style.fontSize = `${28 + state.strokeWidth * 4}px`;
    div.textContent = emoji;
    div.addEventListener('click', (e) => {
      if (state.tool === 'eraser') {
        e.stopPropagation();
        div.remove();
      }
    });
    htmlOverlay.appendChild(div);
  }

  function applyMosaic(rect) {
    const x = parseFloat(rect.getAttribute('x'));
    const y = parseFloat(rect.getAttribute('y'));
    const w = parseFloat(rect.getAttribute('width'));
    const h = parseFloat(rect.getAttribute('height'));
    if (w < 4 || h < 4) { rect.remove(); return; }

    const CELL = 16;
    const GAP = 3;
    const TILE = CELL - GAP;
    const cw = Math.round(w);
    const ch = Math.round(h);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(200,200,200,1.0)';
    ctx.fillRect(0, 0, cw, ch);

    for (let r = 0; r * CELL < ch; r++) {
      for (let c = 0; c * CELL < cw; c++) {
        ctx.fillStyle = state.color;
        ctx.globalAlpha = (r + c) % 2 === 0 ? 1.0 : 0.78;
        ctx.fillRect(c * CELL, r * CELL, TILE, TILE);
      }
    }
    ctx.globalAlpha = 1;

    const imgEl = createSvg('image', {
      class: 'mosaic-rect draw-shape',
      x, y, width: cw, height: ch,
      href: canvas.toDataURL(),
      preserveAspectRatio: 'none',
    });
    rect.replaceWith(imgEl);
    bindShapeForErase(imgEl);
  }

  function clearAll() {
    if (!window.confirm('描画と配置を全てクリアしますか？')) return;
    Array.from(svgOverlay.children).forEach((child) => {
      if (child.id !== 'svgHitArea') child.remove();
    });
    htmlOverlay.innerHTML = '';
    state.stepCounter = 1;
  }

  let bodyZoomActive = false;
  let zoomRingEl = null;

  function isUiPath(e) {
    const path = e.composedPath();
    if (path.includes(toolbar)) return true;
    if ([...shadow.querySelectorAll('.panel')].some((p) => path.includes(p))) return true;
    return false;
  }

  function showZoomRing(x, y) {
    removeZoomRing();
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      `left:${x}px`,
      `top:${y}px`,
      'width:70px',
      'height:70px',
      'border-radius:50%',
      'border:3px solid #FFD93D',
      'transform:translate(-50%,-50%) scale(0)',
      'transition:transform 0.16s cubic-bezier(0.34,1.56,0.64,1)',
      'pointer-events:none',
      'z-index:2147483647',
    ].join(';');
    document.documentElement.appendChild(el);
    void el.offsetWidth;
    el.style.transform = 'translate(-50%,-50%) scale(1)';
    el.style.animation = '__demoRingPulse 0.85s ease-in-out infinite 0.16s';
    zoomRingEl = el;
  }

  function removeZoomRing() {
    if (!zoomRingEl) return;
    const el = zoomRingEl;
    zoomRingEl = null;
    el.style.transition = 'transform 0.15s ease-in, opacity 0.15s ease-in';
    el.style.animation = 'none';
    el.style.transform = 'translate(-50%,-50%) scale(0)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 160);
  }

  function startBodyZoom(x, y) {
    if (bodyZoomActive) return;
    bodyZoomActive = true;
    showZoomRing(x, y);
    document.body.style.transformOrigin = `${x + window.scrollX}px ${y + window.scrollY}px`;
    document.body.style.transition = 'transform 0.18s ease-out';
    document.body.style.transform = 'scale(1.9)';
  }

  function endBodyZoom() {
    if (!bodyZoomActive) return;
    bodyZoomActive = false;
    removeZoomRing();
    document.body.style.transition = 'transform 0.22s ease-in-out';
    document.body.style.transform = 'scale(1)';
    setTimeout(() => {
      if (!bodyZoomActive) {
        document.body.style.transform = '';
        document.body.style.transition = '';
        document.body.style.transformOrigin = '';
      }
    }, 250);
  }

  function bindClickEffect() {
    document.addEventListener('click', (e) => {
      if (!state.enabled || isUiPath(e)) return;
      if (state.pikonOn) spawnPikon(e.clientX, e.clientY);
    }, true);

    document.addEventListener('pointerdown', (e) => {
      if (!state.enabled || !state.clickZoomOn || isUiPath(e)) return;
      startBodyZoom(e.clientX, e.clientY);
    }, true);

    document.addEventListener('pointerup', () => {
      if (state.clickZoomOn) endBodyZoom();
    }, true);

    document.addEventListener('pointercancel', () => {
      if (state.clickZoomOn) endBodyZoom();
    }, true);
  }

  function injectEffectStyles() {
    if (document.getElementById('__demo_ext_fx_style__')) return;
    const style = document.createElement('style');
    style.id = '__demo_ext_fx_style__';
    style.textContent = `
      .__demo-pikon {
        position: fixed; pointer-events: none;
        z-index: 2147483647; transform: translate(-50%,-50%);
        animation: __demoPikonFade 0.7s ease-out forwards;
      }
      @keyframes __demoPikonFade {
        0%   { opacity: 1; }
        20%  { opacity: 0.1; }
        40%  { opacity: 1; }
        60%  { opacity: 0.15; }
        80%  { opacity: 0.7; }
        100% { opacity: 0; }
      }
      @keyframes __demoRingPulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(255,217,61,0.55), 0 0 14px rgba(255,217,61,0.3); }
        50%     { box-shadow: 0 0 0 10px rgba(255,217,61,0), 0 0 22px rgba(255,217,61,0.5); }
      }
      @keyframes __demoRecDot {
        0%,100% { opacity: 1; }
        50%     { opacity: 0.2; }
      }
      #__looklook_rec_badge__ {
        position: fixed; top: 16px; right: 16px;
        z-index: 2147483647; pointer-events: none;
        display: flex; align-items: center; gap: 7px;
        background: rgba(30,30,30,0.88);
        color: #fff;
        border: 1.5px solid rgba(203,84,87,0.6);
        border-radius: 999px;
        padding: 6px 14px 6px 10px;
        font-family: 'M PLUS Rounded 1c', system-ui, sans-serif;
        font-size: 13px; font-weight: 700;
        box-shadow: 0 4px 18px rgba(0,0,0,0.35);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        letter-spacing: 0.03em;
        transition: opacity 0.3s;
      }
      #__looklook_rec_badge__ .rec-dot {
        width: 9px; height: 9px; border-radius: 50%;
        background: #CB5457;
        animation: __demoRecDot 1.1s ease-in-out infinite;
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }

  let recBadgeEl = null;
  let recBadgeTimer = null;

  function updateRecBadge(status, startedAt) {
    if (status === 'recording') {
      showRecBadge(startedAt);
    } else {
      hideRecBadge();
    }
  }

  function showRecBadge(startedAt) {
    if (!recBadgeEl) {
      recBadgeEl = document.createElement('div');
      recBadgeEl.id = '__looklook_rec_badge__';
      recBadgeEl.innerHTML = '<span class="rec-dot"></span><span class="rec-label">REC 00:00</span>';
      document.documentElement.appendChild(recBadgeEl);
    }
    if (recBadgeTimer) clearInterval(recBadgeTimer);
    const label = recBadgeEl.querySelector('.rec-label');
    const tick = () => {
      const elapsed = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
      const s = Math.floor(elapsed / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      label.textContent = `REC ${mm}:${ss}`;
    };
    tick();
    recBadgeTimer = setInterval(tick, 500);
  }

  function hideRecBadge() {
    if (recBadgeTimer) { clearInterval(recBadgeTimer); recBadgeTimer = null; }
    if (recBadgeEl) { recBadgeEl.remove(); recBadgeEl = null; }
  }

  function spawnClickZoom(x, y) {
    const body = document.body;
    if (body.__demoZooming) return;
    body.__demoZooming = true;

    body.style.transformOrigin = `${x + window.scrollX}px ${y + window.scrollY}px`;
    body.style.transition = 'none';
    body.style.transform = 'scale(1)';
    void body.offsetWidth;

    body.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    body.style.transform = 'scale(1.2)';

    setTimeout(() => {
      body.style.transition = 'transform 0.38s ease-out';
      body.style.transform = 'scale(1)';
      setTimeout(() => {
        body.style.transform = '';
        body.style.transition = '';
        body.style.transformOrigin = '';
        body.__demoZooming = false;
      }, 400);
    }, 330);
  }

  function spawnPikon(x, y) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '120');
    svg.setAttribute('height', '120');
    svg.setAttribute('viewBox', '-60 -60 120 120');
    svg.classList.add('__demo-pikon');
    svg.style.cssText = `left:${x}px;top:${y}px;`;

    // 3本扇形、左上方向（225°中心、±25°）
    const fans = [
      { deg: 195, r1: 18, r2: 44, w: 6, color: '#FFAB00' },
      { deg: 222, r1: 18, r2: 46, w: 6, color: '#FFD93D' },
      { deg: 249, r1: 18, r2: 44, w: 6, color: '#FF8C42' },
    ];
    fans.forEach(({ deg, r1, r2, w, color }) => {
      const a = deg * Math.PI / 180;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', Math.cos(a) * r1);
      line.setAttribute('y1', Math.sin(a) * r1);
      line.setAttribute('x2', Math.cos(a) * r2);
      line.setAttribute('y2', Math.sin(a) * r2);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', w);
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    });

    document.body.appendChild(svg);
    setTimeout(() => svg.remove(), 700);
  }

  function bindSpotlight() {
    document.addEventListener('mousemove', (e) => {
      if (!state.spotlightOn) return;
      spotlightEl.style.setProperty('--mx', `${e.clientX}px`);
      spotlightEl.style.setProperty('--my', `${e.clientY}px`);
    });
  }

  function setSpotlight(on) {
    state.spotlightOn = on;
    spotlightEl?.classList.toggle('on', on);
  }

  function bindKeystroke() {
    document.addEventListener('keydown', (e) => {
      if (!state.keystrokeOn) return;
      const keys = [];
      if (e.metaKey) keys.push('⌘');
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('⌥');
      if (e.shiftKey) keys.push('⇧');
      if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
        keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
      }
      if (keys.length) showKey(keys.join(' + '));
    }, true);
  }

  function showKey(label) {
    keystrokeEl.innerHTML = '';
    const chip = document.createElement('div');
    chip.className = 'key-chip';
    chip.textContent = label;
    keystrokeEl.appendChild(chip);
    clearTimeout(keystrokeEl.__t);
    keystrokeEl.__t = setTimeout(() => {
      keystrokeEl.innerHTML = '';
    }, 1500);
  }

  function setKeystroke(on) {
    state.keystrokeOn = on;
    keystrokeEl?.classList.toggle('on', on);
    if (!on && keystrokeEl) keystrokeEl.innerHTML = '';
  }

  function openRecorder() {
    chrome.runtime.sendMessage({ type: 'POPUP_OPEN_RECORDER', autoStart: false })
      .then((res) => {
        if (res && !res.ok) {
          console.error('[Look!Look!] recorder open failed:', res.error);
        }
      })
      .catch((err) => {
        console.error('[Look!Look!] recorder message failed:', err);
        // service worker が死んでいる場合にフォールバックで再送
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'POPUP_OPEN_RECORDER', autoStart: false })
            .catch(() => {});
        }, 500);
      });
  }

  function makeDraggable(target, handle) {
    let sx, sy, ox, oy, drag = false;

    function beginDrag(e, captureEl) {
      drag = true;
      sx = e.clientX; sy = e.clientY;
      const rect = target.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      captureEl.setPointerCapture(e.pointerId);
      target.classList.add('dragging');
    }

    function onMove(e) {
      if (!drag) return;
      const tw = target.offsetWidth || 56;
      const th = target.offsetHeight || 200;
      const left = Math.max(0, Math.min(window.innerWidth - tw, ox + e.clientX - sx));
      const top  = Math.max(0, Math.min(window.innerHeight - th, oy + e.clientY - sy));
      target.style.left = `${left}px`;
      target.style.top  = `${top}px`;
      target.style.right = 'auto';
      state.toolbarPosition = { left, top };
    }

    function onUp() {
      if (!drag) return;
      drag = false;
      target.classList.remove('dragging');
      if (state.rememberToolbarPosition) persistSettings({ toolbarPosition: state.toolbarPosition });
    }

    // ドラッグハンドルから掴む
    handle.addEventListener('pointerdown', (e) => beginDrag(e, handle));
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);

    // ツールバー本体の背景（ボタン以外）からも掴める
    target.addEventListener('pointerdown', (e) => {
      if (e.target !== target) return;
      beginDrag(e, target);
    });
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }

  function applySettingsToState(settings) {
    currentSettings = cloneSettings(settings);
    state.tool = settings.defaultTool;
    state.color = settings.defaultColor;
    state.strokeWidth = settings.defaultStrokeWidth;
    state.pikonOn = settings.pikonEnabled;
    state.clickZoomOn = Boolean(settings.clickZoomEnabled) || Boolean(settings.magnifierEnabled);
    state.spotlightOn = settings.spotlightEnabled;
    state.keystrokeOn = settings.keystrokeEnabled;
    state.rememberToolbarPosition = settings.rememberToolbarPosition;
    state.toolbarPosition = { ...settings.toolbarPosition };
    state.selectedStampIndex = clamp(settings.selectedStampIndex, 0, STAMPS.length - 1);
    state.selectedStamp = STAMPS[state.selectedStampIndex] || STAMPS[0];
    state.selectedEmojiIndex = clamp(settings.selectedEmojiIndex, 0, EMOJIS.length - 1);
    state.selectedEmoji = EMOJIS[state.selectedEmojiIndex] || EMOJIS[0];
  }

  function applyStateToUi() {
    if (!shadow || !toolbar) return;
    setTool(state.tool, { persist: false });
    syncColorPalette();
    syncStrokeSlider();
    syncStampPanel();
    syncEmojiPanel();
    syncToggleButtons();
    setSpotlight(state.spotlightOn);
    setKeystroke(state.keystrokeOn);
    applyToolbarPosition();
  }

  function applyToolbarPosition() {
    if (!toolbar || !state.rememberToolbarPosition) return;
    toolbar.style.left = `${state.toolbarPosition.left}px`;
    toolbar.style.top = `${state.toolbarPosition.top}px`;
    toolbar.style.right = 'auto';
  }

  function syncColorPalette() {
    shadow?.querySelectorAll('.swatch').forEach((swatch) => {
      swatch.classList.toggle('active', swatch.dataset.color === state.color);
    });
  }

  function syncStrokeSlider() {
    const px = Math.min(20, Math.max(2, state.strokeWidth));
    shadow?.querySelectorAll('.size-slider').forEach((s) => { s.value = state.strokeWidth; });
    const mainSlider = shadow?.getElementById('strokeSlider');
    if (mainSlider) mainSlider.value = state.strokeWidth;
    ['strokeNum', 'stampSizeNum', 'emojiSizeNum'].forEach((id) => {
      const el = shadow?.getElementById(id);
      if (el) el.textContent = state.strokeWidth;
    });
    ['strokePreviewDot', 'stampSizeDot', 'emojiSizeDot'].forEach((id) => {
      const dot = shadow?.getElementById(id);
      if (dot) { dot.style.width = `${px}px`; dot.style.height = `${px}px`; }
    });
  }

  function syncStampPanel() {
    shadow?.querySelectorAll('.stamp-chip').forEach((chip) => {
      chip.classList.toggle('active', Number(chip.dataset.i) === state.selectedStampIndex);
    });
  }

  function syncEmojiPanel() {
    shadow?.querySelectorAll('.emoji-chip').forEach((chip) => {
      chip.classList.toggle('active', Number(chip.dataset.i) === state.selectedEmojiIndex);
    });
  }

  function syncToggleButtons() {
    const toggles = {
      spotlight: state.spotlightOn,
      magnifier: state.clickZoomOn,
      keystroke: state.keystrokeOn,
      pikon: state.pikonOn,
    };
    Object.entries(toggles).forEach(([name, on]) => {
      shadow?.querySelector(`[data-toggle="${name}"]`)?.classList.toggle('active', on);
    });
  }

  function persistSettings(patch) {
    if (!STORAGE?.saveSettings) return;
    void STORAGE.saveSettings(patch).then((settings) => {
      currentSettings = settings;
    }).catch(() => {});
  }

  function cloneSettings(settings) {
    return JSON.parse(JSON.stringify(settings));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });
  }
})();
