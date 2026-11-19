import { TECHS, TEMPLATES } from './entities';
import { CivId, MapType, ResolvedMapType, ResourceBag, ResourceType, UnitOrder, UnitStance } from './types';

type OrderType = UnitOrder['type'];

export type Language = 'zh-TW' | 'en';

const STORAGE_KEY = 'web0ad_lang';

function detectInitialLang(): Language {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'zh-TW' || saved === 'en') return saved;
    } catch {
      // ignore storage errors
    }
    if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) {
      return 'zh-TW';
    }
  }
  return 'en';
}

let currentLang: Language = detectInitialLang();

export function getLanguage(): Language {
  return currentLang;
}

export function setLanguage(lang: Language): void {
  currentLang = lang;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.title = lang === 'zh-TW' ? '0 A.D. 網頁版 — 帝國崛起' : '0 A.D. Web — Empires Ascendant';
    }
  }
}

export function toggleLanguage(): Language {
  const next: Language = currentLang === 'zh-TW' ? 'en' : 'zh-TW';
  setLanguage(next);
  return next;
}

const UI_STRINGS = {
  en: {
    resFood: 'Food',
    resWood: 'Wood',
    resStone: 'Stone',
    resMetal: 'Metal',
    resFoodTip: 'Food (Berries, Hunting & Wheat Fields)',
    resWoodTip: 'Wood (Cypress, Olive, Pine & Oak Groves)',
    resStoneTip: 'Stone (Limestone & Marble Quarries)',
    resMetalTip: 'Metal (Copper, Iron & Gold Veins)',
    resPopTip: 'Population Used / Limit (Build Houses to raise limit)',
    phase1: 'Phase I: Village',
    phase2: 'Phase II: Town',
    idleBtn: 'Idle',
    idleTip: 'Select Idle Worker (Hotkey: .)',
    captureBtn: '🚩 Capture',
    destroyBtn: '🔥 Destroy',
    modeTip: 'Right-click enemy buildings mode (Hotkey: C)',
    pauseBtn: '⏸ Pause',
    resumeBtn: '▶ Resume',
    speedTip: 'Toggle Simulation Speed',
    edgeBtn: '🖱️ Edge',
    edgeTip: 'Toggle Mouse Screen-Edge Scrolling',
    mapBtn: '👁️ Map',
    mapTip: 'Toggle Fog of War',
    musicOn: '🎵 Music',
    musicOff: '🎵 Off',
    musicTip: 'Toggle Background Music',
    sfxOn: '🔊 SFX',
    sfxOff: '🔇 SFX',
    sfxTip: 'Toggle Action & Combat Sound Effects',
    langBtn: '🌐 中文',
    langTip: 'Switch Language (繁體中文 / English)',
    randomMapBtn: '🎲 Random',
    randomMapTip: 'Generate a brand new Random Map & Resources',
    newMatchBtn: '⚙️ New',
    newMatchTip: 'Open New Match Setup',
    setupTitle: '🏛️ 0 A.D. — Skirmish Match Setup',
    labelPlayerCiv: 'Your Civilization',
    labelAiCiv: 'AI Opponent Civilization',
    labelDifficulty: 'AI Difficulty',
    labelMapType: 'Map Type',
    labelSeed: 'Map Seed (blank = random)',
    seedPlaceholder: 'Leave blank for random seed',
    optAthenPlayer: 'Athenians (+10% Food/Wood, +1 Infantry Pierce Armor)',
    optRomePlayer: 'Romans (+10% Infantry Attack, +15% Building HP)',
    optRomeAi: 'Romans (Petra AI)',
    optAthenAi: 'Athenians (Petra AI)',
    optDiffEasy: 'Easy (Relaxed Skirmish)',
    optDiffMedium: 'Medium (Balanced)',
    optDiffHard: 'Hard (Aggressive Expansion)',
    optMapRandom: '🎲 Random Archetype (New Terrain Every Match)',
    optMapAegean: 'Aegean River Valley (Meandering River & Fords)',
    optMapHighlands: 'Mediterranean Highlands (Alpine Passes & Rich Ore)',
    optMapPeninsulas: 'Twin Peninsulas (Aegean Coasts & Palm Beaches)',
    optMapOasis: 'Inland Oasis (Great Central Lake & Vineyards)',
    optMapPlains: 'Peloponnesian Plains (Broad Forests & Cavalry Fields)',
    controlsGuideHtml:
      '<b>Quick Controls:</b> Left-drag to select &bull; Double-click unit to select all of type &bull; Right-click to gather / move / capture &bull; <code>WASD</code> pan, <code>Q/E</code> rotate, Wheel zoom &bull; <code>Ctrl+1..9</code> control groups &bull; <code>.</code> idle worker &bull; <code>C</code> toggle Capture / Destroy.',
    launchMatchBtn: '⚔️ Launch Skirmish',
    playAgainBtn: '🏛️ New Skirmish',
    emptyTitle: '0 A.D. Web Skirmish',
    emptyHintsHtml:
      '<b>Edge-Scroll / Right-Drag / Middle-Drag</b> Move Map &bull; <b>Wheel</b> Zoom to Cursor &bull; <b>Ctrl+Right-Drag / Q E</b> Rotate<br/><b>Left-Drag</b> Select &bull; <b>Right-Click</b> Gather / Move / Capture &bull; <b>.</b> Idle Worker &bull; <b>C</b> Capture/Destroy',
    emptyCmd: 'Select a Citizen-Soldier, Woman, or Building to issue orders.',
    inspectResource: 'Inspecting Natural Resource.',
    inspectEnemy: 'Inspecting Enemy Entity.',
    carcassSuffix: ' (Carcass)',
    slainBadge: 'SLAIN',
    slainMeta: '🥩 Slain Prey • Remaining Meat:',
    remainingPrefix: 'Remaining',
    constructing: 'Constructing',
    decaying: '⚠️ Cut off from territory (Decaying!)',
    loyalty: 'Loyalty',
    hack: 'Hack',
    pierce: 'Pierce',
    crush: 'Crush',
    garrison: 'Garrison',
    rank: 'Rank',
    rankBasic: 'Basic',
    rankAdv: 'Advanced ★',
    rankElite: 'Elite ★★',
    carrying: 'Carrying',
    orderLabel: 'Order',
    dmg: 'dmg',
    gaia: 'Gaia',
    cancelTip: 'Click to cancel',
    selectedUnits: 'Selected:',
    unitsWord: 'units',
    noBuildChamp: 'Military Champions cannot construct buildings.',
    stanceAggr: '⚔️ Aggr',
    stanceDef: '🛡️ Def',
    stanceHold: '🧱 Hold',
    stancePass: '🕊️ Pass',
    attackMoveBtn: '🎯 A-Move',
    attackMoveTip: 'Attack-Move (click destination)',
    garrisonBtn: '🏰 Garrison',
    garrisonTip: 'Garrison inside friendly CC/Tower/Fortress (G)',
    ungarrisonAll: '🚪 Ungarrison All',
    underConstruction: 'Under construction',
    sendCitizens: 'Send Citizens to finish building.',
    econDefStruct: 'Economic / Defensive structure.',
    rallyHint: 'Right-click map to set Rally Point',
    done: 'Done',
    working: 'Working...',
    costLabel: 'Cost',
    popLabel: 'Pop',
    free: 'Free',
    requiresTownPhase: 'Requires Town Phase (II)',
    requiresTownToast: 'Requires Town Phase (II) — research at Civic Center!',
    needPrefix: 'Need',
    toastAttackMove: 'Left-click destination to Attack-Move',
    toastGarrison: 'Left-click a friendly Civic Center, Tower, or Fortress to Garrison',
    toastNoIdle: 'No idle workers!',
    toastCannotBuild: 'Cannot build here',
    toastModeCapture: 'Building Mode: Capture Structures',
    toastModeDestroy: 'Building Mode: Destroy Structures',
    toastGroupAssigned: 'Assigned Control Group',
    toastClickJump: 'Click to jump camera',
    toastUnderAttack: '⚔️ Your forces are under attack! (Click to jump)',
    toastConstructed: 'constructed!',
    toastCapturedEnemy: 'Captured enemy',
    toastTerritoryExpanded: '! Territory expanded!',
    toastEnemyCaptured: 'Enemy captured your',
    toastResearched: 'Researched',
    toastPromoted: '★ Citizen-Soldier promoted to',
    toastPlacing: 'Placing',
    toastPlacingHint: '— Left-Click to place, Shift+Click for multiple, Right-Click to cancel',
    victoryWin: '🏆 VICTORY — EMPIRES ASCENDANT',
    victoryLoss: '⚔️ DEFEAT — YOUR POLIS HAS FALLEN',
    matchDuration: 'Match Duration',
    metric: 'Metric',
    statGathered: 'Resources Gathered',
    statTrained: 'Units Trained',
    statDefeated: 'Enemies Defeated',
    statBuilt: 'Buildings Constructed',
    statCaptured: 'Buildings Captured',
    youPrefix: 'You',
    petraAi: 'Petra AI',
  },
  'zh-TW': {
    resFood: '食物',
    resWood: '木材',
    resStone: '石頭',
    resMetal: '金屬',
    resFoodTip: '食物（漿果、狩獵與小麥農田）',
    resWoodTip: '木材（柏樹、橄欖樹、松樹與橡樹林）',
    resStoneTip: '石頭（石灰岩與大理石礦場）',
    resMetalTip: '金屬（銅鐵礦與金銀礦脈）',
    resPopTip: '目前人口 / 人口上限（建造民居可提升上限）',
    phase1: '第一階段：村落',
    phase2: '第二階段：城鎮',
    idleBtn: '閒置',
    idleTip: '選取閒置工人（快捷鍵：.）',
    captureBtn: '🚩 佔領',
    destroyBtn: '🔥 摧毀',
    modeTip: '右鍵點擊敵方建築模式（快捷鍵：C）',
    pauseBtn: '⏸ 暫停',
    resumeBtn: '▶ 繼續',
    speedTip: '切換遊戲速度',
    edgeBtn: '🖱️ 捲動',
    edgeTip: '開關滑鼠移至螢幕邊緣捲動地圖',
    mapBtn: '👁️ 全圖',
    mapTip: '開關戰爭迷霧',
    musicOn: '🎵 音樂',
    musicOff: '🎵 靜音',
    musicTip: '開關背景音樂',
    sfxOn: '🔊 音效',
    sfxOff: '🔇 靜音',
    sfxTip: '開關動作、採集與戰鬥音效',
    langBtn: '🌐 EN',
    langTip: '切換語言（繁體中文 / English）',
    randomMapBtn: '🎲 隨機',
    randomMapTip: '立即生成全新隨機地形與資源配置',
    newMatchBtn: '⚙️ 新戰局',
    newMatchTip: '開啟新戰局設定',
    setupTitle: '🏛️ 0 A.D. — 遭遇戰設定',
    labelPlayerCiv: '我方文明',
    labelAiCiv: 'AI 對手文明',
    labelDifficulty: 'AI 難度',
    labelMapType: '地圖類型',
    labelSeed: '地圖種子碼（留空則隨機）',
    seedPlaceholder: '留空自動隨機產生',
    optAthenPlayer: '雅典人（食物/木材採集 +10%，步兵穿刺護甲 +1）',
    optRomePlayer: '羅馬人（步兵攻擊 +10%，建築生命值 +15%）',
    optRomeAi: '羅馬人（Petra AI）',
    optAthenAi: '雅典人（Petra AI）',
    optDiffEasy: '簡單（輕鬆發展）',
    optDiffMedium: '中等（標準對戰）',
    optDiffHard: '困難（積極擴張）',
    optMapRandom: '🎲 隨機地貌（每局全新地形）',
    optMapAegean: '愛琴海河谷（蜿蜒河流與淺灘渡口）',
    optMapHighlands: '地中海高地（山地關隘與豐富礦脈）',
    optMapPeninsulas: '雙半島海岸（愛琴海灣與棕櫚沙灘）',
    optMapOasis: '內陸綠洲（中央大湖與葡萄園區）',
    optMapPlains: '伯羅奔尼撒平原（廣闊林地與騎兵平原）',
    controlsGuideHtml:
      '<b>快捷操作：</b>左鍵拖曳框選 &bull; 雙擊單位選取同類 &bull; 右鍵採集／移動／佔領 &bull; <code>WASD</code> 移動鏡頭、<code>Q/E</code> 旋轉、滾輪縮放 &bull; <code>Ctrl+1..9</code> 編隊 &bull; <code>.</code> 選取閒置工人 &bull; <code>C</code> 切換佔領／摧毀。',
    launchMatchBtn: '⚔️ 開始戰局',
    playAgainBtn: '🏛️ 再開新局',
    emptyTitle: '0 A.D. 網頁即時戰略',
    emptyHintsHtml:
      '<b>螢幕邊緣／右鍵拖曳／中鍵拖曳</b> 移動地圖 &bull; <b>滾輪</b> 以游標縮放 &bull; <b>Ctrl+右鍵／Q E</b> 旋轉視角<br/><b>左鍵框選</b> 選取單位 &bull; <b>右鍵</b> 採集／移動／佔領 &bull; <b>.</b> 閒置工人 &bull; <b>C</b> 切換佔領／摧毀',
    emptyCmd: '請點選公民士兵、女性公民或建築以發佈指令。',
    inspectResource: '正在檢視自然資源。',
    inspectEnemy: '正在檢視敵方單位或建築。',
    carcassSuffix: '（獵物屍體）',
    slainBadge: '已擊殺',
    slainMeta: '🥩 已擊殺獵物 • 剩餘肉量：',
    remainingPrefix: '剩餘',
    constructing: '建造進度',
    decaying: '⚠️ 脫離領土範圍（正在衰敗！）',
    loyalty: '忠誠度',
    hack: '砍擊',
    pierce: '穿刺',
    crush: '鈍擊',
    garrison: '駐軍',
    rank: '軍階',
    rankBasic: '新兵',
    rankAdv: '進階 ★',
    rankElite: '精銳 ★★',
    carrying: '攜帶',
    orderLabel: '指令',
    dmg: '傷害',
    gaia: '自然界',
    cancelTip: '點擊取消訓練／研究',
    selectedUnits: '已選取：',
    unitsWord: '個單位',
    noBuildChamp: '精銳冠軍部隊無法建造建築物。',
    stanceAggr: '⚔️ 主動',
    stanceDef: '🛡️ 防守',
    stanceHold: '🧱 固守',
    stancePass: '🕊️ 被動',
    attackMoveBtn: '🎯 攻擊移動',
    attackMoveTip: '攻擊移動（左鍵點擊目標地點）',
    garrisonBtn: '🏰 駐軍',
    garrisonTip: '進駐友方市政中心、箭塔或要塞（快捷鍵：G）',
    ungarrisonAll: '🚪 全部出城',
    underConstruction: '建造中',
    sendCitizens: '請指派公民完成建造。',
    econDefStruct: '經濟／防禦性建築。',
    rallyHint: '右鍵點擊地圖可設定集結點',
    done: '已完成',
    working: '研究中...',
    costLabel: '花費',
    popLabel: '人口',
    free: '免費',
    requiresTownPhase: '需要城鎮階段（第二階段）',
    requiresTownToast: '需要城鎮階段（第二階段）— 請先在市政中心研發！',
    needPrefix: '資源不足，需要',
    toastAttackMove: '請左鍵點擊目的地以執行攻擊移動',
    toastGarrison: '請左鍵點擊友方市政中心、箭塔或要塞進駐',
    toastNoIdle: '目前沒有閒置工人！',
    toastCannotBuild: '此處無法建造',
    toastModeCapture: '建築攻擊模式：佔領敵方建築',
    toastModeDestroy: '建築攻擊模式：摧毀敵方建築',
    toastGroupAssigned: '已指派編隊',
    toastClickJump: '點擊跳轉鏡頭',
    toastUnderAttack: '⚔️ 我方部隊正遭受攻擊！（點擊跳轉）',
    toastConstructed: '建造完成！',
    toastCapturedEnemy: '成功佔領敵方',
    toastTerritoryExpanded: '！領土已擴張！',
    toastEnemyCaptured: '敵軍佔領了我方的',
    toastResearched: '研發完成：',
    toastPromoted: '★ 公民士兵晉升為',
    toastPlacing: '正在放置',
    toastPlacingHint: '— 左鍵建造、Shift+左鍵連續建造、右鍵取消',
    victoryWin: '🏆 勝利 — 帝國崛起',
    victoryLoss: '⚔️ 戰敗 — 你的城邦已陷落',
    matchDuration: '對戰時長',
    metric: '統計項目',
    statGathered: '累計採集資源',
    statTrained: '訓練單位數',
    statDefeated: '擊敗敵軍數',
    statBuilt: '建成建築數',
    statCaptured: '佔領建築數',
    youPrefix: '你',
    petraAi: 'Petra AI',
  },
} as const;

