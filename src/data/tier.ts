// 環境Tier表（/tier/）のデータ。複数の攻略サイト・大会結果まとめの Tier 評価を突き合わせて決める
// 各デッキは src/data/deck-columns.json の記事（slug）にひもづけ、画像・60枚の概算・リンクは記事のデータから表示する。
// 環境が変わったら updated・sources の日付・tiers を更新すること

export type TierSource = { key: string; name: string; url: string; updated: string };

/** 参考にした Tier 表（評価の突き合わせに使ったもの） */
export const TIER_SOURCES: TierSource[] = [
  { key: 'pokecabook', name: 'ポケカブック', url: 'https://pokecabook.com/archives/26148', updated: '2026-09-27' },
  { key: 'torecamap', name: 'トレカの地図', url: 'https://torecamap.co.jp/column/pokemon-environment/', updated: '2026-09-27' },
  { key: 'zanmai', name: 'ポケざんまい', url: 'https://www.pokeca-zanmai.jp/strongest/', updated: '2026-09-21' },
  { key: 'pokekameshi', name: 'ポケカ飯', url: 'https://pokekameshi.com/strongestdeck-tire/', updated: '2026-09-14' },
  { key: 'cardrush', name: 'カードラッシュ', url: 'https://cardrush.media/pokemon/articles/981', updated: '2026-09-10' },
];

export type TierDeck = {
  /** src/data/deck-columns.json の slug（/columns/{slug}/） */
  slug: string;
  /** 特徴・強みの要約（カードに2行程度で表示） */
  summary: string;
  /** 各サイトでの評価（TIER_SOURCES の key → 「Tier1」など） */
  ratings: Partial<Record<string, string>>;
};

export type Tier = {
  rank: 1 | 2 | 3;
  label: string;
  /** 見出しの補足（「環境トップ」など） */
  title: string;
  description: string;
  decks: TierDeck[];
};

