// もしもアフィリエイト経由の大手モール検索リンク

export type MoshimoIds = { a_id: string; p_id: string; pc_id: string; pl_id: string };

export type MallConfig = {
  label: string;
  ids: MoshimoIds;
  /** エンコード済みキーワードから検索URLを作る */
  searchUrl: (encodedKeyword: string) => string;
};

export const MALLS = {
  rakuten: {
    label: '楽天市場',
    ids: { a_id: '5819091', p_id: '54', pc_id: '54', pl_id: '616' },
    searchUrl: (kw) => `https://search.rakuten.co.jp/search/mall/${kw}+${encodeURIComponent('ポケカ')}/`,
  },
  yahoo: {
    label: 'Yahoo!ショッピング',
    ids: { a_id: '5819096', p_id: '1225', pc_id: '1925', pl_id: '18502' },
    searchUrl: (kw) => `https://shopping.yahoo.co.jp/search?p=${kw}+${encodeURIComponent('ポケカ')}`,
  },
} satisfies Record<string, MallConfig>;

export type MallKey = keyof typeof MALLS;

const idQuery = (ids: MoshimoIds) => new URLSearchParams(ids).toString();

/** モールの検索URL（例: 「ナンジャモ SAR」→ 楽天の検索結果URL） */
export function mallSearchUrl(mall: MallKey, keyword: string): string {
  return MALLS[mall].searchUrl(encodeURIComponent(keyword));
}

/** もしもアフィリエイトのクリックURL（任意の遷移先URLをエンコードして埋め込む） */
export function moshimoLinkUrl(mall: MallKey, destinationUrl: string): string {
  return `https://af.moshimo.com/af/c/click?${idQuery(MALLS[mall].ids)}&url=${encodeURIComponent(destinationUrl)}`;
}

/** もしもアフィリエイトのクリックURL（遷移先はモールの検索結果） */
export function moshimoClickUrl(mall: MallKey, keyword: string): string {
  return moshimoLinkUrl(mall, mallSearchUrl(mall, keyword));
}

/** もしもアフィリエイトのインプレッション計測URL */
export function moshimoImpressionUrl(mall: MallKey): string {
  return `https://i.moshimo.com/af/i/impression?${idQuery(MALLS[mall].ids)}`;
}

/** 検索キーワード（「ルギアV（SA）」+「SR」→「ルギアV SA SR」のように全角かっこを除去） */
export function mallKeyword(name: string, rarity: string): string {
  return `${name} ${rarity}`.replace(/[（）()]/g, ' ').replace(/\s+/g, ' ').trim();
}
