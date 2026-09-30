// 公開済みの記事の見どころを、チェック役の AI（scripts/lib/ai-highlight.js の review）にかけて結果をログに出す（ファイルは変えない・PR も作らない）
//
// 使い方:
//   npm run ai-highlight-review                               公開済みの記事すべて
//   npm run ai-highlight-review -- --slug=n-zoroark-ex-deck   1本だけ
//   GitHub Actions の「AI highlight review (manual)」（.github/workflows/ai-highlight-review.yml）からも実行できる
//
// どちらの場合も、テスト用の7本（scripts/test/fixtures/ai-highlight-review-cases.json）を一緒にチェックし、合否を最後に出す。
// 合格の基準: mustFlag: true の2本（まとめ書き直しで AI が書き、人が手で直す前の文＝seek-inspiration-deck-0929・dipplin-festival-lead-deck-0927）を
// どちらも「要確認」にでき、mustNotFlag: true の3本（今サイトに出ている文＝slowking-deck・n-zoroark-ex-deck・mabusoruex-deck-0928）をすべて「問題なし」にできること。
// mustFlag: false の2本（n-zoroark-ex-deck・tauros-deck-0928 の手で直す前の文）は、直す前の文も間違いではないため、合否に数えない。
// チェック役に渡すのは、見どころと、そこに出てくるカードの公式テキスト（公式サイトのカード詳細。.cache/ にあれば再取得しない）だけ。
// 1回の実行で API を呼ぶ回数の上限は REWRITE_MAX_CALLS（250回）。ANTHROPIC_API_KEY が必要（ない・エラーのときは終了コード 1）

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recipeProfiles } from './lib/game-plan.js';
import { AI_HIGHLIGHT_CONFIG, REWRITE_MAX_CALLS, buildReviewPrompt, createAiHighlighter, reviewLabel, usageLines } from './lib/ai-highlight.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** --slug=xxx → 'xxx'。空欄・なしは null（すべて）。形が違えばエラー */
export function parseSlug(argv) {
  const raw = argv.find((a) => a.startsWith('--slug='))?.slice('--slug='.length).trim() ?? '';
  if (!raw) return null;
  if (!/^[a-z0-9-]+$/.test(raw)) throw new Error(`--slug は英小文字・数字・ハイフンのみで指定してください（空欄ならすべて）: 「${raw}」`);
  return raw;
}

/** テスト用の1本の結果の表示。mustFlag: false（手で直す前の文も間違いではない）は「問題なし」でも見逃しにしない */
export function testCaseMark(testCase, review) {
  if (review.status === 'error') return '－ チェックできず';
  if (testCase.mustNotFlag) return review.status === 'ok' ? '◯ 問題なしにできた' : '✕ 厳しすぎ（要確認）';
  if (!testCase.mustFlag) return review.status === 'warn' ? '・ 要確認（直す前の文も間違いではない）' : '・ 問題なし（直す前の文も間違いではない）';
  return review.status === 'warn' ? '◯ 要確認にできた' : '✕ 見逃した（問題なし）';
}

/** 合否: mustFlag: true の記事をすべて「要確認」にでき、mustNotFlag: true の記事をすべて「問題なし」にできれば合格 */
export function testCaseResult(items) {
  const required = items.filter((i) => i.testCase.mustFlag);
  const flagged = required.filter((i) => i.review.status === 'warn').length;
  const clean = items.filter((i) => i.testCase.mustNotFlag);
  const passed = clean.filter((i) => i.review.status === 'ok').length;
  const pass = required.length > 0 && flagged === required.length && passed === clean.length;
  return { pass, flagged, required: required.length, passed, clean: clean.length };
}