export type UiKey = keyof typeof UI_STRINGS.en;

export function t(key: UiKey): string {
  return UI_STRINGS[currentLang][key];
}

const RES_ZH: Record<ResourceType, string> = {
  food: '食物',
  wood: '木材',
  stone: '石頭',
  metal: '金屬',
};

const RES_EN: Record<ResourceType, string> = {
  food: 'Food',
  wood: 'Wood',
  stone: 'Stone',
  metal: 'Metal',
};

export function getResourceName(res: ResourceType): string {
  return currentLang === 'zh-TW' ? RES_ZH[res] : RES_EN[res];
}

const ORDER_ZH: Record<OrderType, string> = {
  idle: '閒置',
  move: '移動',
  gather: '採集',
  build: '建造',
  attack: '攻擊',
  garrison: '駐軍',
};

export function getOrderName(order: OrderType): string {
  return currentLang === 'zh-TW' ? ORDER_ZH[order] : order;
}

const CIV_ZH: Record<CivId, string> = {
  athenians: '雅典人',
  romans: '羅馬人',
};

const CIV_EN: Record<CivId, string> = {
  athenians: 'Athenians',
  romans: 'Romans',
};

export function getCivName(civ: CivId): string {
  return currentLang === 'zh-TW' ? CIV_ZH[civ] : CIV_EN[civ];
}

