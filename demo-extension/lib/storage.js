(function () {
  const STORAGE_KEY = 'lookLookSettings';

  const DEFAULT_SETTINGS = Object.freeze({
    defaultTool: 'pointer',
    defaultColor: '#A6B5A5',
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
    recorder: {
      includeMic: true,
      filenamePrefix: 'looklook-recording',
    },
  });

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  function clampNumber(value, fallback, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function sanitizeChoice(value, fallback, allowed) {
    return allowed.includes(value) ? value : fallback;
  }

  function normalizeSettings(raw = {}) {
    const settings = cloneDefaults();
    const recorder = raw.recorder || {};
    const toolbarPosition = raw.toolbarPosition || {};

    settings.defaultTool = sanitizeChoice(raw.defaultTool, settings.defaultTool, [
      'pointer', 'move', 'rect', 'circle', 'arrow', 'pen', 'text', 'mosaic', 'step', 'stamp', 'emoji', 'eraser',
    ]);
    settings.defaultColor = typeof raw.defaultColor === 'string' ? raw.defaultColor : settings.defaultColor;
    settings.defaultStrokeWidth = sanitizeChoice(Number(raw.defaultStrokeWidth), settings.defaultStrokeWidth, [2, 4, 8, 14]);
    settings.pikonEnabled = raw.pikonEnabled !== undefined ? Boolean(raw.pikonEnabled) : settings.pikonEnabled;
    settings.clickZoomEnabled = raw.clickZoomEnabled !== undefined ? Boolean(raw.clickZoomEnabled) : settings.clickZoomEnabled;
    settings.spotlightEnabled = raw.spotlightEnabled !== undefined ? Boolean(raw.spotlightEnabled) : settings.spotlightEnabled;
    settings.magnifierEnabled = raw.magnifierEnabled !== undefined ? Boolean(raw.magnifierEnabled) : settings.magnifierEnabled;
    settings.keystrokeEnabled = raw.keystrokeEnabled !== undefined ? Boolean(raw.keystrokeEnabled) : settings.keystrokeEnabled;
    settings.selectedStampIndex = clampNumber(raw.selectedStampIndex, settings.selectedStampIndex, 0, 99);
    settings.selectedEmojiIndex = clampNumber(raw.selectedEmojiIndex, settings.selectedEmojiIndex, 0, 99);
    settings.rememberToolbarPosition = raw.rememberToolbarPosition !== undefined
      ? Boolean(raw.rememberToolbarPosition)
      : settings.rememberToolbarPosition;
    settings.toolbarPosition = {
      top: clampNumber(toolbarPosition.top, settings.toolbarPosition.top, 0, 10000),
      left: clampNumber(toolbarPosition.left, settings.toolbarPosition.left, 0, 10000),
    };
    settings.recorder = {
      includeMic: recorder.includeMic !== undefined ? Boolean(recorder.includeMic) : settings.recorder.includeMic,
      filenamePrefix: typeof recorder.filenamePrefix === 'string' && recorder.filenamePrefix.trim()
        ? recorder.filenamePrefix.trim().slice(0, 80)
        : settings.recorder.filenamePrefix,
    };

    return settings;
  }

  function deepMerge(base, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    const output = Array.isArray(base) ? [...base] : { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        output[key] = deepMerge(base?.[key] || {}, value);
      } else {
        output[key] = value;
      }
    }
    return output;
  }

  async function loadSettings() {
    if (!chrome?.storage?.local) return cloneDefaults();
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeSettings(result[STORAGE_KEY]);
  }

  async function saveSettings(patch, { merge = true } = {}) {
    if (!chrome?.storage?.local) return normalizeSettings(patch);
    const next = merge
      ? normalizeSettings(deepMerge(await loadSettings(), patch))
      : normalizeSettings(patch);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function resetSettings() {
    const next = cloneDefaults();
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
    }
    return next;
  }

  globalThis.DEMO_EXT_STORAGE = {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    resetSettings,
  };
})();
