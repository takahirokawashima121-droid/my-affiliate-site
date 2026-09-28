// サイト全体の設定（ここを書き換えるだけでサイト名などが変わります）
export const SITE = {
  title: 'ポケカファクトリー', // サイト名（ヘッダー・OGP の og:site_name・各ページ <title> の末尾）
  shortName: 'ポケトリー', // 略称（トップページの <title>・ヘッダーのサブ表記）
  englishName: 'POKECA FACTORY', // 英語表記（ヘッダーのサブ表記）
  tagline: 'デッキ構築＆パーツ調達ナビ', // トップページの <title> に付くキャッチコピー
  description:
    '現行スタンダード（H・I・J）特化のデッキ研究＆パーツ調達工房。毎日のジムバトル優勝デッキ60枚レシピ・回し方・同名軸の採用差分（〇〇型）と、不足パーツの最安値を一括チェック。',
  author: 'ポケカファクトリー運営事務局',
  // 連絡先メール。スパム対策のため @ の前後に分けて持ち、完全なアドレスは HTML に出力しない
  contactEmail: { user: 'pokeca.price.contact', domain: 'gmail.com' },
  lang: 'ja',
  locale: 'ja_JP',
  ogImage: '/og-default.png',
  twitter: '', // 例: '@your_account'
  gaMeasurementId: 'G-LVWFTFK7L7', // Google Analytics 4 測定ID（空にすると計測タグを出力しない）
  // Google Search Console の所有権確認（プロパティごとに1つ。複数あればすべて出力する）
  googleSiteVerification: [
    'WNP7X16_Qz86ctYfInfGAMD753rBl78ULK5nTMZoH8g',
    'V2wcDtyhtHDh5d_E8NeaaotuAS2EJlVwNHOV25kxF6o',
  ],
  postsPerPage: 12,
  // 価格データの出典に関する注意書き（トップ・カード詳細に表示）。データの取得方法を変えたら実態に合わせて更新すること
  priceNotice:
    '※ 販売価格は楽天市場・Yahoo!ショッピングの商品データ（楽天ウェブサービス・Yahoo!ショッピングAPI）をもとに更新し、安い方を販売最安値として表示しています（両モールに在庫のないカードは「在庫なし」と表示）。買取価格は販売相場から算出した目安です。最新の価格・在庫は各ショップでご確認ください。',
};

/**
 * 現在のスタンダードレギュレーションで使えるレギュレーションマーク（2026年1月23日〜）。
 * レギュレーション変更（スタン落ち）のたびに更新すること。
 * 参考: https://www.pokemon-card.com/info/005262.html
 */
export const STANDARD_REGULATIONS = ['H', 'I', 'J'] as const;

/**
 * レギュレーションマークに関わらずスタンダードで使えるカード（公式の例外リスト）。
 * 「ソード＆シールド」「スカーレット＆バイオレット」等の過去シリーズのカードでもデッキに入れられる。
 * 出典: https://www.pokemon-card.com/rules/regulation/ （2026年1月23日〜のスタンダード）
 */
export const STANDARD_EXEMPT_NAMES: readonly string[] = [
  'いいきずぐすり', 'エネルギーつけかえ', 'エネルギー回収', 'エネルギー転送', 'エネルギーリサイクル', 'おいわいファンファーレ',
  '改造ハンマー', 'カウンターゲイン', 'きずぐすり',
  '基本草エネルギー', '基本炎エネルギー', '基本水エネルギー', '基本雷エネルギー', '基本超エネルギー', '基本闘エネルギー', '基本悪エネルギー', '基本鋼エネルギー',
  'クラッシュハンマー', 'コック', 'ジャッジマン', '勝利のしるし', 'スクランブルスイッチ', 'せいなるはい', 'ダークボール', 'チェレン',
  'ツールスクラッパー', 'ハイパーボール', 'パラダイスリゾート', 'ふうせん', 'ふしぎなアメ', 'プリズムエネルギー', 'ポケギア3.0',
  'ポケモンいれかえ', 'ポケモン回収サイクロン', 'ポケモンキャッチャー', 'ポケモンセンターのお姉さん', 'ボスの指令', 'マスターボール',
  'むしよけスプレー', 'モンスターボール', 'ラッキーメット',
];

export const NAV = [
  { href: '/', label: 'パーツ検索' },
  { href: '/tier/', label: '環境Tier表' },
  { href: '/columns/', label: 'デッキ解説' },
  { href: '/blog/', label: 'コラム一覧' },
  { href: '/about/', label: '運営者情報' },
];