const MAP_ZH: Record<ResolvedMapType | MapType, string> = {
  random: '隨機地貌',
  aegean_valley: '愛琴海河谷',
  medit_highlands: '地中海高地',
  twin_peninsulas: '雙半島海岸',
  inland_oasis: '內陸綠洲',
  open_plains: '伯羅奔尼撒平原',
};

const MAP_EN: Record<ResolvedMapType | MapType, string> = {
  random: 'Random Map',
  aegean_valley: 'Aegean River Valley',
  medit_highlands: 'Mediterranean Highlands',
  twin_peninsulas: 'Twin Peninsulas',
  inland_oasis: 'Inland Oasis',
  open_plains: 'Peloponnesian Plains',
};

export function getMapLabel(mapType: ResolvedMapType | MapType): string {
  return currentLang === 'zh-TW' ? MAP_ZH[mapType] : MAP_EN[mapType];
}

const TEMPLATES_ZH: Record<string, { name: string; shortName: string; description: string }> = {
  // Gaia Resources
  tree_cypress: { name: '地中海柏樹', shortName: '柏樹', description: '高聳的林木，可伐木取得木材。' },
  tree_olive: { name: '橄欖樹', shortName: '橄欖樹', description: '盤根錯節的地中海橄欖樹，可採集木材。' },
  tree_pine: { name: '阿勒頗松樹', shortName: '松樹', description: '生長於丘陵山麓的健壯松木，可採集木材。' },
  tree_palm: { name: '克里特海棗樹', shortName: '海棗樹', description: '海岸與綠洲旁的棕櫚樹，可採集木材。' },
  tree_oak: { name: '地中海橡樹', shortName: '橡樹', description: '寬闊茂密的古老橡樹，木材儲量豐富。' },
  berry_bush: { name: '野生漿果叢', shortName: '漿果', description: '可採集野果，女性公民採集速度最快。' },
  grape_vine: { name: '野生葡萄藤', shortName: '葡萄藤', description: '茂盛的地中海葡萄棚架，富含食物。' },
  deer_herd: { name: '地中海鹿', shortName: '野鹿', description: '棲息於草原的野生鹿群，狩獵可快速獲取食物。' },
  wild_boar: { name: '野豬', shortName: '野豬', description: '體格強壯的林地野豬，會反擊但肉量豐厚。' },
  stone_quarry: { name: '石灰岩石礦', shortName: '石礦', description: '富含石灰岩的礦脈，可開採石頭興建防禦工事。' },
  marble_quarry: { name: '白色大理石礦', shortName: '大理石礦', description: '高產量的潘泰利大理石礦脈，適合宏偉建築。' },
  metal_mine: { name: '銅鐵金屬礦', shortName: '金屬礦', description: '金屬礦石脈，可開採金屬裝備軍隊與研發科技。' },
  gold_vein: { name: '愛琴海金銀礦脈', shortName: '金礦脈', description: '珍貴的高儲量貴金屬礦脈，提供大量金屬。' },

  // Buildings
  civic_center: {
    name: '市政中心',
    shortName: '市政中心',
    description: '領土核心。可訓練公民、接收所有資源，駐軍時可發射箭矢防禦。',
  },
  house: { name: '民居', shortName: '民居', description: '提供 +5 人口上限。' },
  storehouse: { name: '倉庫', shortName: '倉庫', description: '木材、石頭與金屬的資源存放點。' },
  farmstead: { name: '農莊', shortName: '農莊', description: '食物存放點，方便農民收割小麥農田。' },
  field: { name: '小麥農田', shortName: '農田', description: '可再生糧食作物，讓工人穩定耕種獲取食物。' },
  barracks: { name: '兵營', shortName: '兵營', description: '訓練公民士兵（重裝步兵、弓箭手、青年軍、輕步兵）。' },
  defense_tower: { name: '防禦箭塔', shortName: '箭塔', description: '石造瞭望塔，自動射箭攻擊敵人並可駐軍增援火力。' },
  outpost: { name: '前哨站', shortName: '前哨站', description: '木造偵察哨，提供遠距離視野，可建於中立領土。' },
  fortress: { name: '要塞', shortName: '要塞', description: '堅固的城堡要塞，擴張領土、訓練冠軍精銳與攻城單位並提供強大火力。' },
  temple: { name: '神殿', shortName: '神殿', description: '訓練祭司並自動治療周圍受傷友軍。' },
  blacksmith: { name: '鐵匠鋪', shortName: '鐵匠鋪', description: '研發武器與護甲強化科技，全面提升軍隊戰力。' },
  market: { name: '市場', shortName: '市場', description: '繁榮的商業市集，定期產生商隊資源收益並可研發硬幣科技。' },
  stable: { name: '馬廄', shortName: '馬廄', description: '訓練快速機動的騎兵並研發馬具加速科技。' },
  workshop: { name: '攻城工坊', shortName: '攻城工坊', description: '打造重裝攻城衝車並研發攻城工程科技。' },
  wonder: { name: '世界奇觀', shortName: '奇觀', description: '宏偉的文明奇觀，大幅提升人口上限與全軍攻擊力。' },

  // Units
  female_citizen: { name: '女性公民', shortName: '女性公民', description: '經濟主力，擅長採集食物、農耕與興建民用建築。' },
  healer: { name: '神殿祭司', shortName: '祭司', description: '自動跟隨並治療附近受傷的友方單位。' },
  siege_ram: { name: '攻城衝車', shortName: '衝車', description: '重裝掩體衝車，對敵方建築與要塞造成毀滅性鈍擊傷害。' },
  athen_hoplite: { name: '雅典重裝步兵', shortName: '重裝步兵', description: '手持長矛與圓盾的公民士兵，能戰亦能採集與建造。' },
  athen_archer: { name: '克里特弓箭手', shortName: '弓箭手', description: '遠程公民弓手，擅長從安全距離消耗敵人。' },
  athen_cavalry: { name: '雅典標槍騎兵', shortName: '騎兵', description: '高機動突襲騎兵，擅長包抄與追擊敵方遠程單位。' },
  athen_champion: { name: '雅典精銳重步兵', shortName: '冠軍步兵', description: '身披重甲的職業精銳重步兵，近戰戰力頂尖。' },
  rome_hastatus: { name: '羅馬青年軍', shortName: '青年軍', description: '手持短劍與大盾的羅馬公民士兵，能戰善建。' },
  rome_velite: { name: '羅馬輕步兵', shortName: '標槍兵', description: '機動靈活的遠程標槍手，造成高穿刺傷害。' },
  rome_cavalry: { name: '羅馬騎兵', shortName: '羅馬騎兵', description: '高速長矛騎兵，擅長衝鋒與殲滅敵方後排。' },
  rome_champion: { name: '羅馬百夫長', shortName: '百夫長', description: '久經沙場的羅馬精銳重步兵，攻防兼備。' },
};

