// 公開済みのデッキ記事の見どころ（deck-columns.json の highlight）を Claude API でまとめて書き直す
//
// 使い方:
//   npm run ai-highlight-rewrite                    手で直した印（highlightBy: 'manual'）のない公開済みの記事をすべて書き直す
//   npm run ai-highlight-rewrite -- --limit=5       試しに5本だけ（公開日が新しい順）
//   npm run ai-highlight-rewrite -- --dry-run       書き直した結果を表示するだけ（deck-columns.json は変えない。API は呼ぶ）
//   npm run ai-highlight-rewrite -- --only-flagged  要確認の記事だけ直す: manual 以外の記事の今の見どころをチェックし、要確認の記事だけを
//                                                   「誤り」の理由を渡して直させ、もう一度チェックして問題なしになったものだけ変える。
//                                                   manual の記事はチェックだけ（直さない。要確認なら PR で知らせる）。--limit・--dry-run と一緒に使える
//   npm run ai-highlight-rewrite -- --tagline-only  ひとことだけ作る: 一覧のカードに出すひとこと（tagline。30〜40字）だけを書く。
//                                                   見どころ（highlight・highlightBy）は変えない（manual の見どころもそのまま）。
//                                                   taglineBy: 'manual' の記事は書かない。--limit・--dry-run と一緒に使える
//   npm run ai-highlight-rewrite -- --tagline-only --tagline-missing
//                                                   ひとことがまだない記事だけ作る（書けたひとことは変えない）
//   GitHub Actions の「AI highlight rewrite (manual)」（.github/workflows/ai-highlight-rewrite.yml）から実行すると、結果を新しいブランチの PR にする
//
// 書き方は自動生成と同じ（scripts/lib/ai-highlight.js: 同じ指示・同じ点検・1回だけの書き直し。AI に渡すのはデッキ名・60枚のレシピ・
// 採用カードの公式テキストだけ）。点検に通らなかった・API のエラーの記事は今の見どころのまま残す。
// 書き直せた文は、チェック役（別の呼び出し）が公式テキストと見比べ、記事ごとに「✅ チェック済み / ⚠ 要確認：理由 / ⚠ チェックできず」を PR に出す。
// チェック役が要確認にしたら、「誤り」の理由を渡して1回だけ直させ、もう一度チェックする（🔧 自分で直せた / 🙋 直せずに人に知らせた）。
// 1回の実行で API を呼ぶ回数の上限は REWRITE_MAX_CALLS（250回。チェック役・直しの分も数える。通常の自動生成は AI_HIGHLIGHT_CONFIG.maxCallsPerRun の80回）。
// PR の本文は .cache/ai-highlight-rewrite-pr.md（GitHub Actions では実行結果の Summary にも出す）。ANTHROPIC_API_KEY が必要

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recipeProfiles } from './lib/game-plan.js';
import { auditHighlights } from './lib/highlight.js';
import { AI_HIGHLIGHT_CONFIG, REWRITE_MAX_CALLS, createAiHighlighter, usageLines } from './lib/ai-highlight.js';
import {
  applyRewrites,
  applyTaglines,
  fixFlaggedHighlights,
  fixFlaggedPrBody,
  rewriteHighlights,
  rewritePrBody,
  rewriteTargets,
  taglinePrBody,
  taglineTargets,
  writeTaglines,
} from './lib/highlight-rewrite.js';
import { buildXPosts } from '../src/utils/shareText.ts';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const COLUMNS_PATH = path('src/data/deck-columns.json');
const PR_BODY_PATH = path('.cache/ai-highlight-rewrite-pr.md');
const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** --limit=5 → 5。空・「all」・「すべて」・0 は null（すべて） */
export function parseLimit(argv) {
  const raw = argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length).trim() ?? '';
  if (raw === '' || raw === '0' || /^(all|すべて|全部)$/i.test(raw)) return null;
  const n = Number(raw.normalize('NFKC'));
  if (!Number.isInteger(n) || n < 0) throw new Error(`--limit には本数（例: 5）を指定してください（空欄ならすべて）: 「${raw}」`);
  return n || null;
}

