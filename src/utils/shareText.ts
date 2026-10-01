// X（Twitter）告知用の投稿文（デッキ解説コラム用）
// サイト（記事末尾の「Xシェア用テキスト」）と scripts/auto-deck-updater.js（Pull Request の本文）の両方から使うため、
// astro:content には依存しない

/** 1ポスト目の上限（X の重み付き文字数。全角1文字＝2。280 のうち余裕を残して全角130文字ぶん） */
export const PARENT_POST_LIMIT = 260;

/** X の1ポストの上限（重み付き文字数） */
export const X_POST_LIMIT = 280;

/** X が URL を数える長さ（t.co に短縮され、長さによらず23） */
export const X_URL_LENGTH = 23;

/**
 * ひとことがない記事で、見どころの1文目が入りきらないときに縮める長さ（全角）。
 * ひとこと（scripts/lib/ai-highlight.js の TAGLINE_MAX）と同じ長さ。テストで一致を確かめる
 */
export const BLURB_MAX = 40;

/**
 * X の重み付き文字数（全角・絵文字は2、半角英数・記号の多くは1）。
 * twitter-text の規則（U+0000〜U+10FF・一部の記号は1、それ以外は2）を簡略化したもの
 */
export function xWeightedLength(text: string): number {
  let n = 0;
  // URL は長さによらず23として数える
  for (const ch of text.replace(/https?:\/\/\S+/g, () => 'x'.repeat(X_URL_LENGTH))) {
    const cp = ch.codePointAt(0) ?? 0;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

export type SharePostInput = {
  /** デッキ名（「メガゲッコウガex」「ボムドラパ」など。「（〇〇採用型）」のような付け足しはしない） */
  deckName: string;
  /** 大会・日付（「9/26 ジムバトル優勝」） */
  result: string;
  /** 見どころ（キーカード・戦術の要約）。ひとことがないときだけ使う */
  highlight: string;
  /** ひとこと（一覧のカードに出す30〜40字の紹介。deck-columns.json の tagline）。あればこれを「・」の行に使う */
  tagline?: string;
  /** 60枚の最安パーツ概算（円。0 なら行を省く） */
  estimate: number;
  /** 記事のURL（https://…/columns/{slug}/） */
  url: string;
};

/**
 * 長い文を BLURB_MAX 字以内に縮める。「…」は付けない。
 * カード名・特性名で止まるよう、BLURB_MAX 字以内の最後の「」」のあとで止める（例: 「ドラパルトexは、ワザ「ファントムダイブ」」）。
 * 「」」がなければ最後の「、」の手前（文末の「は」は外す）、それもなければ BLURB_MAX 字で止める
 */
function shortenAtClause(text: string): string {
  const chars = [...text];
  if (chars.length <= BLURB_MAX) return text;
  const head = chars.slice(0, BLURB_MAX);
  const quote = head.lastIndexOf('」');
  if (quote > 0) return head.slice(0, quote + 1).join('');
  const comma = head.lastIndexOf('、');
  if (comma > 0) return head.slice(0, comma).join('').replace(/は$/, '');
  return head.join('');
}

/**
 * 「・」の行に入れる紹介を決める（途中で「…」で切らない）。
 * - ひとこと（tagline）があればそのまま使う
 * - なければ見どころを文の切れ目（「。」）で止める。入るだけの文を前から入れ、1文目も入りきらないときだけ BLURB_MAX 字以内に縮める
 */
export function postBlurb(compose: (text: string) => string, { highlight, tagline }: { highlight: string; tagline?: string }): string {
  const t = tagline?.trim();
  if (t) return t;
  const sentences = highlight.split('。').map((x) => x.trim()).filter(Boolean).map((x) => `${x}。`);
  let blurb = '';
  for (const sentence of sentences) {
    if (xWeightedLength(compose(blurb + sentence)) > PARENT_POST_LIMIT) break;
    blurb += sentence;
  }
  return blurb || shortenAtClause(sentences[0] ?? highlight.trim());
}

/**
 * 親ポスト（URLなし・全角130文字前後）と、リプライ用の子ポスト（記事URL）を作る。
 * 「・」の行は、ひとこと（tagline）があればそれ、なければ見どころを文の切れ目で止めたもの（postBlurb）。
 * ジムバトル以外の結果（「環境Tier1・大会優勝構築」など）は、結果をそのまま見出しに使う
 */
export function buildXPosts({ deckName, result, highlight, tagline, estimate, url }: SharePostInput): { parent: string; reply: string } {
  const gym = /ジムバトル優勝/.test(result);
  const date = result.match(/\d{1,2}\/\d{1,2}/)?.[0];
  const head = gym ? `🏆【${deckName}】がジムバトル優勝！${date ? `（${date}）` : ''}` : `🏆【${deckName}】${result}のレシピを解説！`;
  const price = estimate > 0 ? `・60枚の最安パーツ概算 約${estimate.toLocaleString('ja-JP')}円` : '';
  const tags = gym ? '#ポケカ #ジムバトル優勝 #ポケトリー' : '#ポケカ #ポケカ環境 #ポケトリー';
  const compose = (h: string) => [head, `・${h}`, price, tags].filter(Boolean).join('\n');
  return {
    parent: compose(postBlurb(compose, { highlight, tagline })),
    reply: `確定レシピ・最安パーツ内訳・回し方は「ポケカファクトリー（ポケトリー）」でチェック👇\n${url}`,
  };
}

/** Tier表の親ポストが上限を超える場合は、Tier の行（デッキ名の並び）を末尾から「…」で詰める（今までどおり） */
function fitParent(compose: (text: string) => string, text: string): string {
  let t = text;
  while (t.length > 1 && xWeightedLength(compose(t)) > PARENT_POST_LIMIT) t = `${t.slice(0, -2)}…`;
  return compose(t);
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