const TECHS_ZH: Record<string, { name: string; description: string }> = {
  phase_town: { name: '城鎮階段', description: '晉升至第二階段（城鎮），解鎖要塞、騎兵、攻城工坊、奇觀與高階科技。' },
  tech_gather_tools: { name: '強化農具', description: '全體工人資源採集速度 +25%。' },
  tech_iron_weapons: { name: '鍛鐵武器', description: '所有軍事單位攻擊力 +20%。' },
  tech_bronze_shields: { name: '青銅盾牌', description: '全體單位砍擊與穿刺護甲 +2。' },
  tech_architecture: { name: '石造建築學', description: '所有建築生命值與抗佔領忠誠度 +25%。' },
  tech_temple_healing: { name: '神殿醫療術', description: '神殿與祭司治療速度 +50%。' },
  tech_coinage: { name: '硬幣貿易', description: '採集效率 +10%，市場被動貿易收益 +50%。' },
  tech_cavalry_speed: { name: '騎兵馬具', description: '騎兵移動速度 +18%。' },
  tech_steel_weapons: { name: '精鋼兵器', description: '全軍近戰與遠程攻擊力再 +25%。' },
  tech_heavy_armor: { name: '重裝甲片', description: '全體單位砍擊與穿刺護甲再 +2。' },
  tech_siege_engineering: { name: '攻城工程學', description: '攻城衝車對建築傷害 +35%。' },
};

