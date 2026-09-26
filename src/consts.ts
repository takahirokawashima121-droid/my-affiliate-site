// サイト全体の設定（ここを書き換えるだけでサイト名などが変わります）
export const SITE = {
  title: 'My Affiliate Blog',
  description: '本当に使えるおすすめ商品を、実体験ベースでわかりやすくレビューするブログです。',
  author: '運営者名',
  lang: 'ja',
  locale: 'ja_JP',
  ogImage: '/og-default.png',
  twitter: '', // 例: '@your_account'
  postsPerPage: 10,
};

export const NAV = [
  { href: '/', label: 'ホーム' },
  { href: '/blog/', label: '記事一覧' },
  { href: '/tags/', label: 'タグ' },
  { href: '/about/', label: '運営者情報' },
];
