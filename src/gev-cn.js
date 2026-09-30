/* ═══════════════════════════════════════════════════════════════
   GEV 中文增强包 —— 界面汉化层（非侵入式）
   由 index.html 以模块加载；删除该 <script> 即完全还原。
   原理：EN→ZH 字典 + MutationObserver，覆盖静态模板与运行期动态文本。
   只替换“已知英文串”，不改动任何应用逻辑；翻译结果本身不再命中字典，
   因此不会产生观察器回环。
   ═══════════════════════════════════════════════════════════════ */

import GEV_CN_EXTRA from './gev-cn-dict.js';

const DICT = {
  // ── 全局 / 加载 ──
  'NO PLACE LEFT BEHIND': '无一遗漏之地',
  'ACTIVE STYLE': '当前风格',
  'Initializing photorealistic world...': '正在初始化真实地球…',
  'LOADING LIVE DATA': '正在加载实时数据',
  'syncing road network': '正在同步路网',
  'loading frames': '正在加载画面',
  PARAMETERS: '参数',
  Ready: '就绪',

  // ── 视觉风格名 ──
  NORMAL: '常规',
  CRT: '绿屏 CRT',
  NVG: '夜视仪',
  FLIR: '热成像',
  ANIME: '动漫',
  NOIR: '黑白胶片',
  SNOW: '雪原',
  AMBER: '琥珀',
  GHOST: '幽灵',
  IRON: '铁红',
  XRAY: 'X光',
  CINE: '电影',

  // ── 顶部操作 / 提示 ──
  'Turn off all selected data layers': '关闭所有已选数据图层',
  'Copy share link': '复制分享链接',
  'Toggle straight-down and tilted map views': '切换俯视 / 倾斜视角',
  'Reset map bearing to north': '重置为正北',
  'Reset camera and return to full globe view': '重置镜头，回到全球视角',
  'Reset cockpit to full globe view': '重置驾驶舱，回到全球视角',
  'Exit cockpit view': '退出驾驶舱',
  'Exit cockpit and return to full globe view': '退出驾驶舱，回到全球视角',
  'Collapse panel': '折叠面板',
  'Expand panel': '展开面板',

  // ── 显示面板 DISPLAY ──
  HUD: 'HUD',
  Tactical: '战术',
  Operator: '操作员',
  Minimal: '极简',
  Cyber: '赛博',
  Layout: '布局',
  Sonar: '声呐',
  Rings: '环数',
  Range: '范围',
  Power: '强度',
  Opacity: '不透明度',
  Sector: '扇区',
  DETECT: '探测',
  Density: '密度',
  Allocation: '分配',
  Elastic: '弹性',
  Weighted: '加权',
  Fade: '淡出',
  Outside: '外侧',
  Models: '模型',
  Proximity: '近距离',
  All: '全部',
  Scope: '取景',
  Feather: '羽化',
  Draw: '绘制',
  Shape: '形状',
  Area: '区域',
  Line: '线条',
  Pin: '标记',
  'Label (optional)': '标签（可选）',
  Primary: '主色',
  Amber: '琥珀',
  Cyan: '青色',
  Green: '绿色',
  Red: '红色',
  Clear: '清除',
  Celestial: '天球环',
  'Clean UI': '清爽界面',
  Bloom: '泛光',
  Sharpen: '锐化',
  'EXIT CLEAN VIEW': '退出清爽界面',

  // ── 底部命令坞 ──
  'VISUAL PRESETS': '视觉预设',
  LOCATION: '位置',
  'Location: --': '位置：--',
  'Landmark: --': '地标：--',
  'Search any location...': '搜索任意地点…',
  'Search any location': '搜索地点',
  'MAP SOURCE': '地图源',
  'Expand Visual Presets': '展开视觉预设',
  'Pin visual presets': '固定视觉预设',
  'Keep visual presets open': '保持视觉预设展开',
  'Pin location tray': '固定位置栏',
  'Keep location tray open': '保持位置栏展开',

  // ── 数据图层 / 监控 / 场景 ──
  'DATA LAYERS': '数据图层',
  CCTV: '监控',
  SCENES: '场景',
  NEW: '新建',
  DEL: '删除',
  'CAPTURE SHOT': '截取镜头',
  'UPDATE SHOT': '更新镜头',
  START: '开始',
  STOP: '停止',
  NEXT: '下一个',
  PREV: '上一个',
  'EXPORT PRESETS': '导出预设',
  IMPORT: '导入',
  'RUN LOG': '运行日志',
  'SOURCE · UNKNOWN': '来源 · 未知',
  'Enable CCTV to load camera intersections': '启用监控以加载路口摄像头',
  'CCTV OFF': '监控 关',
  'CCTV ON': '监控 开',
  NEAREST: '最近',
  FOCUS: '聚焦',
  'COVERAGE OFF': '覆盖 关',
  'COVERAGE ON': '覆盖 开',
  'AUTO HOP OFF': '自动跳转 关',
  'AUTO HOP ON': '自动跳转 开',
  'PROJECTION ON': '投影 开',
  'PROJECTION OFF': '投影 关',
  CALIBRATION: '标定',
  ADJUST: '调整',
  'SAVE CAL': '保存标定',
  'RESET CAL': '重置标定',
  'SCENE SUMMARY': '场景摘要',
  'Enable CCTV to start camera-linked intelligence summaries.':
    '启用监控以开始摄像头关联的情报摘要。',

  // ── 上下文 / 天气 / 影像 / 电台 / SDR ──
  WEATHER: '天气',
  'RECENT IMAGERY': '近期影像',
  CONTEXT: '上下文',
  RADIO: '电台',
  'SELECT CONTEXT': '选择上下文',
  CONTACTS: '接触目标',
  'SPACE MISSIONS': '太空任务',
  COCKPIT: '驾驶舱',
  'SEARCH NEARBY SITES': '搜索附近设施',
  'CONTACTS CONTEXT OFF': '接触目标上下文已关闭',
  'SELECT CONTACTS TO LOAD OBSERVED / MAPPED PROXIMITY':
    '选择接触目标以加载已观测 / 已测绘的邻近信息',
  'AVAILABLE MISSIONS': '可用任务',
  'SELECT A MISSION TO INSPECT': '选择任务以查看',
  'LOADING 30-DAY MISSION INDEX': '正在加载 30 天任务索引',
  'TAB PREVIEWS · ENTER / SPACE SELECTS': 'Tab 预览 · 回车 / 空格 选择',
  ENABLE: '启用',
  PLAY: '播放',
  VOLUME: '音量',
  'STATION TAG': '电台标签',
  'NO STATION SELECTED': '未选择电台',
  'Enable Radio, then choose a globe marker or use next.':
    '启用电台，然后在地球上选择标记或点“下一个”。',
  'DIRECTORY BAND': '目录波段',
  'DRAG TO TUNE': '拖动调谐',
  'ALL · DRAG THE NEEDLE': '全部 · 拖动指针',
  'SNAPS TO AVAILABLE STATIONS': '自动吸附到可用电台',
  'Radio off': '电台已关闭',
  'STATION SITE': '电台网站',
  'DIRECTORY: RADIO BROWSER': '目录：RADIO BROWSER',
  'LOCAL RTL-SDR': '本地 RTL-SDR',
  'NO USB': '未连接 USB',
  CONNECT: '连接',
  LOCATE: '定位',
  'CHANGE DEVICE': '更换设备',
  GAIN: '增益',
  'ADS-B · 1090': 'ADS-B · 1090',
  'FM MHZ': '调频 MHz',
  TUNE: '调谐',
  'SDR VOL': 'SDR 音量',
  'Connect an RTL-SDR to begin.': '连接 RTL-SDR 以开始。',
  'Audio connects directly to the broadcaster after you press play. Your IP is visible to that broadcaster.':
    '按下播放后，音频将直连到电台方；你的 IP 对其可见。',
  'Chrome/Edge · WebUSB · one local tuner shared by FM and the Local ADS-B layer.':
    'Chrome/Edge · WebUSB · 一个本地调谐器，供 FM 与本地 ADS-B 图层共用。',

  // ── Power Up / 密钥 ──
  'POWER UP': '启动引擎',
  'Power up the globe': '启动地球',
  'GROUND STATION · PROVIDER SETTINGS': '地面站 · 数据源设置',
  'SAVE KEYS': '保存密钥',
  'ESC to close': 'ESC 关闭',
  'ESC to dismiss': 'ESC 关闭',
  'Close key setup': '关闭密钥设置',
  'The Google Maps key buys the photorealistic planet — everything else stacks on top.':
    'Google Maps 密钥用于解锁照片级真实地球——其余数据都叠加其上。',
  "The globe already flies keyless. Every key below switches on another real feed — paste one and it's saved into this app's local configuration, then the server restarts itself. Server-side keys stay on this machine; Google Maps and Cesium ion run in the browser and must be provider-restricted. Keys you configured elsewhere are shown but never touched.":
    '地球无需任何密钥即可运行。下面每个密钥都会多开启一路真实数据——粘贴后即保存到本应用的本地配置，服务器会自动重启。服务端密钥只留在本机；Google Maps 与 Cesium ion 在浏览器中运行，需在服务商侧做限制。你在别处配置的密钥只做展示，绝不会被改动。',

  // ── 首次启动 ──
  'MISSION CONTROL · FIRST LAUNCH': '任务控制 · 首次启动',
  'Choose your first view': '选择你的第一视角',
  'It feels like a forbidden cockpit—then you realize the sources are public and the data is real.':
    '像坐进了一间禁地驾驶舱——随后你会发现：数据源公开，数据真实。',
  'LIVE CONTACTS': '实时接触目标',
  'Aircraft, vessels and nearby intelligence': '航空器、船舶与周边情报',
  'Launches, spacecraft and orbital context': '发射、航天器与在轨态势',
  ENVIRONMENTAL: '环境灾害',
  'Live earthquakes and active fires, from USGS and NASA':
    '来自 USGS 与 NASA 的实时地震与活跃火点',
  'EXPLORE MANUALLY': '自由探索',
  'Begin with a clean globe': '从一张干净的地球开始',
  "Don't show this again": '不再显示',
  'Tip: the GEV MIC button in the dock lets you talk to the map.':
    '提示：点击底部工具栏的 GEV 麦克风按钮即可对着地图说话。',

  // ── 驾驶舱 ──
  'FIRST PERSON': '第一人称',
  AIRCRAFT: '航空器',
  'LIVE TRACK · COURSE ALIGNED': '实时追踪 · 航向已对准',
  CURRENT: '当前',
  'GROUND SPEED': '地速',
  ALTITUDE: '高度',
  KTS: '节',
  FT: '英尺',
  LEVEL: '水平',
  CONTACT: '接触目标',
  'CONTACTS · 250 KM': '接触目标 · 250 公里',
  'CONTEXT ONLY': '仅供参考',
  'NEAREST OBSERVED / MAPPED': '最近的已观测 / 已测绘',
  'NO AVAILABLE EXAMPLE': '暂无可用样本',
  'AVAILABLE INPUTS ONLY · NOT AN ALL-CLEAR': '仅基于可用输入 · 非无异常确认',
  OFF: '关',
  ON: '开',
  'ESTIMATED FLIGHT PLAN': '推定飞行计划',
  'ROUTE DATA UNAVAILABLE': '航线数据不可用',
  FROM: '出发',
  TO: '到达',
  UNKNOWN: '未知',
  'LIVE SIGNALS': '实时信号',
  'OBSERVED / MAPPED PINGS': '已观测 / 已测绘的信号',
  'CYCLE OFF': '循环 关',
  'ACQUIRING REGIONAL NEWS': '正在获取区域新闻',
  'RESOLVING REGION': '正在解析区域',
  TEMP: '气温',
  WIND: '风',
  SKY: '天空',
  PRECIP: '降水',
  MM: '毫米',
  'SOURCE-BACKED EVENTS · NO SYNTHETIC NEWS': '有据可查的事件 · 无合成新闻',
  RESET: '重置',
  'EXIT COCKPIT': '退出驾驶舱',

  // ── 常见动态数据图层名 ──
  Flights: '航班',
  'Military Flights': '军机',
  Earthquakes: '地震',
  Satellites: '卫星',
  'Rocket missions': '火箭任务',
  'Submarine cables': '海底光缆',
  Traffic: '交通',
  Vessels: '船舶',
  'Active Fires': '活跃火点',
  Weather: '天气',
  Wind: '风场',
  Cyclones: '气旋',
  Bikeshare: '共享单车',
  Datacenters: '数据中心',
  'Military Installations': '军事设施',
  'Recent Imagery': '近期影像',
  Radio: '电台',
  'Local ADS-B': '本地 ADS-B',
  Awareness: '态势感知',
  Transit: '公共交通',
  'Live Flights': '实时航班',
  DISPLAY: '显示',
  SUMMARY: '摘要',
  MOVEMENT: '移动目标',
  'VOICE STANDBY': '语音待命',
  STD: '标准',
  'Live Vessels': '实时船舶',
  'Live Traffic': '实时交通',
  'Live Satellites': '实时卫星',
};

