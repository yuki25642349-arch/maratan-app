export type Work = {
  id: string;
  title: string;
  type: "アニメ" | "ドラマ" | "映画";
  region: string;
  area: string;
  description: string;
  available: boolean;
  color: string;
  regions: { id: string; label: string; available: boolean }[];
};

export type Spot = {
  id: string;
  regionId: string;
  name: string;
  shortName: string;
  relation: string;
  stayMinutes: number;
  hours: string;
  lastEntry: string;
  fee: number | null;
  reservation: string;
  officialUrl: string;
  sourceLabel: string;
  sourceDate: string;
  caution: string;
  mapX: number;
  mapY: number;
  closedWeekdays?: number[];
  exceptionalClosedDates?: string[];
};

export type Detour = {
  id: string;
  regionId: string;
  name: string;
  category: "食べる" | "買う" | "体験する";
  description: string;
  reason: string;
  stayMinutes: number;
  price: number | null;
  priceLabel: string;
  hours: string;
  reservation: string;
  officialUrl: string;
  sourceLabel: string;
  sourceDate: string;
  closedWeekdays?: number[];
  exceptionalClosedDates?: string[];
  lastEntry: string;
  mapX: number;
  mapY: number;
};

export const works: Work[] = [
  {
    id: "umimachi",
    title: "海街スケッチ",
    type: "アニメ",
    region: "神奈川県",
    area: "鎌倉周辺エリア",
    description: "海辺の町で過ごす四季を描いた物語",
    available: true,
    color: "#f8c2a0",
    regions: [
      { id: "kamakura", label: "鎌倉・由比ヶ浜", available: true },
      { id: "kitakamakura", label: "北鎌倉", available: true },
    ],
  },
  {
    id: "kitaguni",
    title: "北国フィルムノート",
    type: "ドラマ",
    region: "北海道",
    area: "小樽エリア",
    description: "古い港町を舞台にした青春ドラマ",
    available: false,
    color: "#cbdfe6",
    regions: [{ id: "otaru", label: "小樽", available: false }],
  },
  {
    id: "kazemachi",
    title: "風待ち郵便局",
    type: "映画",
    region: "愛媛県",
    area: "松山エリア",
    description: "坂の町の小さな郵便局を巡る物語",
    available: false,
    color: "#d8d3b0",
    regions: [{ id: "matsuyama", label: "松山", available: false }],
  },
];

export const spots: Spot[] = [
  {
    id: "crossing",
    regionId: "kamakura",
    name: "海辺の踏切",
    shortName: "踏切",
    relation: "第3話で主人公が海を眺めた場面のモデル地",
    stayMinutes: 20,
    hours: "屋外地点（営業時間なし）",
    lastEntry: "なし",
    fee: 0,
    reservation: "不要",
    officialUrl: "https://example.com/demo-source/crossing",
    sourceLabel: "市観光案内（デモ）",
    sourceDate: "2026年9月12日",
    caution: "生活道路です。立ち止まらず、線路内へ入らないでください。",
    mapX: 28,
    mapY: 62,
  },
  {
    id: "viewpoint",
    regionId: "kamakura",
    name: "潮風の丘 展望台",
    shortName: "展望台",
    relation: "キービジュアルの背景に描かれた高台のモデル地",
    stayMinutes: 30,
    hours: "9:00〜17:00",
    lastEntry: "16:30",
    fee: 300,
    reservation: "不要",
    officialUrl: "https://example.com/demo-source/viewpoint",
    sourceLabel: "施設公式（デモ）",
    sourceDate: "2026年9月10日",
    caution: "雨天時は足元が滑りやすくなります。三脚の使用は禁止です。",
    mapX: 67,
    mapY: 25,
    exceptionalClosedDates: ["2026-10-20"],
  },
  {
    id: "clocktower",
    regionId: "kamakura",
    name: "旧市街の時計塔",
    shortName: "時計塔",
    relation: "主人公たちの待ち合わせ場所として登場した建物",
    stayMinutes: 25,
    hours: "10:00〜16:30（水曜休館）",
    lastEntry: "16:00",
    fee: 200,
    reservation: "不要",
    officialUrl: "https://example.com/demo-source/clocktower",
    sourceLabel: "施設公式（デモ）",
    sourceDate: "2026年9月8日",
    caution: "館内の一部は撮影できません。現地の案内に従ってください。",
    mapX: 59,
    mapY: 52,
    closedWeekdays: [3],
  },
  {
    id: "stone-steps",
    regionId: "kamakura",
    name: "あじさい路地の石段",
    shortName: "石段",
    relation: "最終話で手紙を渡す場面に使われた坂道のモデル地",
    stayMinutes: 15,
    hours: "屋外地点（営業時間なし）",
    lastEntry: "なし",
    fee: 0,
    reservation: "不要",
    officialUrl: "https://example.com/demo-source/stone-steps",
    sourceLabel: "ロケ地マップ（デモ）",
    sourceDate: "2026年9月5日",
    caution: "住宅地です。大声や長時間の撮影は控えてください。",
    mapX: 78,
    mapY: 69,
  },
  {
    id: "temple-path",
    regionId: "kitakamakura",
    name: "山門へ続く小径",
    shortName: "小径",
    relation: "第5話の散歩場面のモデル地（デモ設定）",
    stayMinutes: 20,
    hours: "屋外地点（営業時間なし）",
    lastEntry: "なし",
    fee: 0,
    reservation: "不要",
    officialUrl: "https://example.com/demo-source/temple-path",
    sourceLabel: "地域案内（デモ）",
    sourceDate: "2026年9月12日",
    caution: "参道をふさがず、周囲の方に配慮してください。",
    mapX: 31,
    mapY: 31,
  },
  {
    id: "garden-gate",
    regionId: "kitakamakura",
    name: "花庭の門",
    shortName: "花庭",
    relation: "登場人物が待ち合わせた門のモデル地（デモ設定）",
    stayMinutes: 30,
    hours: "9:00〜16:00（月曜休館）",
    lastEntry: "15:30",
    fee: 250,
    reservation: "不要",
    officialUrl: "https://example.com/demo-source/garden-gate",
    sourceLabel: "施設公式（デモ）",
    sourceDate: "2026年9月12日",
    caution: "敷地内の撮影条件は現地で確認してください。",
    mapX: 72,
    mapY: 57,
    closedWeekdays: [1],
  },
];

