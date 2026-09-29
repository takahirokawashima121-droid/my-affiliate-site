// 公開済み・作成済みのデッキ記事に、デッキ名の言い換えルール（scripts/lib/deck-name-rules.js）を当てはめる
//
// 使い方:
//   npm run apply-name-rules              deck-columns.json とページ（src/pages/columns/{slug}.astro）のデッキ名を書き換える
//   npm run apply-name-rules -- --dry-run 変更予定を表示するだけ（何も保存しない）
//
// 仕組み:
// 1. 全記事のレシピ（src/data/official-decks.json）を言い換えルールと照らし、当てはまればデッキ名（型名を外した名前）をルールの名前にする。
//    ルールのカードが少なく迷うもの（ヤドキング1枚だけなど）は書き換えず、一覧に出す（PR で人が確認する）
// 2. 同じ名前のデッキが複数になったら「（〇〇採用型）」で区別する（scripts/lib/deck-variant.js）。区別できるカードがない（大きな差がない）記事は型名なし。
//    すでに付いている型名は、同じ名前のほかの記事と重ならなければそのまま使う。1本だけになったら型名を外す
// 3. deckName・title・description・highlight と、ページ本文のデッキ名の表記（「〇〇デッキ」・型名つきの名前）を置き換える。
//    カード名と同じデッキ名（「ヤドキング」など）は「ヤドキングデッキ」の形だけを置き換え、カード名としての表記は残す
// URL（slug）は変えない（公開済みの記事の URL を保つため）。URL を変える場合は astro.config.mjs の redirects に旧URL → 新URL を追加する

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { baseDeckName, variantLabel } from './lib/deck-variant.js';
import { matchDeckNameRule } from './lib/deck-name-rules.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const COLUMNS_PATH = path('src/data/deck-columns.json');
const DECKS_PATH = path('src/data/official-decks.json');

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
const labelOf = (deckName) => deckName.match(/（([^（）]*)型）$/)?.[1] ?? null;
const replaceAll = (text, from, to) => (from && from !== to ? text.split(from).join(to) : text);

/**
 * デッキ名の表記を置き換える（型名つきの名前 → 「〇〇デッキ」→ 括弧つきのアーキタイプ名の順）。
 * 型名のない名前（「おまつりおんど」「ヤドキング」）は特性名・カード名と同じ文字なので、「〇〇デッキ」の形だけを置き換える
 */
function renameText(text, before, after) {
  let out = before.deckName !== before.base ? replaceAll(text, before.deckName, after.deckName) : text;
  out = replaceAll(out, `${before.base}デッキ`, `${after.base}デッキ`);
  // 「カミッチュ（おまつりおんど）」のようにカード名ではない呼び名は、どこに出てきても置き換える
  if (/[（(]/.test(before.base)) out = replaceAll(out, before.base, after.base);
  return out;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const columns = JSON.parse(await readFile(COLUMNS_PATH, 'utf8'));
  const recipes = JSON.parse(await readFile(DECKS_PATH, 'utf8'));
  const recipeOf = (c) => recipes[c.deckKey]?.cards ?? recipes[c.slug]?.cards ?? null;

  const uncertain = [];
  const nextBase = new Map(); // slug → 言い換え後のデッキ名（型名なし）
  const ruled = new Set(); // ルールで名前が変わる記事
  for (const c of columns) {
    const recipe = recipeOf(c);
    const base = baseDeckName(c.deckName);
    const hit = recipe && matchDeckNameRule(recipe);
    if (hit?.uncertain) uncertain.push({ c, name: hit.name });
    if (hit && !hit.uncertain && norm(hit.name) !== norm(base)) {
      nextBase.set(c.slug, hit.name);
      ruled.add(c.slug);
    } else nextBase.set(c.slug, base);
  }

  // 名前が変わる記事と、変わった後に同じ名前になる記事のグループごとに、型名を付け直す
  const groups = new Map();
  for (const c of columns) {
    const key = norm(nextBase.get(c.slug));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const changes = [];
  for (const group of groups.values()) {
    if (!group.some((c) => ruled.has(c.slug))) continue;
    const labels = new Map();
    if (group.length > 1) {
      for (const c of group) {
        const kept = labelOf(c.deckName);
        const dup = kept && group.some((o) => o !== c && labelOf(o.deckName) === kept);
        if (kept && !dup && !/^別構築$/.test(kept)) labels.set(c.slug, kept);
        else if (recipeOf(c)) {
          // このデッキにしか入っていないカードがなく、枚数の違いでも区別できない（大きな差がない）ときは型名を付けない
          const label = variantLabel(recipeOf(c), group.filter((o) => o !== c && recipeOf(o)).map(recipeOf));
          if (label.card) labels.set(c.slug, label.text);
        }
      }
    }
    for (const c of group) {
      const base = nextBase.get(c.slug);
      const deckName = labels.has(c.slug) ? `${base}（${labels.get(c.slug)}型）` : base;
      if (deckName === c.deckName) continue;
      changes.push({ c, before: { deckName: c.deckName, base: baseDeckName(c.deckName) }, after: { deckName, base } });
    }
  }

  console.log(`■ 言い換えルールで名前を変える記事: ${changes.length}件`);
  for (const { c, before, after } of changes) console.log(`  - /columns/${c.slug}/ ${before.deckName} → ${after.deckName}${ruled.has(c.slug) ? '' : '（同名デッキと区別する型名の付け直し）'}`);
  console.log(`\n■ 言い換えルールに当てはまるか迷う記事（書き換えません）: ${uncertain.length}件`);
  for (const { c, name } of uncertain) console.log(`  - /columns/${c.slug}/ ${c.deckName}（「${name}」のカードが少ない）`);
  if (dryRun) return console.log('\n（dry-run: 何も保存しません）');

  for (const { c, before, after } of changes) {
    // タイトルは型名つきの名前（「〇〇（△△採用型）デッキレシピ」）にする
    c.title = renameText(replaceAll(c.title, `${before.deckName}デッキ`, `${after.deckName}デッキ`), before, after);
    for (const key of ['description', 'highlight']) if (typeof c[key] === 'string') c[key] = renameText(c[key], before, after);
    c.deckName = after.deckName;
    const page = path(`src/pages/columns/${c.slug}.astro`);
    if (existsSync(page)) await writeFile(page, renameText(await readFile(page, 'utf8'), before, after), 'utf8');
  }
  await writeFile(COLUMNS_PATH, `${JSON.stringify(columns, null, 2)}\n`, 'utf8');
  console.log(`\n${changes.length}件を書き換えました（src/data/deck-columns.json・src/pages/columns/*.astro）。本文の表記は git diff で確認してください`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
