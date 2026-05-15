// テキストスタンプ＆絵文字プリセット
(function () {
  const STAMP_PRESETS = [
    { label: 'ここ！', bg: '#FFD93D', color: '#262724' },
    { label: 'Check!', bg: '#7BC47F', color: '#FFFFFF' },
    { label: '重要', bg: '#CB5457', color: '#FFFFFF' },
    { label: 'NEW', bg: '#FF6B6B', color: '#FFFFFF' },
    { label: 'OK', bg: '#4CAF50', color: '#FFFFFF' },
    { label: 'NG', bg: '#E74C3C', color: '#FFFFFF' },
    { label: 'やってみよう', bg: '#FFAB00', color: '#262724' },
    { label: 'ポイント', bg: '#A6B5A5', color: '#FFFFFF' },
    { label: 'TIPS', bg: '#769CBF', color: '#FFFFFF' },
    { label: 'NOTE', bg: '#A883A9', color: '#FFFFFF' },
  ];

  const EMOJI_PRESETS = [
    '🎉', '✨', '👀', '👇', '👆', '👉', '👈',
    '⭐️', '💡', '🔥', '⚡️', '💯', '✅', '❌',
    '❤️', '💪', '🙌', '👏', '🤔', '😊', '😱',
    '🚀', '🎯', '📌', '📢', '🔔', '⏰', '🆕',
  ];

  globalThis.DEMO_EXT_STAMPS = STAMP_PRESETS;
  globalThis.DEMO_EXT_EMOJIS = EMOJI_PRESETS;
})();
