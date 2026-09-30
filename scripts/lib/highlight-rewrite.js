// 公開済みのデッキ記事の見どころを Claude API でまとめて書き直す（scripts/ai-highlight-rewrite.js から使う。テストは scripts/test/highlight-rewrite.test.js）
//
// - 書き方は自動生成と同じ（scripts/lib/ai-highlight.js の createAiHighlighter: 同じ指示・同じ点検・1回だけの書き直し）
// - highlightBy: 'manual'（人が手で直した印）の記事は書き直さない
// - 点検を通らなかった・API のエラーの記事は、今の見どころのまま残す
// - 書き直せた文は、チェック役（ai.review）に公式テキストと見比べさせ、結果（✅ / ⚠）を PR に出す（⚠ でも文は使う）
// - 同じ日の記事と書き出しが似ないよう、比べる相手には「書き直したものは新しい文・それ以外は今の文」を渡す（書き直した文どうしも比べる）

import { reviewLabel, usageLines } from './ai-highlight.js';

/** API のエラーがこの回数続いたら、残りの記事は呼ばずにやめる（残高不足・キーの問題はその場でやめる） */
export const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * 書き直す記事を選ぶ（公開日が新しい順。同じ日は deck-columns.json の順）
 * @param {object[]} columns deck-columns.json
 * @param {{ limit?: number | null, today: string }} options limit は「試しに何本だけ」（null / 0 ならすべて）
 * @returns {{ targets: object[], manual: object[], all: number }} all は limit をかける前の対象の本数
 */
export function rewriteTargets(columns, { limit = null, today }) {
  const published = columns.filter((c) => c.pubDate <= today);
  const manual = published.filter((c) => c.highlightBy === 'manual');
  const order = new Map(columns.map((c, i) => [c.slug, i]));
  const candidates = published
    .filter((c) => c.highlightBy !== 'manual')
    .sort((a, b) => b.pubDate.localeCompare(a.pubDate) || order.get(a.slug) - order.get(b.slug));
  return { targets: limit ? candidates.slice(0, limit) : candidates, manual, all: candidates.length };
}

/**
 * 書き直す（deck-columns.json はここでは変えない。applyRewrites で反映する）
 * @param {{
 *   columns: object[], targets: object[],
 *   namesOf: (column: object) => string[],
 *   materialsOf: (column: object) => Promise<{ recipe: object[], profiles: Map<string, object> }>,
 *   ai: { write: Function, review?: Function, stats: object },
 *   log?: (msg: string) => void,
 * }} options
 * @returns {Promise<{ slug, deckName, pubDate, before, after: string | null, reason?: string, attempts: number, review?: { status, reasons } }[]>}
 */
export async function rewriteHighlights({ columns, targets, namesOf, materialsOf, ai, log = () => {} }) {
  const current = new Map(columns.map((c) => [c.slug, c.highlight]));
  const results = [];
  let consecutiveErrors = 0;
  let stopReason = null;
  for (const column of targets) {
    const base = { slug: column.slug, deckName: column.deckName, pubDate: column.pubDate, before: column.highlight, after: null, attempts: 0 };
    if (stopReason) {
      results.push({ ...base, reason: `${stopReason}ため、この記事は呼ばなかった` });
      continue;
    }
    log(`- ${column.slug}（${column.pubDate}）`);
    const main = column.keyCards?.[0];
    if (!main) {
      results.push({ ...base, reason: '主力カード（keyCards）がない' });
      continue;
    }
    let materials;
    try {
      materials = await materialsOf(column);
    } catch (error) {
      results.push({ ...base, reason: `採用カードの公式テキストを取れなかった（${error?.message ?? error}）` });
      continue;
    }
    if (!materials.recipe?.length) {
      results.push({ ...base, reason: '60枚のレシピ（official-decks.json）がない' });
      continue;
    }
    // 書き出しを比べる相手: 同じ日のほかの記事（書き直したものは新しい文、manual・未処理・失敗したものは今の文）
    const others = columns
      .filter((c) => c.pubDate === column.pubDate && c.slug !== column.slug)
      .map((c) => ({ slug: c.slug, highlight: current.get(c.slug), names: namesOf(c) }))
      .filter((o) => o.highlight);
    const r = await ai.write({ deckName: column.deckName, main, recipe: materials.recipe, profiles: materials.profiles, names: namesOf(column), others });
    // チェック役（書き直せた文だけ）。上限・API のエラーは「チェックできず」とし、文は使う
    const review = r.text && ai.review ? await ai.review({ text: r.text, main, recipe: materials.recipe, profiles: materials.profiles }) : null;
    if (r.text) {
      current.set(column.slug, r.text);
      results.push({ ...base, after: r.text, attempts: r.attempts, ...(review ? { review } : {}) });
    } else {
      results.push({ ...base, reason: r.reason, attempts: r.attempts });
    }
    if (r.limit || review?.limit) stopReason = 'API を呼べる回数の上限に達した';
    if (review?.fatal) stopReason = 'API のエラー（キー・権限・残高の問題）が出た';
    if (r.apiError || review?.apiError) {
      consecutiveErrors++;
      if (r.fatal) stopReason = 'API のエラー（キー・権限・残高の問題）が出た';
      else if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) stopReason = `API のエラーが${MAX_CONSECUTIVE_ERRORS}回続いた`;
    } else {
      consecutiveErrors = 0;
    }
  }
  return results;
}

