// 横断価格比較用のショップ検索リンク（提携していない＝アフィリエイトではないリンク）
// 収益導線（楽天・Yahoo!・Bee本舗）とは別枠で、落ち着いたスタイルで表示する。
//
// 各URLは実際に検索結果が表示されることを確認済み（2026年9月）。
// ※晴れる屋2は /product-list?keyword= だと 404 になるため、Shopify の /search?q= を使う。

export type CompareShop = {
  key: string;
  name: string;
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
    key: 'mercari',
    name: 'メルカリ',
    searchUrl: (kw) => `https://jp.mercari.com/search?keyword=${encodeURIComponent(kw)}`,
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
