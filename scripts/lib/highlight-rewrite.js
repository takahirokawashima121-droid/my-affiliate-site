// 公開済みのデッキ記事の見どころを Claude API でまとめて書き直す（scripts/ai-highlight-rewrite.js から使う。テストは scripts/test/highlight-rewrite.test.js）
//
// - 書き方は自動生成と同じ（scripts/lib/ai-highlight.js の createAiHighlighter: 同じ指示・同じ点検・1回だけの書き直し）
// - highlightBy: 'manual'（人が手で直した印）の記事は書き直さない
// - 点検を通らなかった・API のエラーの記事は、今の見どころのまま残す
// - 書き直せた文は、チェック役に公式テキストと見比べさせ、要確認なら「誤り」の理由を渡して1回だけ直させてもう一度チェックする（ai.checkAndFix）。
//   結果（✅ / ⚠ と、🔧 自分で直せた / 🙋 直せずに人に知らせた）を PR に出す（⚠ でも文は使う）
// - 「要確認の記事だけ直す」モード（fixFlaggedHighlights）: 今の見どころをチェックし、要確認の記事だけを同じ方法で直す。
//   問題なしの記事・直せなかった記事は変えない。manual の記事はチェックだけで直さない（要確認なら PR で知らせる）
// - 同じ日の記事と書き出しが似ないよう、比べる相手には「書き直したものは新しい文・それ以外は今の文」を渡す（書き直した文どうしも比べる）
// - 「ひとことだけ作る」モード（writeTaglines）: 一覧のカードに出すひとこと（tagline）だけを書く。見どころ（highlight・highlightBy）は変えない。
//   taglineBy: 'manual'（人が手で直した印）の記事は書かない。チェック役・1回だけの直しは見どころと同じ（ai.checkAndFix(…, { kind: 'tagline' })）

import { TAGLINE_MAX, TAGLINE_MIN, fixLabel, reviewLabel, taglineLength, usageLines } from './ai-highlight.js';

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
    const input = { deckName: column.deckName, main, recipe: materials.recipe, profiles: materials.profiles, names: namesOf(column), others };
    const r = await ai.write(input);
    // チェック役（書き直せた文だけ）。要確認なら「誤り」の理由を渡して1回だけ直させ、もう一度チェックする（checkAndFix）。
    // 上限・API のエラーは「チェックできず」とし、文は使う。直しても要確認なら直した文を使い、PR で人に知らせる
    const checked = r.text && ai.checkAndFix ? await ai.checkAndFix(input, r.text) : null;
    const review = checked?.review;
    if (r.text) {
      const text = checked?.text ?? r.text;
      current.set(column.slug, text);
      results.push({ ...base, after: text, attempts: r.attempts, ...(review ? { review } : {}), ...(checked?.fix ? { fix: checked.fix } : {}) });
    } else {
      results.push({ ...base, reason: r.reason, attempts: r.attempts });
    }
    if (r.limit || checked?.limit) stopReason = 'API を呼べる回数の上限に達した';
    if (checked?.fatal) stopReason = 'API のエラー（キー・権限・残高の問題）が出た';
    if (r.apiError || checked?.apiError) {
      consecutiveErrors++;
      if (r.fatal) stopReason = 'API のエラー（キー・権限・残高の問題）が出た';
      else if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) stopReason = `API のエラーが${MAX_CONSECUTIVE_ERRORS}回続いた`;
    } else {
      consecutiveErrors = 0;
    }
  }
  return results;
}

/**
 * 「要確認の記事だけ直す」モード（deck-columns.json はここでは変えない。applyRewrites で反映する）
 * - targets（manual 以外の公開済みの記事）は、今の見どころをチェック役にかけ、要確認になった記事だけを checkAndFix の方法で直す
 *   （「誤り」の理由を渡して1回だけ直させ、もう一度チェック）。直した文が問題なしになったときだけ after に入れる
 * - 問題なし・チェックできずの記事は変えない。直しても要確認のままの記事も変えず（直した案は fix.after）、PR で人に知らせる
 * - manual の記事（手で直した見どころ）はチェックだけして直さない。要確認なら PR で知らせる
 * @param {{ columns: object[], targets: object[], manual: object[], namesOf: Function, materialsOf: Function, ai: object, log?: Function }} options
 * @returns {Promise<{ slug, deckName, pubDate, before, after: string | null, manual: boolean, review: object, fix?: object }[]>}
 */