// 合并外置的二级选项全量字典
Object.assign(DICT, GEV_CN_EXTRA);

// 组合串中的短语替换（长短语在前，避免误伤）
const PHRASES = [
  ['POWER UP', '启动引擎'],
  ['KEYS WAITING', ' 个密钥待配置'],
  ['GLOBAL SECTOR', '全球区域'],
  ['NORTH AMERICA', '北美洲'],
  ['SOUTH AMERICA', '南美洲'],
  ['Live Flights', '实时航班'],
  ['TOP SECRET', '绝密'],
  ['NOFORN', '禁止外传'],
  ['MOVEMENT', '移动目标'],
  ['SUMMARY', '摘要'],
  [' ago', ' 前'],
  ['never', '从未'],
  ['Delete scene', '删除场景'],
  ['and all shots?', '及其全部镜头？'],
  ['Delete shot', '删除镜头'],
  ['Shot ', '镜头 '],
];

const LOWER = Object.fromEntries(
  Object.entries(DICT).map(([k, v]) => [k.toLowerCase(), v]),
);

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'CODE',
  'PRE',
  'CANVAS',
]);

let enabled = true;
const seen = new WeakSet();

function tr(value) {
  if (!value) return null;
  const key = value.trim();
  if (!key) return null;
  // 1) 整串精确匹配
  const hit = DICT[key];
  if (hit && hit !== value) return value.replace(key, hit);
  // 2) 大小写不敏感回退（DOM 常是小写源文，靠 CSS text-transform 显示大写）
  const lhit = LOWER[key.toLowerCase()];
  if (lhit && lhit !== key) return value.replace(key, lhit);
  // 3) 组合串：对已知短语做替换
  let out = value;
  let changed = false;
  for (const [en, zh] of PHRASES) {
    if (out.includes(en)) {
      out = out.split(en).join(zh);
      changed = true;
    }
  }
  return changed && out !== value ? out : null;
}

