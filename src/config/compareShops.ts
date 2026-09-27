// 横断価格比較用のショップ・フリマ検索リンク
// 収益導線（楽天・Yahoo!・Bee本舗）とは別枠で、落ち着いたスタイルで表示する。
// Bee本舗のみアフィリエイトリンク（A8.net）。それ以外は提携していないリンク。
// ※メルカリ（メルカリアンバサダー）は上段の MallSearchButtons に表示する。
//
// 各URLは実際に検索結果が表示されることを確認済み（2026年9月）。
// ※晴れる屋2は /product-list?keyword= だと 404 になるため、Shopify の /search?q= を使う。

import { SHOPS, beeHonpoLink } from './affiliate';

export type CompareShop = {
  key: string;
  name: string;
  /** アフィリエイトリンクか（true なら rel="sponsored" を付け、GA4 の affiliate_click で計測する） */
  affiliate?: boolean;
  /** アフィリエイトの計測ネットワーク（GA4 の affiliate_network） */
  network?: string;
  /** 検索結果ではなくショップのトップ等を開く場合の説明（説明文に表示） */
  opensTop?: boolean;
  /** 検索キーワード（例: 「ナンジャモ 096/071」）から検索結果URLを作る */
  searchUrl: (keyword: string) => string;
};

export const COMPARE_SHOPS: CompareShop[] = [
  {
    key: 'cardrush',
    name: 'カードラッシュ',
    searchUrl: (kw) => `https://www.cardrush-pokemon.jp/product-list?keyword=${encodeURIComponent(kw)}`,
  },
  {
    key: 'hareruya2',
    name: '晴れる屋2',
    searchUrl: (kw) => `https://www.hareruya2.com/search?q=${encodeURIComponent(kw)}`,
  },
  {
    key: 'surugaya',
    name: '駿河屋',
    searchUrl: (kw) => `https://www.suruga-ya.jp/search?search_word=${encodeURIComponent(kw)}`,
  },
  {
    key: 'beehonpo',
    name: SHOPS.beehonpo.name,
    affiliate: true,
    network: SHOPS.beehonpo.network,
    // ディープリンクが使えない間は通販店トップへのリンクになる（src/config/affiliate.ts の BEE_HONPO_DEEP_LINK）
    opensTop: !beeHonpoLink('').searchable,
    searchUrl: (kw) => beeHonpoLink(kw).href,
  },
];

/**
 * 横断比較の検索キーワード（カード名＋カード番号。例: 「ナンジャモ 096/071」）。
 * 駿河屋は半角「&」で検索語が途中で切れる（「ピカチュウ&ゼクロムGX」→「ピカチュウ」）ため全角「＆」にする。
 * 全角でもカードラッシュ・晴れる屋2は同じ結果になることを確認済み。
 */
export function compareKeyword({ name, cardNumber }: { name: string; cardNumber: string }): string {
  return `${name.replace(/&/g, '＆')} ${cardNumber}`;
}