export async function fixFlaggedHighlights({ columns, targets, manual, namesOf, materialsOf, ai, log = () => {} }) {
  const current = new Map(columns.map((c) => [c.slug, c.highlight]));
  const results = [];
  let consecutiveErrors = 0;
  let stopReason = null;
  const items = [...targets.map((c) => ({ column: c, manual: false })), ...manual.map((c) => ({ column: c, manual: true }))];
  for (const { column, manual: isManual } of items) {
    const base = { slug: column.slug, deckName: column.deckName, pubDate: column.pubDate, before: column.highlight, after: null, manual: isManual };
    const skip = (reason) => results.push({ ...base, review: { status: 'error', reasons: [reason] } });
    if (stopReason) {
      skip(`${stopReason}ため呼ばなかった`);
      continue;
    }
    log(`- ${column.slug}（${column.pubDate}${isManual ? '・manual' : ''}）`);
    const main = column.keyCards?.[0];
    if (!main || !column.highlight) {
      skip('主力カード（keyCards）または見どころがない');
      continue;
    }
    let materials;
    try {
      materials = await materialsOf(column);
    } catch (error) {
      skip(`採用カードの公式テキストを取れなかった（${error?.message ?? error}）`);
      continue;
    }
    if (!materials.recipe?.length) {
      skip('60枚のレシピ（official-decks.json）がない');
      continue;
    }
    let outcome;
    if (isManual) {
      // 手で直した見どころは直さない（チェックだけ）
      const review = await ai.review({ text: column.highlight, main, recipe: materials.recipe, profiles: materials.profiles });
      results.push({ ...base, review });
      outcome = review;
    } else {
      const others = columns
        .filter((c) => c.pubDate === column.pubDate && c.slug !== column.slug)
        .map((c) => ({ slug: c.slug, highlight: current.get(c.slug), names: namesOf(c) }))
        .filter((o) => o.highlight);
      const input = { deckName: column.deckName, main, recipe: materials.recipe, profiles: materials.profiles, names: namesOf(column), others };
      const checked = await ai.checkAndFix(input, column.highlight);
      const fixed = checked.fix?.outcome === 'fixed';
      if (fixed) current.set(column.slug, checked.text);
      results.push({ ...base, after: fixed ? checked.text : null, review: checked.review, ...(checked.fix ? { fix: checked.fix } : {}) });
      outcome = checked;
    }
    if (outcome.limit) stopReason = 'API を呼べる回数の上限に達した';
    if (outcome.fatal) stopReason = 'API のエラー（キー・権限・残高の問題）が出た';
    if (outcome.apiError) {
      consecutiveErrors++;
      if (!stopReason && consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) stopReason = `API のエラーが${MAX_CONSECUTIVE_ERRORS}回続いた`;
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

/** 表の「チェック」の欄: チェック役の結果と、要確認で AI に直させたときの結果（自分で直せた / 直せずに人に知らせた） */
const checkCell = (r) => [reviewLabel(r.review) || '—', r.fix ? fixLabel(r.fix) : null].filter(Boolean).map(cell).join('<br>');

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
          ...flagged.map((r) => `> - \`/columns/${r.slug}/\`（${cell(r.deckName)}）: ${cell(reviewLabel(r.review))}${r.fix ? `・${cell(fixLabel(r.fix))}` : ''}`),
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
    ...(changed.some((r) => r.fix) ? [`- 要確認になって AI に直させた: 🔧 自分で直せた ${changed.filter((r) => r.fix?.outcome === 'fixed').length}本・🙋 直せずに人に知らせた ${changed.filter((r) => r.fix?.outcome === 'unfixed').length}本`] : []),
    `- 書き直せなかった: ${failed.length}本（今の見どころのまま）${same.length ? `・AI の文が今と同じ: ${same.length}本` : ''}`,
    `- 手で直した印があるため対象外: ${manual.length}本${manual.length ? `（${manual.map((c) => `\`${c.slug}\``).join('・')}）` : ''}`,
    '',
    `### 変更前と変更後（${changed.length}本）`,
    ...(changed.length
      ? [
          '| 記事 | 変更前 | 変更後 | チェック |',
          '| --- | --- | --- | --- |',
          ...changed.map((r) => `| \`/columns/${r.slug}/\`<br>${cell(r.deckName)}（${r.pubDate}${r.attempts === 2 ? '・書き直し1回' : ''}） | ${cell(r.before)} | ${cell(r.after)} | ${checkCell(r)} |`),
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

/**
 * 「要確認の記事だけ直す」モードの PR の本文（Markdown）。要確認になった記事ごとに、結果・変更前・変更後・理由を表で出す
 * @param {{ results: object[], stats: object, audit: { banned: object[], similar: object[] }, limit: number | null, all: number }} r
 *   results は fixFlaggedHighlights の結果、all は limit をかける前の対象（manual 以外）の本数
 */
export function fixFlaggedPrBody({ results, stats, audit, limit, all }) {
  const fixed = results.filter((r) => !r.manual && r.fix?.outcome === 'fixed');
  const unfixed = results.filter((r) => !r.manual && r.fix?.outcome === 'unfixed');
  const manualFlagged = results.filter((r) => r.manual && r.review.status === 'warn');
  const clean = results.filter((r) => !r.fix && r.review.status === 'ok');
  const unchecked = results.filter((r) => !r.fix && r.review.status === 'error');
  const notify = [...unfixed, ...manualFlagged];
  const reasonsOf = (review) => (review?.reasons ?? []).join(' / ');
  const row = (r) => {
    const link = `\`/columns/${r.slug}/\`<br>${cell(r.deckName)}（${r.pubDate}）`;
    if (r.manual) return `| ${link} | 🙋 手で直した記事のため直さず知らせた | ${cell(r.before)} | （変えていない） | ${cell(reasonsOf(r.review))} |`;
    if (r.fix.outcome === 'fixed') return `| ${link} | 🔧 自分で直せた | ${cell(r.before)} | ${cell(r.after)} | ${cell(reasonsOf(r.fix.firstReview))} |`;
    const proposal = r.fix.after ? `（変えていない）<br>直した案：${cell(r.fix.after)}` : '（変えていない）';
    const second = r.fix.after && r.review.status === 'warn' ? `<br>直した案への指摘：${cell(reasonsOf(r.review))}` : '';
    const why = r.fix.reason ? `<br>${cell(r.fix.reason)}` : '';
    return `| ${link} | 🙋 直せずに人に知らせた | ${cell(r.before)} | ${proposal} | ${cell(reasonsOf(r.fix.firstReview))}${second}${why} |`;
  };
  const flaggedRows = [...fixed, ...unfixed, ...manualFlagged];
  return [
    ...(notify.length
      ? [
          '> [!WARNING]',
          `> **要確認のまま人に知らせる記事（${notify.length}本）**。記事の「主力カードの効果」と見比べ、直すなら \`highlight\` を手で直して \`highlightBy\` を \`"manual"\` にしてください`,
          ...notify.map((r) => `> - \`/columns/${r.slug}/\`（${cell(r.deckName)}）: ${r.manual ? '手で直した記事（直していません）' : '🙋 直せずに人に知らせた'}・⚠ 要確認：${cell(reasonsOf(r.manual ? r.review : r.fix.firstReview))}`),
          '',
        ]
      : []),
    '## 🔧 公開済みデッキ記事の見どころのうち、要確認の記事だけを Claude API で直す',
    '',
    'Actions の「AI highlight rewrite (manual)」の「要確認の記事だけ直す」（`scripts/ai-highlight-rewrite.js --only-flagged`）で作りました。今の見どころをチェック役にかけ、要確認になった記事だけ、チェック役の「誤り」の理由を渡して1回だけ直させ、もう一度チェックしています。',
    '',
    `- チェックした記事: 手で直した印（\`highlightBy: "manual"\`）のない ${all}本${limit ? `のうち、公開日が新しい順に **${results.filter((r) => !r.manual).length}本（試しに${limit}本だけ）**` : ''}と、手で直した記事 ${results.filter((r) => r.manual).length}本（直さずチェックだけ）`,
    `- ✅ 問題なし（変えていない）: ${clean.length}本`,
    `- 🔧 自分で直せた: **${fixed.length}本**${fixed.length ? '（`deck-columns.json` の `highlightBy` を `"ai"` にしました）' : ''}`,
    `- 🙋 直せずに人に知らせた: ${unfixed.length}本（今の見どころのまま）`,
    `- 🙋 手で直した記事で要確認（直さず知らせるだけ）: ${manualFlagged.length}本`,
    `- ⚠ チェックできず（変えていない）: ${unchecked.length}本`,
    '',
    `### 要確認になった記事（${flaggedRows.length}本）`,
    ...(flaggedRows.length
      ? ['| 記事 | 結果 | 変更前 | 変更後 | 理由（チェック役の「誤り」） |', '| --- | --- | --- | --- | --- |', ...flaggedRows.map(row)]
      : ['- なし']),
    '',
    ...(unchecked.length ? [`### チェックできなかった記事（${unchecked.length}本。変えていない）`, ...unchecked.map((r) => `- \`/columns/${r.slug}/\`（${r.deckName}）: ${reasonsOf(r.review)}`), ''] : []),
    '### Claude API の使用量',
    ...(stats.enabled ? usageLines(stats) : ['- ANTHROPIC_API_KEY が設定されていないため、Claude API は使っていません（見どころはすべて今のまま）']),
    '',
    '### 直したあとの点検（全記事）',
    ...(audit.banned.length || audit.similar.length
      ? [
          ...audit.banned.map((b) => `- ⚠ \`/columns/${b.slug}/\` の${b.where}に決まった文が含まれています: ${b.labels.join('・')}`),
          ...audit.similar.map(([a, b, head]) => `- ⚠ \`/columns/${a.slug}/\` と \`/columns/${b.slug}/\` の見どころの書き出しがそっくりです（${a.pubDate}。骨組み: 「${head}…」）`),
        ]
      : ['- 決まった文・同じ日の記事の書き出しの似かよいはありません']),
    '',
    '### 確認すること',
    ...(fixed.length ? ['- [ ] 「🔧 自分で直せた」記事の変更後の見どころを、記事の「主力カードの効果」と見比べた'] : []),
    ...(notify.length ? ['- [ ] いちばん上の「要確認のまま人に知らせる記事」を確認し、直すなら手で直して `highlightBy` を `"manual"` にした'] : []),
  ].join('\n');
}

/**
 * 「ひとことだけ作る」モードで書く記事を選ぶ（公開日が新しい順。同じ日は deck-columns.json の順）。
 * 見どころが手で直したもの（highlightBy: 'manual'）でも対象にする（見どころは変えず、ひとことだけ書く）。taglineBy: 'manual' の記事は対象外
 * missingOnly（「ひとことがまだない記事だけ」。--tagline-missing）なら、ひとこと（tagline）がまだない記事だけを選ぶ（書けたひとことは変えない）
 * @param {object[]} columns deck-columns.json
 * @param {{ limit?: number | null, today: string, missingOnly?: boolean }} options
 * @returns {{ targets: object[], manual: object[], all: number, existing: number }} existing は missingOnly で外した、ひとことがある記事の本数
 */
export function taglineTargets(columns, { limit = null, today, missingOnly = false }) {
  const published = columns.filter((c) => c.pubDate <= today);
  const manual = published.filter((c) => c.taglineBy === 'manual');
  const order = new Map(columns.map((c, i) => [c.slug, i]));
  const notManual = published.filter((c) => c.taglineBy !== 'manual');
  const existing = missingOnly ? notManual.filter((c) => c.tagline).length : 0;
  const candidates = notManual
    .filter((c) => !missingOnly || !c.tagline)
    .sort((a, b) => b.pubDate.localeCompare(a.pubDate) || order.get(a.slug) - order.get(b.slug));
  return { targets: limit ? candidates.slice(0, limit) : candidates, manual, all: candidates.length, existing };
}

/**
 * ひとことを書く（deck-columns.json はここでは変えない。applyTaglines で反映する）。見どころは渡すだけで変えない
 * - 点検（長さ 30〜40字を含む）に通らなければ理由（「今○字なので、あと○字削って」など）を伝えて2回まで書き直させる（ai.writeTagline）
 * - 書けた文はチェック役にかけ、要確認なら「誤り」の理由を渡して1回だけ直させ、もう一度チェックする（⚠ でも文は使い、PR で知らせる）
 * - 書けなかった記事は今のひとことのまま（なければ一覧は見どころを出す）
 * @param {{ columns: object[], targets: object[], namesOf: Function, materialsOf: Function, ai: { writeTagline: Function, checkAndFix: Function, stats: object }, log?: Function }} options
 * @returns {Promise<{ slug, deckName, pubDate, highlight, before, after: string | null, reason?: string, attempts: number, review?: object, fix?: object }[]>}
 */
export async function writeTaglines({ columns, targets, namesOf, materialsOf, ai, log = () => {} }) {
  const current = new Map(columns.map((c) => [c.slug, c.tagline]));
  const results = [];
  let consecutiveErrors = 0;
  let stopReason = null;
  for (const column of targets) {
    const base = { slug: column.slug, deckName: column.deckName, pubDate: column.pubDate, highlight: column.highlight, before: column.tagline ?? null, after: null, attempts: 0 };
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
    // 同じ日のほかの記事のひとこと（書いたものは新しい文）と同じ文にしない
    const others = columns
      .filter((c) => c.pubDate === column.pubDate && c.slug !== column.slug)
      .map((c) => ({ slug: c.slug, tagline: current.get(c.slug), names: namesOf(c) }))
      .filter((o) => o.tagline);
    const input = { deckName: column.deckName, main, recipe: materials.recipe, profiles: materials.profiles, names: namesOf(column), others, highlight: column.highlight };
    const r = await ai.writeTagline(input);
    const checked = r.text ? await ai.checkAndFix(input, r.text, { kind: 'tagline' }) : null;
    if (r.text) {
      const text = checked?.text ?? r.text;
      current.set(column.slug, text);
      results.push({ ...base, after: text, attempts: r.attempts, ...(checked?.review ? { review: checked.review } : {}), ...(checked?.fix ? { fix: checked.fix } : {}) });
    } else {
      results.push({ ...base, reason: r.reason, attempts: r.attempts });
    }
    if (r.limit || checked?.limit) stopReason = 'API を呼べる回数の上限に達した';
    if (r.fatal || checked?.fatal) stopReason = 'API のエラー（キー・権限・残高の問題）が出た';
    if (r.apiError || checked?.apiError) {
      consecutiveErrors++;
      if (!stopReason && consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) stopReason = `API のエラーが${MAX_CONSECUTIVE_ERRORS}回続いた`;
    } else {
      consecutiveErrors = 0;
    }
  }
  return results;
}

/**
 * 記事にひとことを入れる（tagline と taglineBy を、highlightBy（なければ highlight）のすぐ後ろに置く）。
 * highlight・highlightBy・ほかの欄は変えない。taglineBy: 'manual' の記事は上書きしない
 * @param {object} column
 * @param {string} tagline
 * @param {'ai' | 'manual'} by
 */
export function withTagline(column, tagline, by = 'ai') {
  const next = {};
  const anchor = 'highlightBy' in column ? 'highlightBy' : 'highlight';
  for (const [k, v] of Object.entries(column)) {
    if (k === 'tagline' || k === 'taglineBy') continue;
    next[k] = v;
    if (k === anchor) Object.assign(next, { tagline, taglineBy: by });
  }
  if (!('tagline' in next)) Object.assign(next, { tagline, taglineBy: by });
  return next;
}

/** ひとことを書いた結果を deck-columns.json の記事に反映する（taglineBy: 'ai'）。見どころは変えない。反映した本数を返す */
export function applyTaglines(columns, results) {
  const after = new Map(results.filter((r) => r.after && r.after !== r.before).map((r) => [r.slug, r.after]));
  let applied = 0;
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    if (!after.has(c.slug) || c.taglineBy === 'manual') continue;
    columns[i] = withTagline(c, after.get(c.slug), 'ai');
    applied++;
  }
  return applied;
}

/**
 * 「ひとことだけ作る」モードの PR の本文（Markdown）
 * @param {{ results: object[], manual: object[], stats: object, limit: number | null, all: number, missingOnly?: boolean, existing?: number }} r
 *   missingOnly: 「ひとことがまだない記事だけ」で作ったとき（existing はそのために外した、ひとことがある記事の本数）
 */
export function taglinePrBody({ results, manual, stats, limit, all, missingOnly = false, existing = 0 }) {
  const written = results.filter((r) => r.after && r.after !== r.before);
  const same = results.filter((r) => r.after && r.after === r.before);
  const failed = results.filter((r) => !r.after);
  const flagged = written.filter((r) => r.review && r.review.status !== 'ok');
  const apiErrors = [...new Set(failed.map((r) => r.reason).filter((reason) => /Claude API のエラー/.test(reason ?? '')))];
  return [
    ...(flagged.length
      ? [
          '> [!WARNING]',
          `> **チェック役の AI が ⚠ を付けたひとこと（${flagged.length}本）**。記事の「主力カードの効果」と見比べ、直すなら \`tagline\` を手で直して \`taglineBy\` を \`"manual"\` にしてください`,
          ...flagged.map((r) => `> - \`/columns/${r.slug}/\`（${cell(r.deckName)}）: ${cell(reviewLabel(r.review))}${r.fix ? `・${cell(fixLabel(r.fix))}` : ''}`),
          '',
        ]
      : []),
    '## 💬 公開済みデッキ記事の一覧のカードに出す「ひとこと」を Claude API で作成',
    '',
    missingOnly
      ? `Actions の「AI highlight rewrite (manual)」の「ひとことがまだない記事だけ作る」（\`scripts/ai-highlight-rewrite.js --tagline-only --tagline-missing\`）で作りました。ひとことは全角${TAGLINE_MIN}〜${TAGLINE_MAX}字で、はみ出したら「あと○字削って」と伝えて2回まで書き直させています。チェック役・1回だけの直しは見どころと同じ基準です。`
      : `Actions の「AI highlight rewrite (manual)」の「ひとことだけ作る」（\`scripts/ai-highlight-rewrite.js --tagline-only\`）で作りました。ひとことは全角${TAGLINE_MIN}〜${TAGLINE_MAX}字で、はみ出したら「あと○字削って」と伝えて2回まで書き直させています。チェック役・1回だけの直しは見どころと同じ基準です。`,
    '',
    '- **見どころ（`highlight`・`highlightBy`）は変えていません**（手で直した見どころもそのまま）。変えたのは `tagline` と `taglineBy`（`"ai"`）だけです',
    '- 一覧のカード（トップの特集・デッキ解説の一覧）は、ひとことがあればひとことを、なければ今までどおり見どころを出します',
    ...(missingOnly ? [`- **ひとことがまだない記事だけ**を対象にしました（ひとことがある ${existing}本は変えていません）`] : []),
    `- 対象: 公開済みのデッキ記事のうち、手で直した印（\`taglineBy: "manual"\`）のない${missingOnly ? '、ひとことがまだない' : ''} ${all}本${limit ? `のうち、公開日が新しい順に **${results.length}本（試しに${limit}本だけ）**` : ''}`,
    `- 書いた: **${written.length}本**${written.some((r) => r.review) ? `（チェック役: ✅ ${written.filter((r) => r.review?.status === 'ok').length}本・⚠ ${flagged.length}本）` : ''}`,
    ...(written.some((r) => r.fix) ? [`- 要確認になって AI に直させた: 🔧 自分で直せた ${written.filter((r) => r.fix?.outcome === 'fixed').length}本・🙋 直せずに人に知らせた ${written.filter((r) => r.fix?.outcome === 'unfixed').length}本`] : []),
    `- 書けなかった: ${failed.length}本（今のまま。ひとことがなければ一覧は見どころを出す）${same.length ? `・AI の文が今と同じ: ${same.length}本` : ''}`,
    `- 手で直した印があるため対象外: ${manual.length}本${manual.length ? `（${manual.map((c) => `\`${c.slug}\``).join('・')}）` : ''}`,
    '',
    `### 書いたひとこと（${written.length}本）`,
    ...(written.length
      ? [
          '| 記事 | ひとこと（字数） | 今の見どころ（参考・変えていない） | チェック |',
          '| --- | --- | --- | --- |',
          ...written.map(
            (r) =>
              `| \`/columns/${r.slug}/\`<br>${cell(r.deckName)}（${r.pubDate}${r.attempts === 2 ? '・書き直し1回' : ''}） | ${cell(r.after)}（${taglineLength(r.after)}字）${r.before ? `<br>変更前：${cell(r.before)}` : ''} | ${cell(r.highlight)} | ${checkCell(r)} |`,
          ),
        ]
      : ['- なし']),
    '',
    `### 書けなかった記事（${failed.length}本）`,
    ...(failed.length ? failed.map((r) => `- \`/columns/${r.slug}/\`（${r.deckName}）: ${r.reason}`) : ['- なし']),
    ...(apiErrors.length ? ['', '> ⚠ Claude API のエラーがありました（API が返した理由）:', ...apiErrors.map((e) => `> - ${e}`)] : []),
    '',
    '### Claude API の使用量',
    ...(stats.enabled ? usageLines(stats) : ['- ANTHROPIC_API_KEY が設定されていないため、Claude API は使っていません（ひとことは作っていません）']),
    '',
    '### 確認すること',
    ...(flagged.length ? ['- [ ] いちばん上の ⚠ のひとことを、記事の「主力カードの効果」と見比べた'] : []),
    '- [ ] ひとことを記事の「主力カードの効果」と見比べ、カードテキストにないことが書かれていないか確認した',
    '- [ ] Vercel のプレビューで、トップの特集とデッキ解説の一覧（ジムバトル・シティリーグ）のカードにひとことが出ているのを確認した',
    '- [ ] 直したいひとことは `deck-columns.json` の `tagline` を手で直し、`taglineBy` を `"manual"` にした（次の実行で上書きされない）',
  ].join('\n');
}
