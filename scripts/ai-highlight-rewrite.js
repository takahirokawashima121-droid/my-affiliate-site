// 公開済みのデッキ記事の見どころ（deck-columns.json の highlight）を Claude API でまとめて書き直す
//
// 使い方:
//   npm run ai-highlight-rewrite                    手で直した印（highlightBy: 'manual'）のない公開済みの記事をすべて書き直す
//   npm run ai-highlight-rewrite -- --limit=5       試しに5本だけ（公開日が新しい順）
//   npm run ai-highlight-rewrite -- --dry-run       書き直した結果を表示するだけ（deck-columns.json は変えない。API は呼ぶ）
//   GitHub Actions の「AI highlight rewrite (manual)」（.github/workflows/ai-highlight-rewrite.yml）から実行すると、結果を新しいブランチの PR にする
//
// 書き方は自動生成と同じ（scripts/lib/ai-highlight.js: 同じ指示・同じ点検・1回だけの書き直し。AI に渡すのはデッキ名・60枚のレシピ・
// 採用カードの公式テキストだけ）。点検に通らなかった・API のエラーの記事は今の見どころのまま残す。
// 書き直せた文は、チェック役（別の呼び出し）が公式テキストと見比べ、記事ごとに「✅ チェック済み / ⚠ 要確認：理由 / ⚠ チェックできず」を PR に出す。
// 1回の実行で API を呼ぶ回数の上限は REWRITE_MAX_CALLS（250回。チェック役の分も数える。通常の自動生成は AI_HIGHLIGHT_CONFIG.maxCallsPerRun の20回）。
// PR の本文は .cache/ai-highlight-rewrite-pr.md（GitHub Actions では実行結果の Summary にも出す）。ANTHROPIC_API_KEY が必要

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recipeProfiles } from './lib/game-plan.js';
import { auditHighlights } from './lib/highlight.js';
import { AI_HIGHLIGHT_CONFIG, REWRITE_MAX_CALLS, createAiHighlighter, usageLines } from './lib/ai-highlight.js';
import { applyRewrites, rewriteHighlights, rewritePrBody, rewriteTargets } from './lib/highlight-rewrite.js';
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

async function main() {
  // ローカルでは .env の ANTHROPIC_API_KEY も使う（GitHub Actions では Secrets から環境変数で渡す）
  if (existsSync(path('.env'))) process.loadEnvFile(path('.env'));
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limit = parseLimit(argv);
  const columns = JSON.parse(await readFile(COLUMNS_PATH, 'utf8'));
  const recipes = JSON.parse(await readFile(path('src/data/official-decks.json'), 'utf8'));
  const namesOf = (c) => [...(recipes[c.deckKey]?.cards ?? []).map((e) => e.name), ...(c.keyCards ?? [])];

  const { targets, manual, all } = rewriteTargets(columns, { limit, today: todayJst() });
  console.log(`■ 見どころのまとめ書き直し（モデル: ${AI_HIGHLIGHT_CONFIG.model}・API を呼ぶ上限 ${REWRITE_MAX_CALLS}回）`);
  console.log(`  対象: ${targets.length}本${limit ? `（試しに${limit}本だけ・対象は全部で${all}本）` : ''}・手で直した印があるため対象外: ${manual.length}本`);

  const ai = createAiHighlighter({ config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: REWRITE_MAX_CALLS }, log: (msg) => console.log(msg) });
  const results = ai.stats.enabled
    ? await rewriteHighlights({
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
      })
    : targets.map((c) => ({ slug: c.slug, deckName: c.deckName, pubDate: c.pubDate, before: c.highlight, after: null, reason: 'ANTHROPIC_API_KEY が設定されていない', attempts: 0 }));

  const applied = applyRewrites(columns, results);
  const xText = (c) => buildXPosts({ deckName: c.deckName, result: c.result, highlight: c.highlight, estimate: 0, url: '' }).parent;
  const audit = auditHighlights(columns.map((c) => ({ slug: c.slug, pubDate: c.pubDate, highlight: c.highlight, names: namesOf(c), xText: xText(c) })));
  const body = rewritePrBody({ results, manual, stats: ai.stats, audit, limit, all });

  mkdirSync(path('.cache/'), { recursive: true });
  await writeFile(PR_BODY_PATH, `${body}\n`, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  console.log(`\n${usageLines(ai.stats).join('\n')}`);
  for (const r of results.filter((x) => !x.after)) console.log(`  ⚠ 書き直せなかった: ${r.slug}（${r.reason}）`);

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
