// サイト全体の設定（ここを書き換えるだけでサイト名などが変わります）
export const SITE = {
  title: 'ポケカ価格ナビ', // サイト名（ヘッダー・OGP の og:site_name・各ページ <title> の末尾）
  tagline: '中古ポケモンカードの販売最安値・買取相場比較', // トップページの <title> に付くキャッチコピー
  description:
    '人気の中古ポケモンカードの販売最安値と買取最高値を、主要ショップ横断で比較。一番安く買えるお店・一番高く売れるお店がすぐに分かります。',
  author: 'ポケカ価格ナビ運営事務局',
  // 連絡先メール。スパム対策のため @ の前後に分けて持ち、完全なアドレスは HTML に出力しない
  contactEmail: { user: 'pokeca.price.contact', domain: 'gmail.com' },
  lang: 'ja',
  locale: 'ja_JP',
  ogImage: '/og-default.png',
  twitter: '', // 例: '@your_account'
  gaMeasurementId: 'G-LVWFTFK7L7', // Google Analytics 4 測定ID（空にすると計測タグを出力しない）
  googleSiteVerification: 'WNP7X16_Qz86ctYfInfGAMD753rBl78ULK5nTMZoH8g', // Google Search Console の所有権確認
  postsPerPage: 12,
  // 価格データの出典に関する注意書き（トップ・カード詳細に表示）。データの取得方法を変えたら実態に合わせて更新すること
  priceNotice:
    '※ 販売価格は楽天市場の商品データ（楽天ウェブサービス）をもとに更新しています（一部カードは参考価格）。買取価格は販売相場から算出した目安です。最新の価格・在庫は各ショップでご確認ください。',
};

export const NAV = [
  { href: '/', label: '相場比較' },
  { href: '/blog/', label: 'コラム一覧' },
  { href: '/about/', label: '運営者情報' },
];
