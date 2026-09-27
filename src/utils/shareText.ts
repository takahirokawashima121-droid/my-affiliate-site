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

/** 親ポストが上限を超える場合は、可変の行（見どころ等）を末尾から「…」で詰める */
function fitParent(compose: (text: string) => string, text: string): string {
  let t = text;
  while (t.length > 1 && xWeightedLength(compose(t)) > PARENT_POST_LIMIT) t = `${t.slice(0, -2)}…`;
  return compose(t);
}

/**
 * 親ポスト（URLなし・全角130文字前後）と、リプライ用の子ポスト（記事URL）を作る。
 * 親ポストが上限を超える場合は、見どころの行を末尾から「…」で詰める。
 * ジムバトル以外の結果（「環境Tier1・大会優勝構築」など）は、結果をそのまま見出しに使う
 */
export function buildXPosts({ deckName, result, highlight, estimate, url }: SharePostInput): { parent: string; reply: string } {
  const gym = /ジムバトル優勝/.test(result);
  const date = result.match(/\d{1,2}\/\d{1,2}/)?.[0];
  const head = gym ? `🏆【${deckName}】がジムバトル優勝！${date ? `（${date}）` : ''}` : `🏆【${deckName}】${result}のレシピを解説！`;
  const price = estimate > 0 ? `・60枚の最安パーツ概算 約${estimate.toLocaleString('ja-JP')}円` : '';
  const tags = gym ? '#ポケカ #ジムバトル優勝 #ポケトリー' : '#ポケカ #ポケカ環境 #ポケトリー';
  return {
    parent: fitParent((h) => [head, `・${h}`, price, tags].filter(Boolean).join('\n'), highlight),
    reply: `確定レシピ・最安パーツ内訳・回し方は「ポケカファクトリー（ポケトリー）」でチェック👇\n${url}`,
  };
}

export type TierPostInput = {
  /** 更新日（「9/27」） */
  date: string;
  /** Tier ごとのデッキ名（上位の Tier から） */
  tiers: { label: string; decks: string[] }[];
  /** Tier表のURL */
  url: string;
};

/** 環境Tier表の告知用（親ポストは Tier1・Tier2 を並べ、入りきらない分は「…」で詰める） */
export function buildTierPosts({ date, tiers, url }: TierPostInput): { parent: string; reply: string } {
  const head = `📊【${date}更新】ポケカ環境Tier表（H・I・J）`;
  const tags = '#ポケカ #ポケカ環境 #ポケトリー';
  const lines = tiers.slice(0, 2).map((t) => `${t.label}：${t.decks.join('／')}`).join('\n');
  return {
    parent: fitParent((body) => [head, body, tags].join('\n'), lines),
    reply: `Tier1〜3の全デッキの60枚レシピ・回し方・最安パーツ概算は「ポケカファクトリー（ポケトリー）」でチェック👇\n${url}`,
  };
}

/** 販売最安値（楽天の在庫ありとYahoo!の安い方。どちらもなければ null）。cards.json の生データ用 */
export function rawBestPrice(card: { saleInStock?: boolean; salePrice: number; yahooPrice?: number | null }): number | null {
  const prices = [card.saleInStock !== false && card.salePrice > 0 ? card.salePrice : null, typeof card.yahooPrice === 'number' && card.yahooPrice > 0 ? card.yahooPrice : null].filter(
    (p): p is number => p !== null,
  );
  return prices.length > 0 ? Math.min(...prices) : null;
}
