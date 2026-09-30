// サイト全体で使うアフィリエイト提携先（カードごとに異なるリンクは cards.json 側で管理）
//
// 追加・変更するときは、A8.net の広告コード（<a href="…"> と 0.gif の計測画像）から
// url と impressionUrl をそれぞれ転記する。

export type AffiliateShop = {
  /** 表示名 */
  name: string;
  /** 提携の種類（ボタンの文言・GA4 の affiliate_type に使う） */
  kind: 'buyback' | 'sale';
  /** クリックURL */
  url: string;
  /** インプレッション計測画像（1x1） */
  impressionUrl: string;
  network: 'a8' | 'moshimo';
};

export const SHOPS = {
  /** 古本市場（ふるいち）トレカ宅配買取：スリーブ・ローダーのまま送れる。希望者には無料宅配キットあり */
  furuichi: {
    name: '古本市場（ふるいち）',
    kind: 'buyback',
    url: 'https://px.a8.net/svt/ejp?a8mat=4BCL3T+AM8B5E+5W1M+BWVTE',
    impressionUrl: 'https://www10.a8.net/0.gif?a8mat=4BCL3T+AM8B5E+5W1M+BWVTE',
    network: 'a8',
  },
  /** Bee本舗通販店：トレカ専門店の通販（購入）。※提携リンクは通販店のため買取導線には使わない */
  beehonpo: {
    name: 'Bee本舗',
    kind: 'sale',
    url: 'https://px.a8.net/svt/ejp?a8mat=4BCL3T+ANF6CY+5NJ8+5YJRM',
    impressionUrl: 'https://www13.a8.net/0.gif?a8mat=4BCL3T+ANF6CY+5NJ8+5YJRM',
    network: 'a8',
  },
  /**
   * トレトク（トレカの宅配買取）。ToretokuNotice.astro だけで使う（リンクと計測画像を同じ部品の中で出す）。
   * ほかのショップと並べない・比べないため、価格比較の表・買取最高値の欄・BuybackOptions には入れないこと。
   * url・impressionUrl は A8.net の広告コードのまま（一文字も変えない）
   */
  toretoku: {
    name: 'トレトク',
    kind: 'buyback',
    url: 'https://px.a8.net/svt/ejp?a8mat=4BCKBZ+92UZW2+2QOI+2T849U',
    impressionUrl: 'https://www15.a8.net/0.gif?a8mat=4BCKBZ+92UZW2+2QOI+2T849U',
    network: 'a8',
  },
} as const satisfies Record<string, AffiliateShop>;

export type ShopKey = keyof typeof SHOPS;

/**
 * GA4 の affiliate_click で送る shop_name（リンクの data-aff-shop の表示名 → 英字キー）。
 * 表示名で判定できないリンクは、GoogleAnalytics.astro が遷移先URL（もしもの a_id・A8 のプログラム・ドメイン）から判定する
 */
export const GA_SHOP_KEYS: Record<string, string> = {
  楽天市場: 'rakuten',
  'Yahoo!ショッピング': 'yahoo',
  メルカリ: 'mercari',
  [SHOPS.beehonpo.name]: 'beehonpo',
  [SHOPS.furuichi.name]: 'furuichi',
  [SHOPS.toretoku.name]: 'toretoku',
  カーナベル: 'carnavel',
  カードラッシュ: 'cardrush',
  晴れる屋2: 'hareruya2',
  駿河屋: 'surugaya',
};

/** メルカリアンバサダーの afid（メルカリへのリンクに付けると紹介として計測される） */
export const MERCARI_AFID = '8253399577';

/**
 * メルカリのURLに afid を付ける（既存のクエリはそのまま残し、afid があれば上書き）。
 * メルカリへのリンクは必ずこの関数か mercariSearchUrl を通すこと
 */
export function withMercariAfid(href: string): string {
  const url = new URL(href);
  url.searchParams.set('afid', MERCARI_AFID);
  return url.toString();
}

/** メルカリの検索結果URL（例: https://jp.mercari.com/search?keyword=ナンジャモ+096%2F071&afid=…） */
export function mercariSearchUrl(keyword: string): string {
  const url = new URL('https://jp.mercari.com/search');
  url.searchParams.set('keyword', keyword);
  return withMercariAfid(url.toString());
}

/**
 * Bee本舗通販店のサイト内検索URL（MakeShop の検索ページ。例: 「ナンジャモ 096/071」）
 */
export function beeHonpoSearchUrl(keyword: string): string {
  return `https://www.bee-honpo.com/view/search?search_keyword=${encodeURIComponent(keyword)}`;
}

/**
 * A8.net のディープリンク（a8ejpredirect で任意のページへ遷移）を使うか。
 * 広告主が「任意のページへのリンク」を許可しているプログラムでのみ有効。許可されていないのに使うと成果が承認されない
 * おそれがあるため、A8 管理画面の「プログラム詳細」でディープリンク可を確認してから true にすること。
 */
export const BEE_HONPO_DEEP_LINK = false;

/** Bee本舗の購入リンク：ディープリンク可ならカード検索結果へ、不可なら通販店トップへ */
export function beeHonpoLink(keyword: string): { href: string; searchable: boolean } {
  if (!BEE_HONPO_DEEP_LINK) return { href: SHOPS.beehonpo.url, searchable: false };
  return { href: `${SHOPS.beehonpo.url}&a8ejpredirect=${encodeURIComponent(beeHonpoSearchUrl(keyword))}`, searchable: true };
}