export const detours: Detour[] = [
  {
    id: "shirasu",
    regionId: "kamakura",
    name: "浜風しらす食堂",
    category: "食べる",
    description: "地元で水揚げされたしらすを使う小さな食堂",
    reason: "地域の食を楽しめる昼食候補",
    stayMinutes: 45,
    price: 1400,
    priceLabel: "参考 1,400円〜",
    hours: "11:00〜15:00（売切れ次第終了）",
    reservation: "予約不可・当日営業を要確認",
    officialUrl: "https://example.com/demo-source/shirasu",
    sourceLabel: "店舗案内（デモ）",
    sourceDate: "2026年9月12日",
    lastEntry: "売切れ次第終了",
    mapX: 40,
    mapY: 68,
  },
  {
    id: "craft",
    regionId: "kamakura",
    name: "鎌倉紋様工房",
    category: "体験する",
    description: "地域の意匠を使った小物づくりを体験できる工房",
    reason: "屋内で地域の意匠を体験できる",
    stayMinutes: 50,
    price: 2200,
    priceLabel: "体験 2,200円",
    hours: "10:00〜17:00（木曜休み）",
    reservation: "前日までの予約推奨",
    officialUrl: "https://example.com/demo-source/craft",
    sourceLabel: "店舗公式（デモ）",
    sourceDate: "2026年9月12日",
    closedWeekdays: [4],
    lastEntry: "体験枠による",
    mapX: 62,
    mapY: 49,
  },
  {
    id: "market",
    regionId: "kamakura",
    name: "よりみち朝市",
    category: "買う",
    description: "地元野菜と焼き菓子が並ぶ週末の小さな市場",
    reason: "地域の商品を知る買い物候補",
    stayMinutes: 25,
    price: null,
    priceLabel: "購入内容により異なる",
    hours: "土日 9:00〜14:00",
    reservation: "不要",
    officialUrl: "https://example.com/demo-source/market",
    sourceLabel: "開催案内（デモ）",
    sourceDate: "2026年9月12日",
    closedWeekdays: [1, 2, 3, 4, 5],
    lastEntry: "14:00",
    mapX: 48,
    mapY: 40,
  },
  {
    id: "tea-house",
    regionId: "kitakamakura",
    name: "小径の茶屋",
    category: "食べる",
    description: "散策の途中で休憩できる茶屋（デモ設定）",
    reason: "小径と花庭の間で休憩できる地域の立ち寄り先",
    stayMinutes: 35,
    price: 850,
    priceLabel: "参考 850円〜",
    hours: "10:00〜16:00（火曜休み）",
    reservation: "不要・当日営業を要確認",
    officialUrl: "https://example.com/demo-source/tea-house",
    sourceLabel: "店舗案内（デモ）",
    sourceDate: "2026年9月12日",
    closedWeekdays: [2],
    lastEntry: "15:30",
    mapX: 50,
    mapY: 44,
  },
];
