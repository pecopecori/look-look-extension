// 50色パレット（タイムカード拡張のテイストを継承しつつポップに）
// content_scripts と popup/settings の両方から使うので globalThis に登録
(function () {
  const PALETTE_50 = [
    '#FF6B6B', '#FF8C42', '#FFB627', '#FFD93D', '#F7E967',
    '#A6B5A5', '#7BC47F', '#4CAF50', '#2E8B57', '#0F9D58',
    '#9EC2C2', '#28A6A5', '#00BCD4', '#0097A7', '#006064',
    '#769CBF', '#4A90E2', '#1E88E5', '#135389', '#0D47A1',
    '#A883A9', '#9C27B0', '#D99AAD', '#D86F87', '#E91E63',
    '#CB5457', '#AA4D53', '#CF7F72', '#E74C3C', '#C0392B',
    '#D49B65', '#CD8858', '#E97F12', '#FF7043', '#8D6E63',
    '#FFEB3B', '#FFC107', '#FFAB00', '#FFD600', '#F4D03F',
    '#37474F', '#546E7A', '#78909C', '#90A4AE', '#B0BEC5',
    '#FFFFFF', '#F4EBDA', '#BDBDBD', '#616161', '#262724',
  ];

  const DEFAULT_THEME = {
    accent: '#A6B5A5',
    base: '#F4EBDA',
    text: '#262724',
  };

  globalThis.DEMO_EXT_PALETTE = PALETTE_50;
  globalThis.DEMO_EXT_THEME = DEFAULT_THEME;
})();