/** PR の本文を書き、Summary と使用量を出す */
async function writeBody(body, ai) {
  mkdirSync(path('.cache/'), { recursive: true });
  await writeFile(PR_BODY_PATH, `${body}\n`, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  console.log(`\n${usageLines(ai.stats).join('\n')}`);
}

/** 「ひとことだけ作る」の後始末: PR の本文・deck-columns.json の保存・失敗の知らせ */
async function finish({ body, columns, applied, dryRun, ai, what }) {
  await writeBody(body, ai);
  if (dryRun) console.log(`\n（dry-run: deck-columns.json は変えていません。${what}を書けた記事 ${applied}本）`);
  else if (applied) {
    await writeFile(COLUMNS_PATH, `${JSON.stringify(columns, null, 2)}\n`, 'utf8');
    console.log(`\n${applied}本の${what}を書きました（src/data/deck-columns.json）。PR の本文: .cache/ai-highlight-rewrite-pr.md`);
  } else console.log(`\n${what}を書いた記事はありません（deck-columns.json は変えていません）`);
  if (!ai.stats.enabled || (ai.stats.errors > 0 && applied === 0)) process.exitCode = 1;
}

async function main() {
  // ローカルでは .env の ANTHROPIC_API_KEY も使う（GitHub Actions では Secrets から環境変数で渡す）
  if (existsSync(path('.env'))) process.loadEnvFile(path('.env'));
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limit = parseLimit(argv);
  const columns = JSON.parse(await readFile(COLUMNS_PATH, 'utf8'));
  const recipes = JSON.parse(await readFile(path('src/data/official-decks.json'), 'utf8'));
  const namesOf = (c) => [...(recipes[c.deckKey]?.cards ?? []).map((e) => e.name), ...(c.keyCards ?? [])];

  const onlyFlagged = argv.includes('--only-flagged');
  const taglineOnly = argv.includes('--tagline-only');
  const missingOnly = argv.includes('--tagline-missing');
  if (onlyFlagged && taglineOnly) throw new Error('--only-flagged と --tagline-only は一緒に使えません');
  if (missingOnly && !taglineOnly) throw new Error('--tagline-missing は --tagline-only と一緒に使います');
  const { targets, manual, all, existing = 0 } = (taglineOnly ? taglineTargets : rewriteTargets)(columns, { limit, today: todayJst(), missingOnly });
  const modeName = taglineOnly
    ? `ひとことだけ作る（見どころは変えない${missingOnly ? `・ひとことがまだない記事だけ。ひとことがある${existing}本は変えない` : ''}）`
    : onlyFlagged
      ? '要確認の記事だけ直す'
      : '見どころのまとめ書き直し';
  console.log(`■ ${modeName}（モデル: ${AI_HIGHLIGHT_CONFIG.model}・API を呼ぶ上限 ${REWRITE_MAX_CALLS}回）`);
  console.log(
    `  対象: ${targets.length}本${limit ? `（試しに${limit}本だけ・対象は全部で${all}本）` : ''}・手で直した印${taglineOnly ? '（taglineBy）' : ''}がある記事: ${manual.length}本${onlyFlagged ? '（チェックだけで直さない）' : '（対象外）'}`,
  );

  const ai = createAiHighlighter({ config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: REWRITE_MAX_CALLS }, log: (msg) => console.log(msg) });
  const options = {
    columns,
    targets,
    namesOf,
    // 採用カードの公式テキスト（公式サイトのカード詳細。.cache/ にあれば再取得しない。自動生成と同じ）
    materialsOf: async (c) => {
      const recipe = recipes[c.deckKey]?.cards ?? [];
      return { recipe, profiles: recipe.length ? await recipeProfiles(recipe) : new Map() };
    },
    ai,
    log: (msg) => console.log(msg),
  };
  const noKey = 'ANTHROPIC_API_KEY が設定されていない';
  let results;
  if (taglineOnly) {
    results = ai.stats.enabled
      ? await writeTaglines(options)
      : targets.map((c) => ({ slug: c.slug, deckName: c.deckName, pubDate: c.pubDate, highlight: c.highlight, before: c.tagline ?? null, after: null, reason: noKey, attempts: 0 }));
    const applied = applyTaglines(columns, results);
    const body = taglinePrBody({ results, manual, stats: ai.stats, limit, all, missingOnly, existing });
    await finish({ body, columns, applied, dryRun, ai, what: 'ひとこと' });
    for (const r of results.filter((x) => !x.after)) console.log(`  ⚠ ひとことを書けなかった: ${r.slug}（${r.reason}）`);
    for (const r of results.filter((x) => x.review && x.review.status !== 'ok')) console.log(`  ⚠ ひとことが要確認・チェックできず: ${r.slug}（${r.review.reasons.join(' / ')}）`);
    return;
  }
  if (onlyFlagged) {
    results = ai.stats.enabled
      ? await fixFlaggedHighlights({ ...options, manual })
      : [...targets, ...manual].map((c) => ({ slug: c.slug, deckName: c.deckName, pubDate: c.pubDate, before: c.highlight, after: null, manual: c.highlightBy === 'manual', review: { status: 'error', reasons: [noKey] } }));
  } else {
    results = ai.stats.enabled
      ? await rewriteHighlights(options)
      : targets.map((c) => ({ slug: c.slug, deckName: c.deckName, pubDate: c.pubDate, before: c.highlight, after: null, reason: noKey, attempts: 0 }));
  }

  const applied = applyRewrites(columns, results);
  const xText = (c) => buildXPosts({ deckName: c.deckName, result: c.result, highlight: c.highlight, tagline: c.tagline, estimate: 0, url: '' }).parent;
  const audit = auditHighlights(columns.map((c) => ({ slug: c.slug, pubDate: c.pubDate, highlight: c.highlight, names: namesOf(c), xText: xText(c) })));
  const body = onlyFlagged ? fixFlaggedPrBody({ results, stats: ai.stats, audit, limit, all }) : rewritePrBody({ results, manual, stats: ai.stats, audit, limit, all });

  await writeBody(body, ai);
  if (onlyFlagged) {
    for (const r of results.filter((x) => x.fix?.outcome === 'unfixed')) console.log(`  🙋 直せずに人に知らせる: ${r.slug}（${r.fix.firstReview.reasons.join(' / ')}）`);
    for (const r of results.filter((x) => x.manual && x.review.status === 'warn')) console.log(`  🙋 手で直した記事で要確認（直さない）: ${r.slug}（${r.review.reasons.join(' / ')}）`);
  } else {
    for (const r of results.filter((x) => !x.after)) console.log(`  ⚠ 書き直せなかった: ${r.slug}（${r.reason}）`);
  }

  if (dryRun) console.log(`\n（dry-run: deck-columns.json は変えていません。書き直せた記事 ${applied}本）`);
  else if (applied) {
    await writeFile(COLUMNS_PATH, `${JSON.stringify(columns, null, 2)}\n`, 'utf8');
    console.log(`\n${applied}本の見どころを書き直しました（src/data/deck-columns.json）。PR の本文: .cache/ai-highlight-rewrite-pr.md`);
  } else console.log('\n書き直した記事はありません（deck-columns.json は変えていません）');
  // キーがない・API のエラーで1本も書き直せなかったときは失敗として知らせる（理由は上と PR 本文・Summary に出している）
  if (!ai.stats.enabled || (ai.stats.errors > 0 && applied === 0)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