export const TIER_LIST = {
  /** 更新日（YYYY-MM-DD） */
  updated: '2026-09-27',
  environment: '現行スタンダード（H・I・J）・2027シーズン開幕直後',
  tiers: [
    {
      rank: 1,
      label: 'Tier1',
      title: '環境トップ',
      description: '5サイトすべてが最上位に置く、使用率・入賞数ともに突出したデッキ。すべてのデッキがまず対策を考える基準です。',
      decks: [
        {
          slug: 'dragapult-ex-yonoir-deck',
          summary: 'ファントムダイブの200＋ベンチへのダメカン6個に、ヨノワールのカースドボムを重ねてサイドを一気に取る定番型。',
          ratings: { pokecabook: 'Tier1', torecamap: 'Tier1', zanmai: 'Tier1', pokekameshi: 'Tier1', cardrush: 'Tier1' },
        },
        {
          slug: 'dragapult-ex-nokokotchi-deck',
          summary: 'ノココッチexのぎゃっきょうテールで、たねポケモンex主体のデッキにも強い型。クラッシュハンマー4枚で相手の攻撃を遅らせる。',
          ratings: { pokecabook: 'Tier1', torecamap: 'Tier1' },
        },
      ],
    },
    {
      rank: 2,
      label: 'Tier2',
      title: '環境上位',
      description: '複数のサイトで上位評価され、ジムバトル・シティリーグで安定して結果を残しているデッキ。',
      decks: [
        {
          slug: 'slowking-deck',
          summary: 'ヤドキングのひらめきチャレンジで、山札の上に置いた非ルールポケモンのワザを使い分ける。暗号マニアの解読で狙ったワザを準備。',
          ratings: { pokecabook: 'Tier2', cardrush: 'Tier2', pokekameshi: 'Tier3' },
        },
        {
          slug: 'mega-lucario-ex-deck',
          summary: 'はどうづきでトラッシュの闘エネルギーをベンチに加速し、メガブレイブ270で大型を倒す。構築がシンプルで扱いやすい。',
          ratings: { pokecabook: 'Tier2', torecamap: 'Tier2', pokekameshi: 'Tier2', cardrush: 'Tier2', zanmai: 'Tier3' },
        },
        {
          slug: 'n-zoroark-ex-deck',
          summary: 'Nのゾロアークexのとりひきで手札を回し、ナイトジョーカーでベンチの「Nのポケモン」のワザを使い分ける対応力の高いデッキ。',
          ratings: { pokecabook: 'Tier2', torecamap: 'Tier2', zanmai: 'Tier2', pokekameshi: 'Tier2', cardrush: 'Tier3' },
        },
        {
          slug: 'raging-bolt-ex-deck',
          summary: 'オーガポン みどりのめんexで草エネルギーを加速し、タケルライコexのきょくらいごう（枚数×70）でHPの高いポケモンも1撃。',
          ratings: { cardrush: 'Tier1', torecamap: 'Tier2', pokecabook: 'Tier3', pokekameshi: 'Tier3' },
        },
        {
          slug: 'dragapult-ex-blaziken-deck',
          summary: 'バシャーモexのたぎるとうしでトラッシュのエネルギーを毎ターン加速。炎弱点の相手はバシャーモexの200で倒せる。',
          ratings: { pokecabook: 'Tier2', zanmai: 'Tier2', pokekameshi: 'Tier2', cardrush: 'Tier2' },
        },
      ],
    },
    {
      rank: 3,
      label: 'Tier3',
      title: '環境中位・メタ次第で上位',
      description: '入賞実績があり、環境の流行やデッキ相性しだいで十分に勝ちを狙えるデッキ。',
      decks: [
        {
          slug: 'alakazam-deck',
          summary: 'ユンゲラー・フーディンのサイコドローで手札を増やし、ハンドパワー（手札の枚数×2個のダメカン）で倒す非exデッキ。',
          ratings: { torecamap: 'Tier2', pokecabook: 'Tier3', cardrush: 'Tier3' },
        },
        {
          slug: 'omatsuri-ondo-deck',
          summary: 'お祭り会場の下で、カミッチュ・アズマオウがワザを2回連続で使う。グラジオの決戦・ブレイブバングルで1ターンに400以上も。',
          ratings: { pokekameshi: 'Tier2', pokecabook: 'Tier3', torecamap: 'Tier3', zanmai: 'Tier3', cardrush: 'Tier3' },
        },
        {
          slug: 'bakegakure-deck',
          summary: '特性「ばけがくれ」でベンチを守り、トラッシュに4枚そろえたダダリンのむねんのイカリ（170）で戦う新コンセプト。',
          ratings: { pokecabook: 'Tier3', pokekameshi: 'Tier3' },
        },
        {
          slug: 'mega-excadrill-ex-deck',
          summary: 'ゲノセクトexで進化ポケモンを集め、メタングのメタルメーカーで鋼エネルギーを加速。マキシマムドリル330でタイマンに強い。',
          ratings: { zanmai: 'Tier2', pokecabook: 'Tier3', cardrush: 'Tier3' },
        },
        {
          slug: 'hydrapple-ex-deck',
          summary: 'メガニウムで基本草エネルギーが2個ぶんに。カミツオロチexのみつあめストームは草エネルギーの数×30で火力が伸び続ける。',
          ratings: { torecamap: 'Tier3', zanmai: 'Tier3', pokekameshi: 'Tier3', pokecabook: 'Tier4' },
        },
        {
          slug: 'orivuaex-deck-0926',
          summary: 'オイルマシンガンで合計120ダメージを振り分け、活力の森で進化を早める。9/26のジムバトルでも優勝した草デッキ。',
          ratings: { torecamap: 'Tier2' },
        },
      ],
    },
  ] satisfies Tier[],
};

/** デッキ解説の slug から、Tier表での順位（掲載されていなければ undefined） */
export function tierOf(slug: string): Tier | undefined {
  return TIER_LIST.tiers.find((t) => t.decks.some((d) => d.slug === slug));
}