function translateNode(node) {
  if (node.nodeType === 3) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) return;
    if (parent.isContentEditable) return;
    const out = tr(node.nodeValue);
    if (out !== null) node.nodeValue = out;
    return;
  }
  if (node.nodeType !== 1) return;
  if (SKIP_TAGS.has(node.tagName)) return;
  if (node.isContentEditable) return;
  for (const a of ATTRS) {
    if (node.hasAttribute(a)) {
      const out = tr(node.getAttribute(a));
      if (out !== null) node.setAttribute(a, out);
    }
  }
  for (const child of node.childNodes) translateNode(child);
}

function walk(root) {
  if (!enabled || !root) return;
  if (root.nodeType === 1 || root.nodeType === 3) {
    if (root.nodeType === 1 && seen.has(root)) return;
    translateNode(root);
    if (root.nodeType === 1) seen.add(root);
  }
}

// 选项框自适应：原生下拉按当前选项文字宽度撑开（有上下限）
const _measCtx = document.createElement('canvas').getContext('2d');
function _textWidth(text, font) {
  if (!_measCtx) return 0;
  _measCtx.font = font;
  return _measCtx.measureText(String(text || '')).width;
}
function fitOptionBoxes() {
  document.querySelectorAll('select').forEach((el) => {
    const opt = el.selectedOptions && el.selectedOptions[0];
    if (!opt) return;
    const cs = getComputedStyle(el);
    const font = [cs.fontWeight, cs.fontSize, cs.fontFamily].join(' ');
    const w = Math.ceil(_textWidth(opt.textContent.trim(), font)) + 44;
    el.style.width = 'auto';
    el.style.minWidth = Math.min(Math.max(w, 78), 320) + 'px';
  });
}