export function getTemplateText(templateId: string): { name: string; shortName: string; description: string } {
  const tpl = TEMPLATES[templateId];
  if (currentLang === 'zh-TW' && TEMPLATES_ZH[templateId]) {
    return TEMPLATES_ZH[templateId];
  }
  return {
    name: tpl?.name ?? templateId,
    shortName: tpl?.shortName ?? templateId,
    description: tpl?.description ?? '',
  };
}

export function getTechText(techId: string): { name: string; description: string } {
  const tech = TECHS[techId];
  if (currentLang === 'zh-TW' && TECHS_ZH[techId]) {
    return TECHS_ZH[techId];
  }
  return {
    name: tech?.name ?? techId,
    description: tech?.description ?? '',
  };
}

export function formatLocalizedCost(cost?: ResourceBag): string {
  if (!cost) return t('free');
  const parts: string[] = [];
  if (cost.food > 0) parts.push(`${cost.food} ${getResourceName('food')}`);
  if (cost.wood > 0) parts.push(`${cost.wood} ${getResourceName('wood')}`);
  if (cost.stone > 0) parts.push(`${cost.stone} ${getResourceName('stone')}`);
  if (cost.metal > 0) parts.push(`${cost.metal} ${getResourceName('metal')}`);
  return parts.join(', ') || t('free');
}

export function getStanceLabel(stance: UnitStance): string {
  switch (stance) {
    case 'aggressive':
      return t('stanceAggr');
    case 'defensive':
      return t('stanceDef');
    case 'stand_ground':
      return t('stanceHold');
    case 'passive':
      return t('stancePass');
  }
}

export function translateBuildReason(reason?: string): string {
  if (!reason) return t('toastCannotBuild');
  if (currentLang !== 'zh-TW') return reason;
  const r = reason.toLowerCase();
  if (r.includes('territory')) return '必須建造在我方領土範圍內';
  if (r.includes('phase')) return '需要先升級至城鎮階段（第二階段）';
  if (r.includes('afford') || r.includes('resource')) return '資源不足，無法建造';
  if (r.includes('terrain') || r.includes('water') || r.includes('slope') || r.includes('passable') || r.includes('blocked')) {
    return '此處地形不平或已被阻擋，無法建造';
  }
  if (r.includes('overlap') || r.includes('occupied') || r.includes('entity') || r.includes('building')) {
    return '該位置與其他物體重疊，無法建造';
  }
  return reason;
}
