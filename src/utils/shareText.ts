// X（Twitter）告知用の投稿文（デッキ解説コラム用）
// サイト（記事末尾の「Xシェア用テキスト」）と scripts/auto-deck-updater.js（Pull Request の本文）の両方から使うため、
// astro:content には依存しない

/** 1ポスト目の上限（X の重み付き文字数。全角1文字＝2。280 のうち余裕を残して全角130文字ぶん） */
export const PARENT_POST_LIMIT = 260;

/**
 * X の重み付き文字数（全角・絵文字は2、半角英数・記号の多くは1）。
 * twitter-text の規則（U+0000〜U+10FF・一部の記号は1、それ以外は2）を簡略化したもの
 */
export function xWeightedLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

export type SharePostInput = {
  /** デッキ名（「メガゲッコウガex（ノココッチex採用型）」など） */
  deckName: string;
  /** 大会・日付（「9/26 ジムバトル優勝」） */
  result: string;
  /** 見どころ（キーカード・戦術の要約） */
  highlight: string;
  /** 60枚の最安パーツ概算（円。0 なら行を省く） */
  estimate: number;
  /** 記事のURL（https://…/columns/{slug}/） */
  url: string;
};

/**
 * 親ポスト（URLなし・全角130文字前後）と、リプライ用の子ポスト（記事URL）を作る。
 * 親ポストが上限を超える場合は、見どころの行を末尾から「…」で詰める
 */
export function buildXPosts({ deckName, result, highlight, estimate, url }: SharePostInput): { parent: string; reply: string } {
  const date = result.match(/\d{1,2}\/\d{1,2}/)?.[0];
  const head = `🏆【${deckName}】がジムバトル優勝！${date ? `（${date}）` : ''}`;
  const price = estimate > 0 ? `・60枚の最安パーツ概算 約${estimate.toLocaleString('ja-JP')}円` : '';
  const tags = '#ポケカ #ジムバトル優勝 #ポケトリー';
  const compose = (h: string) => [head, `・${h}`, price, tags].filter(Boolean).join('\n');

  let summary = highlight;
  while (summary.length > 1 && xWeightedLength(compose(summary)) > PARENT_POST_LIMIT) summary = `${summary.slice(0, -2)}…`;
  return {
    parent: compose(summary),
    reply: `確定レシピ・最安パーツ内訳・回し方は「ポケカファクトリー（ポケトリー）」でチェック👇\n${url}`,
  };
}

/** 販売最安値（楽天の在庫ありとYahoo!の安い方。どちらもなければ null）。cards.json の生データ用 */
export function rawBestPrice(card: { saleInStock?: boolean; salePrice: number; yahooPrice?: number | null }): number | null {
  const prices = [card.saleInStock !== false && card.salePrice > 0 ? card.salePrice : null, typeof card.yahooPrice === 'number' && card.yahooPrice > 0 ? card.yahooPrice : null].filter(
    (p): p is number => p !== null,
  );
  return prices.length > 0 ? Math.min(...prices) : null;
}