function translateTree() {
  walk(document.body);
  fitOptionBoxes();
  document.title = document.title.includes('God')
    ? "上帝之眼 · God's Eye View"
    : document.title;
  document.documentElement.lang = 'zh-CN';
  document.body.classList.add('gev-zh');
}

const observer = new MutationObserver((records) => {
  if (!enabled) return;
  for (const r of records) {
    if (r.type === 'characterData') walk(r.target);
    else r.addedNodes.forEach(walk);
  }
});

function setEnabled(on) {
  enabled = on;
  document.body.classList.toggle('gev-zh', on);
  if (on) translateTree();
  const pill = document.getElementById('gev-lang-toggle');
  if (pill) pill.dataset.on = on ? '1' : '0';
}

function mount() {
  translateTree();
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // 若干延迟补译，兜住运行期异步渲染的面板
  [400, 1200, 2600, 5000, 9000].forEach((t) => setTimeout(translateTree, t));
  // 下拉切换后重新自适应宽度
  document.addEventListener(
    'change',
    (e) => {
      if (e.target && e.target.tagName === 'SELECT') fitOptionBoxes();
    },
    true,
  );

  // 中 / EN 切换药丸
  if (!document.getElementById('gev-lang-toggle')) {
    const pill = document.createElement('button');
    pill.id = 'gev-lang-toggle';
    pill.type = 'button';
    pill.dataset.on = '1';
    pill.setAttribute('aria-label', '在中英文界面之间切换');
    pill.innerHTML =
      '<span class="gev-zh-on">中</span><span>/</span><span>EN</span>';
    pill.addEventListener('click', () => setEnabled(!enabled));
    document.body.appendChild(pill);
  }

  window.__gevCn = {
    on: () => setEnabled(true),
    off: () => setEnabled(false),
    toggle: () => setEnabled(!enabled),
    dict: DICT,
  };
}

// 翻译原生 prompt / confirm 文案（非侵入包装，用于场景新建/删除确认）
const _nativePrompt = window.prompt.bind(window);
const _nativeConfirm = window.confirm.bind(window);
const _trRaw = (s) => (typeof s === 'string' ? (tr(s) ?? s) : s);
window.prompt = (msg, def) => _nativePrompt(_trRaw(msg), def);
window.confirm = (msg) => _nativeConfirm(_trRaw(msg));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
