// 自動生成の Pull Request 本文（scripts/auto-deck-updater.js が書き出す）の「生成した記事」の1本分を作る。
// 大会の日付・開催店舗と都道府県・順位・元記事の何会場目か・デッキ名の取り方を並べ、元記事と見比べやすくする。
// 取れなかった項目は空欄にせず「取得できず」と書く（テストは scripts/test/pr-body.test.js）

import { reviewLabel } from './ai-highlight.js';

export const UNKNOWN = '取得できず';

/** 「青馬堂矢向店（神奈川）」のように会場名の最後に都道府県があるか。なければ都道府県は取得できず */
export const venueText = (venue) => (!venue ? `開催店舗・都道府県: ${UNKNOWN}` : /（[^（）]+）(?:-\d+)?$/.test(venue) ? venue : `${venue}（都道府県: ${UNKNOWN}）`);

/** デッキ名をどこから取ったか（●付き小見出し・h2 の見出し・レシピから推定・通称ルール） */
export function nameSourceText(c) {
  const s = c.source;
  // 通称ルールで変えた名前は、元の名前（ルールを当てる前）の取り方を出す
  const inferred = c.renamedByRule ? s.sourceInferred : c.inferred || !s.nameSource;
  const origin = inferred ? '⚠ 推定' : s.nameSource === 'bullet' ? '●付き小見出し' : '見出し';
  return c.renamedByRule ? `通称ルール・元の名前「${c.sourceName}」は${origin}` : origin;
}

/**
 * 見どころをどちらの方法で書いたか（c.highlightResult は scripts/auto-deck-updater.js が入れる { ai, reason, review }）。
 * AI で書いたものは、チェック役の結果（✅ チェック済み / ⚠ 要確認：理由 / ⚠ チェックできず）も付ける。
 * 「AIで作成」= Claude API（scripts/lib/ai-highlight.js）、「従来の方法」= 公式のカードテキストの組み立て（scripts/lib/highlight.js）
 */
export function highlightMethod(c) {
  if (c.highlightResult?.ai) return c.highlightResult.review ? `AIで作成・${reviewLabel(c.highlightResult.review)}` : 'AIで作成';
  return c.highlightResult?.reason ? `従来の方法・${c.highlightResult.reason}` : '従来の方法';
}

/**
 * PR の「生成した記事」の1本分（Markdown のリスト項目。行の区切りは <br>）。
 * c は auto-deck-updater.js の generated の要素（c.source に大会の情報）。例:
 * - 【9/27 シティリーグ 優勝】青馬堂矢向店（神奈川）
 *   ドラパルトex（⚠ 推定）
 *   /columns/dragapult-ex-deck-0927/
 *   元記事：[シティリーグ9/27ベスト16デッキまとめ](…) の5会場目
 */
export function generatedItem(c) {
  const s = c.source;
  const lines = [
    `【${s.date ?? `日付${UNKNOWN}`} ${s.eventLabel} ${s.rank ?? `順位${UNKNOWN}`}】${venueText(s.venue)}`,
    `**${c.deckName}**（${nameSourceText(c)}）${c.ruleUncertain ? `・⚠「${c.ruleUncertain}」に当てはまるか要確認` : ''}`,
    `\`/columns/${c.slug}/\``,
    `元記事：[${s.articleTitle}](${s.articleLink}) の${s.venueNo ? `${s.venueNo}会場目` : `何会場目か${UNKNOWN}`}`,
  ];
  return `- ${lines.join('<br>\n  ')}`;
}