async function main() {
  // ローカルでは .env の ANTHROPIC_API_KEY も使う（GitHub Actions では Secrets から環境変数で渡す）
  if (existsSync(path('.env'))) process.loadEnvFile(path('.env'));
  const slug = parseSlug(process.argv.slice(2));
  const columns = JSON.parse(await readFile(path('src/data/deck-columns.json'), 'utf8'));
  const recipes = JSON.parse(await readFile(path('src/data/official-decks.json'), 'utf8'));
  const fixture = JSON.parse(await readFile(path('scripts/test/fixtures/ai-highlight-review-cases.json'), 'utf8'));

  const published = columns.filter((c) => c.pubDate <= todayJst());
  const targets = slug ? published.filter((c) => c.slug === slug) : published;
  if (slug && !targets.length) throw new Error(`slug「${slug}」の公開済みの記事が src/data/deck-columns.json にありません`);
  // テスト用の7本（手で直す前の文・今サイトに出ている文。カードは今の記事のレシピを使う）
  const cases = fixture.cases.map((k) => ({ ...columns.find((c) => c.slug === k.slug), highlight: k.highlight, testCase: k }));

  console.log(`■ 見どころのチェック（モデル: ${AI_HIGHLIGHT_CONFIG.model}・API を呼ぶ上限 ${REWRITE_MAX_CALLS}回）`);
  console.log(`  公開済みの記事: ${targets.length}本${slug ? `（${slug}）` : ''}・テスト用: ${cases.length}本`);
  const ai = createAiHighlighter({ config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: REWRITE_MAX_CALLS }, log: (msg) => console.log(msg) });
  if (!ai.stats.enabled) {
    console.log('\n⚠ ANTHROPIC_API_KEY が設定されていないため、チェックできません');
    process.exitCode = 1;
    return;
  }

  const results = [];
  let stopped = null;
  for (const column of [...targets, ...cases]) {
    const tag = column.testCase ? (column.testCase.mustNotFlag ? '【テスト用・要確認にしてはいけない】' : '【テスト用・手で直す前】') : '';
    console.log(`\n- ${tag}${column.slug}（${column.pubDate}${column.highlightBy ? `・${column.testCase ? 'ai' : column.highlightBy}` : ''}）`);
    console.log(`  見どころ: ${column.highlight}`);
    const recipe = recipes[column.deckKey]?.cards ?? [];
    const main = column.keyCards?.[0];
    let review;
    if (stopped) review = { status: 'error', reasons: [`${stopped}ため呼ばなかった`] };
    else if (!recipe.length || !main) review = { status: 'error', reasons: ['60枚のレシピまたは主力カードがない'] };
    else {
      const profiles = await recipeProfiles(recipe);
      const input = { text: column.highlight, main, recipe, profiles };
      console.log('::group::チェック役に渡した内容');
      console.log(buildReviewPrompt(input));
      console.log('::endgroup::');
      review = await ai.review(input);
      if (review.limit) stopped = 'API を呼べる回数の上限に達した';
      if (review.fatal) stopped = 'API のエラー（キー・権限・残高の問題）が出た';
    }
    console.log(`  → ${reviewLabel(review)}`);
    results.push({ column, review });
  }

  const real = results.filter((r) => !r.column.testCase);
  const count = (list, status) => list.filter((r) => r.review.status === status).length;
  console.log('\n■ まとめ（公開済みの記事）');
  console.log(`  ✅ 問題なし ${count(real, 'ok')}本・⚠ 要確認 ${count(real, 'warn')}本・⚠ チェックできず ${count(real, 'error')}本`);
  for (const r of real.filter((x) => x.review.status !== 'ok')) console.log(`  - ${r.column.slug}: ${reviewLabel(r.review)}`);

  console.log(`\n■ テスト用の${cases.length}本（合格の基準: ${fixture.passCriteria}）`);
  const tests = results.filter((r) => r.column.testCase);
  for (const r of tests) {
    const mark = testCaseMark(r.column.testCase, r.review);
    const counted = r.column.testCase.mustFlag || r.column.testCase.mustNotFlag;
    console.log(`  ${mark}: ${r.column.slug}${counted ? '' : '（合否に数えない）'}`);
    if (r.column.testCase.problem) console.log(`      人が直した点: ${r.column.testCase.problem}`);
    if (r.column.testCase.note) console.log(`      注意: ${r.column.testCase.note}`);
    if (r.review.reasons.length) console.log(`      チェック役の理由: ${r.review.reasons.join(' / ')}`);
    if (r.review.notes?.length) console.log(`      チェック役の参考（確認できず）: ${r.review.notes.join(' / ')}`);
  }
  const { pass, flagged, required, passed, clean } = testCaseResult(tests.map((r) => ({ testCase: r.column.testCase, review: r.review })));
  console.log(`  → ${pass ? '✅ 合格' : '❌ 不合格'}（要確認にすべき${required}本のうち ${flagged}本を要確認にでき、要確認にしてはいけない${clean}本のうち ${passed}本を問題なしにできた）`);

  console.log(`\n■ Claude API の使用量\n${usageLines(ai.stats).join('\n')}`);
  console.log('\n（チェックのみのため、ファイルは変更していません）');
  if (ai.stats.errors > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