/** 見どころを書き直した結果を deck-columns.json の記事に反映する（highlightBy: 'ai' を highlight のすぐ後ろに付ける）。反映した本数を返す */
export function applyRewrites(columns, results) {
  const after = new Map(results.filter((r) => r.after && r.after !== r.before).map((r) => [r.slug, r.after]));
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    if (!after.has(c.slug) || c.highlightBy === 'manual') continue;
    const next = {};
    for (const [k, v] of Object.entries(c)) {
      if (k === 'highlightBy') continue;
      next[k] = k === 'highlight' ? after.get(c.slug) : v;
      if (k === 'highlight') next.highlightBy = 'ai';
    }
    columns[i] = next;
  }
  return after.size;
}

/** Markdown の表のセル（| と改行を崩さない） */
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/**
 * PR の本文（Markdown）
 * @param {{ results: object[], manual: object[], stats: object, audit: { banned: object[], similar: object[] }, limit: number | null, all: number }} r
 */
export function rewritePrBody({ results, manual, stats, audit, limit, all }) {
  const changed = results.filter((r) => r.after && r.after !== r.before);
  const same = results.filter((r) => r.after && r.after === r.before);
  const failed = results.filter((r) => !r.after);
  const apiErrors = [...new Set(failed.map((r) => r.reason).filter((reason) => /Claude API のエラー/.test(reason ?? '')))];
  // チェック役で ⚠（要確認・チェックできず）になった記事は、本文のいちばん上にまとめる
  const flagged = changed.filter((r) => r.review && r.review.status !== 'ok');
  return [
    ...(flagged.length
      ? [
          `> [!WARNING]`,
          `> **チェック役の AI が ⚠ を付けた記事（${flagged.length}本）**。記事の「主力カードの効果」と見比べ、直すなら \`highlight\` を手で直して \`highlightBy\` を \`"manual"\` にしてください`,
          ...flagged.map((r) => `> - \`/columns/${r.slug}/\`（${cell(r.deckName)}）: ${cell(reviewLabel(r.review))}`),
          '',
        ]
      : []),
    '## 🤖 公開済みデッキ記事の見どころを Claude API で書き直し',
    '',
    'Actions の「AI highlight rewrite (manual)」（`scripts/ai-highlight-rewrite.js`）で作りました。書き方は自動生成と同じです（同じ指示・同じ点検・点検に通らなければ1回だけ書き直し）。',
    '',
    `- 対象: 公開済みのデッキ記事のうち、手で直した印（\`highlightBy: "manual"\`）のない ${all}本${limit ? `のうち、公開日が新しい順に **${results.length}本（試しに${limit}本だけ）**` : ''}`,
    `- 書き直した: **${changed.length}本**${changed.length ? '（`deck-columns.json` の `highlightBy` を `"ai"` にしました）' : ''}`,
    ...(changed.some((r) => r.review) ? [`- チェック役: ✅ ${changed.filter((r) => r.review?.status === 'ok').length}本・⚠ ${flagged.length}本`] : []),
    `- 書き直せなかった: ${failed.length}本（今の見どころのまま）${same.length ? `・AI の文が今と同じ: ${same.length}本` : ''}`,
    `- 手で直した印があるため対象外: ${manual.length}本${manual.length ? `（${manual.map((c) => `\`${c.slug}\``).join('・')}）` : ''}`,
    '',
    `### 変更前と変更後（${changed.length}本）`,
    ...(changed.length
      ? [
          '| 記事 | 変更前 | 変更後 | チェック |',
          '| --- | --- | --- | --- |',
          ...changed.map((r) => `| \`/columns/${r.slug}/\`<br>${cell(r.deckName)}（${r.pubDate}${r.attempts === 2 ? '・書き直し1回' : ''}） | ${cell(r.before)} | ${cell(r.after)} | ${cell(reviewLabel(r.review) || '—')} |`),
        ]
      : ['- なし']),
    '',
    `### 書き直せなかった記事（${failed.length}本）`,
    ...(failed.length ? failed.map((r) => `- \`/columns/${r.slug}/\`（${r.deckName}）: ${r.reason}`) : ['- なし']),
    ...(apiErrors.length ? ['', '> ⚠ Claude API のエラーがありました（API が返した理由）:', ...apiErrors.map((e) => `> - ${e}`)] : []),
    '',
    '### Claude API の使用量',
    ...(stats.enabled ? usageLines(stats) : ['- ANTHROPIC_API_KEY が設定されていないため、Claude API は使っていません（見どころはすべて今のまま）']),
    '',
    '### 書き直し後の点検（全記事）',
    ...(audit.banned.length || audit.similar.length
      ? [
          ...audit.banned.map((b) => `- ⚠ \`/columns/${b.slug}/\` の${b.where}に決まった文が含まれています: ${b.labels.join('・')}`),
          ...audit.similar.map(([a, b, head]) => `- ⚠ \`/columns/${a.slug}/\` と \`/columns/${b.slug}/\` の見どころの書き出しがそっくりです（${a.pubDate}。骨組み: 「${head}…」）`),
        ]
      : ['- 決まった文・同じ日の記事の書き出しの似かよいはありません']),
    '',
    '### 確認すること',
    ...(flagged.length ? ['- [ ] いちばん上の ⚠ の記事を、記事の「主力カードの効果」と見比べた'] : []),
    '- [ ] 「変更後」の見どころを記事の「主力カードの効果」と見比べ、カードテキストにないことが書かれていないか確認した',
    '- [ ] 直したい見どころは `deck-columns.json` の `highlight` を手で直し、`highlightBy` を `"manual"` にした（次のまとめ書き直しで上書きされない）',
  ].join('\n');
}
