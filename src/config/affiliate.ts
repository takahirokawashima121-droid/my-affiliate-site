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
    impressionUrl: 'https://www12.a8.net/0.gif?a8mat=4BCL3T+ANF6CY+5NJ8+5YJRM',
    network: 'a8',
  },
} as const satisfies Record<string, AffiliateShop>;

export type ShopKey = keyof typeof SHOPS;
