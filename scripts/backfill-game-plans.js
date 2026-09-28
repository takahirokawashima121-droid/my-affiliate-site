// 既存のデッキ解説コラムのうち、「回し方」（序盤・中盤・終盤）が未記載・TODO のままの記事に、
// 60枚の構成と公式のカードテキストから立ち回り（gamePlan）を自動生成して src/data/deck-columns.json に追記する。
// 表示はデッキ解説ページの「立ち回り・対戦の手順」（src/components/GamePlan.astro）。
//
// 使い方:
//   npm run backfill-plans              未記載の記事だけに追記
//   npm run backfill-plans -- --dry-run 生成する内容を表示するだけ（保存しない）
//   npm run backfill-plans -- --force   自動生成済み（gamePlan あり）の記事も作り直す（手書きの「回し方」がある記事は対象外）
//
// 手書きの「回し方」（ページ内の <h2>回し方</h2>）がある記事には追記しない（記事の内容と重複させないため）

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildGamePlan, recipeProfiles } from './lib/game-plan.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const COLUMNS_PATH = path('src/data/deck-columns.json');
const DECKS_PATH = path('src/data/official-decks.json');
/** 自動生成のページに残っている「回し方」の TODO（生成済みの立ち回りで置き換えるので消す） */
const PLAN_TODO = /^\s*\{\/\* TODO: 回し方（序盤・中盤・終盤）を追記する \*\/\}\n\n?/m;

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const columns = JSON.parse(await readFile(COLUMNS_PATH, 'utf8'));
const recipes = JSON.parse(await readFile(DECKS_PATH, 'utf8'));

let done = 0;
for (const column of columns) {
  const pagePath = path(`src/pages/columns/${column.slug}.astro`);
  if (!existsSync(pagePath) || !recipes[column.deckKey]) continue;
  const page = await readFile(pagePath, 'utf8');
  const handWritten = page.includes('<h2>回し方</h2>');
  if (handWritten || (column.gamePlan && !force)) continue;

  const recipe = recipes[column.deckKey].cards;
  const plan = buildGamePlan(recipe, await recipeProfiles(recipe), column.keyCards[0]);
  console.log(`\n■ ${column.deckName}（/columns/${column.slug}/）`);
  for (const [label, key] of [['序盤', 'early'], ['中盤', 'mid'], ['終盤', 'end']]) {
    console.log(`  [${label}]`);
    for (const p of plan[key]) console.log(`   - ${p}`);
  }
  done++;
  if (dryRun) continue;
  column.gamePlan = plan;
  if (PLAN_TODO.test(page)) await writeFile(pagePath, page.replace(PLAN_TODO, ''), 'utf8');
}

if (!dryRun && done > 0) await writeFile(COLUMNS_PATH, `${JSON.stringify(columns, null, 2)}\n`, 'utf8');
console.log(`\n${done}本の記事に立ち回りを${dryRun ? '生成しました（dry-run: 保存していません）' : '追記しました'}`);
