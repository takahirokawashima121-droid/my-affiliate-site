// サイト全体の設定（ここを書き換えるだけでサイト名などが変わります）
export const SITE = {
  title: 'ポケカ相場比較ナビ',
  description:
    '人気の中古ポケモンカードの販売最安値と買取最高値を、主要ショップ横断で比較。一番安く買えるお店・一番高く売れるお店がすぐに分かります。',
  author: '運営者名',
  lang: 'ja',
  locale: 'ja_JP',
  ogImage: '/og-default.png',
  twitter: '', // 例: '@your_account'
  postsPerPage: 10,
  // true の間はトップに「サンプルデータ」の注意書きを表示。実データに差し替えたら false に
  sampleData: true,
};

export const NAV = [
  { href: '/', label: '相場比較' },
  { href: '/blog/', label: 'コラム' },
  { href: '/about/', label: '運営者情報' },
];
