// 公開済み・作成済みのデッキ記事のデッキ名を、今のルールにそろえる
//   1. 付け足し（「（〇〇採用型）」「（〇〇2枚型）」など、カードの採用・枚数でデッキ名に付けていた区別）を外す
//   2. デッキ名の通称ルール（scripts/lib/deck-name-rules.js。例: ヤドキング採用 →「ひらめきチャレンジ」）を当てはめる
//
// 使い方:
//   npm run apply-name-rules                          deck-columns.json とページのデッキ名を書き換える
//   npm run apply-name-rules -- --dry-run             変更予定を表示するだけ（何も保存しない）
//   npm run apply-name-rules -- --report=.cache/x.md  結果の一覧（PR の説明用の Markdown）をファイルにも書き出す
//
// 仕組み:
// - 全記事のレシピ（src/data/official-decks.json）を通称ルールと照らし、当てはまればルールの名前、当てはまらなければ付け足しを外した名前にする。
//   ルールのカードが少なく迷うもの（ヤドキング1枚だけなど）と、違う名前の2つ以上のルールに当てはまるものは、ルールの名前にせず一覧に出す（PR で人が確認する）
// - deck-columns.json で "deckNameBy": "manual" の記事（人が手で付けたデッキ名）は、デッキ名を変えない（タイトルの開催地・採用型の区別は付け直す）
// - 書き換えるのは deck-columns.json の deckName・title・description・highlight と、ページ（src/pages/columns/{slug}.astro）のデッキ名の表記。
//   付け足しつきの名前（「ドラパルトex（ヨノワール採用型）」）は、ほかの記事のページ・紹介文・コラム（src/content/blog）に出てきても置き換える。
//   「〇〇デッキ」の形は、その記事自身のページ・紹介文だけで置き換える（カード名と同じデッキ名の「ヤドキング」などを、カード名としての表記まで変えないため）
// - 同じ日・同じ大会の種類・同じ名前の記事は、タイトルの【】に都道府県（同じなら店舗名）を付けて区別する。店舗のデータがない記事（ジムバトルなど）は、
//   レシピの違いからタイトルのデッキ名のあとに「（〇〇採用型）」を付ける（scripts/lib/title-place.js。デッキ名そのものには付けない）
// - X投稿文は deckName と highlight から作るため、ここで直した名前がそのまま使われる
// URL（slug）は変えない（公開済みの記事の URL を保つため）。URL を変える場合は astro.config.mjs の redirects に旧URL → 新URL を追加する

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseDeckName } from './lib/deck-variant.js';
import { memberNote, placeTitles } from './lib/title-place.js';
import { matchDeckNameRule } from './lib/deck-name-rules.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const COLUMNS_PATH = path('src/data/deck-columns.json');
const DECKS_PATH = path('src/data/official-decks.json');
const PAGES_DIR = path('src/pages/columns/');
const BLOG_DIR = path('src/content/blog/');

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
const replaceAll = (text, from, to) => (from && from !== to ? text.split(from).join(to) : text);

/**
 * その記事自身の文章のデッキ名を置き換える（付け足しつきの名前 → 「〇〇デッキ」→ 括弧つきのアーキタイプ名の順）。
 * 付け足しのない名前（「おまつりおんど」「ヤドキング」）は特性名・カード名と同じ文字なので、「〇〇デッキ」の形だけを置き換える
 */
function renameOwnText(text, before, after) {
  let out = renameOtherText(text, before, after);
  out = replaceAll(out, `${before.base}デッキ`, `${after.deckName}デッキ`);
  // 「カミッチュ（おまつりおんど）」のようにカード名ではない呼び名は、どこに出てきても置き換える
  if (/[（(]/.test(before.base)) out = replaceAll(out, before.base, after.deckName);
  return out;
}
/** ほかの記事・コラムの文章に出てくる、付け足しつきの名前だけを置き換える */
const renameOtherText = (text, before, after) => (before.deckName !== before.base ? replaceAll(text, before.deckName, after.deckName) : text);

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const reportPath = process.argv.find((a) => a.startsWith('--report='))?.split('=')[1];
  const columns = JSON.parse(await readFile(COLUMNS_PATH, 'utf8'));
  const recipes = JSON.parse(await readFile(DECKS_PATH, 'utf8'));
  const recipeOf = (c) => recipes[c.deckKey]?.cards ?? recipes[c.slug]?.cards ?? null;

  const uncertain = [];
  const conflicts = [];
  const ruled = []; // 通称ルールに当てはまった記事（もともとルールの名前だったものも含む）
  const changes = [];
  for (const c of columns) {
    if (c.deckNameBy === 'manual') continue; // 人が手で付けたデッキ名（通称ルールの名前にも戻さない）
    const recipe = recipeOf(c);
    const base = baseDeckName(c.deckName);
    const hit = recipe && matchDeckNameRule(recipe);
    if (hit?.conflict) conflicts.push({ c, names: hit.rules.map((r) => r.name) });
    else if (hit?.uncertain) uncertain.push({ c, name: hit.name });
    const name = hit && !hit.uncertain ? hit.name : base;
    if (hit && !hit.uncertain) ruled.push({ c, name, rule: hit.rule, before: c.deckName });
    if (name !== c.deckName) changes.push({ c, before: { deckName: c.deckName, base }, after: { deckName: name }, byRule: norm(name) !== norm(base) });
  }

  // 同じ日・同じ名前の記事（付け足しを外した結果、一覧で同じ名前が並ぶもの）は、タイトルの【】に都道府県（同じなら店舗名）を付けて区別する。
  // 名前を変えたあとの記事で判定する（scripts/lib/title-place.js）
  const projected = columns.map((c) => {
    const x = changes.find((ch) => ch.c === c);
    return x ? { ...c, deckName: x.after.deckName, title: renameOwnText(c.title, x.before, x.after) } : c;
  });
  const place = placeTitles(projected, recipeOf);

  const url = (c) => `\`/columns/${c.slug}/\``;
  const report = [
    `### 名前が変わる記事（${changes.length}件）`,
    ...(changes.length ? changes.map(({ c, before, after, byRule }) => `- ${url(c)} ${before.deckName} → **${after.deckName}**${byRule ? '（通称ルール）' : ''}`) : ['- なし']),
    '',
    `### 同じ日・同じ名前の記事（${place.groups.length}組）`,
    ...(place.groups.length
      ? place.groups.map((g) => `- ${g.deckName}（${g.day}）: ${g.columns.map((t) => `${url(t.c)}（${memberNote(t)}）`).join('・')}`)
      : ['- なし']),
    '',
    `### タイトルを変えた記事（開催地・採用型を付けた／外した。新しく付けた採用型は titleLabel に保存）（${place.titles.size}件）`,
    ...(place.titles.size ? [...place.titles].map(([slug, title]) => `- \`/columns/${slug}/\` → ${title}`) : ['- なし']),
    '',
    `### 新しく保存する採用型（deck-columns.json の titleLabel。titleLabelBy: 'auto'）（${place.newLabels.size}件）`,
    ...(place.newLabels.size ? [...place.newLabels].map(([slug, label]) => `- \`/columns/${slug}/\` → ${label}`) : ['- なし']),
    '',
    `### ⚠ タイトルで区別できない記事（店舗のデータもレシピもない）（${place.unresolved.length}組）`,
    ...(place.unresolved.length ? place.unresolved.map((g) => `- ${g.deckName}（${g.day}）: ${g.columns.map(url).join('・')}`) : ['- なし']),
    '',
    `### 通称ルールに当てはまった記事（${ruled.length}件）`,
    ...(ruled.length ? ruled.map(({ c, name, rule, before }) => `- ${url(c)} **${name}**（${rule.note ?? ''}。変更前: ${before}）`) : ['- なし']),
    '',
    `### ⚠ 2つ以上の通称ルールに当てはまる記事（名前はルールの名前にしていません）（${conflicts.length}件）`,
    ...(conflicts.length ? conflicts.map(({ c, names }) => `- ${url(c)} ${c.deckName}（「${names.join('」「')}」の両方に当てはまる）`) : ['- なし']),
    '',
    `### ⚠ 通称ルールに当てはまるか迷う記事（カードが少ないため名前はルールの名前にしていません）（${uncertain.length}件）`,
    ...(uncertain.length ? uncertain.map(({ c, name }) => `- ${url(c)} ${c.deckName}（「${name}」のカードが少ない）`) : ['- なし']),
    '',
  ].join('\n');
  console.log(report);
  if (reportPath) {
    mkdirSync(dirname(path(reportPath)), { recursive: true });
    await writeFile(path(reportPath), `${report}\n`, 'utf8');
  }
  if (dryRun) return console.log('（dry-run: 何も保存しません）');

  // ページ・コラムの文章（ほかの記事への言及も直すため、すべて読み込んでから置き換える）
  const files = [
    ...readdirSync(PAGES_DIR).filter((f) => f.endsWith('.astro')).map((f) => `${PAGES_DIR}${f}`),
    ...(existsSync(BLOG_DIR) ? readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')).map((f) => `${BLOG_DIR}${f}`) : []),
  ];
  const texts = new Map(await Promise.all(files.map(async (f) => [f, await readFile(f, 'utf8')])));
  // 長い名前から置き換える（「ドラパルトex（ノココッチex採用型）」の途中が、ほかの名前の置き換えで崩れないように）
  const ordered = [...changes].sort((a, b) => b.before.deckName.length - a.before.deckName.length);
  for (const { c, before, after } of ordered) {
    const own = `${PAGES_DIR}${c.slug}.astro`;
    for (const [f, text] of texts) texts.set(f, f === own ? renameOwnText(text, before, after) : renameOtherText(text, before, after));
    for (const o of columns) {
      for (const key of ['title', 'description', 'highlight']) {
        if (typeof o[key] !== 'string') continue;
        o[key] = o === c ? renameOwnText(o[key], before, after) : renameOtherText(o[key], before, after);
      }
    }
    c.deckName = after.deckName;
  }
  for (const c of columns) {
    if (place.titles.has(c.slug)) c.title = place.titles.get(c.slug);
    // 新しくルールで付けた採用型を保存する（保存済み・手で書いた採用型は付け直さない）
    if (place.newLabels.has(c.slug)) Object.assign(c, { titleLabel: place.newLabels.get(c.slug), titleLabelBy: 'auto' });
  }
  for (const [f, text] of texts) if (text !== (await readFile(f, 'utf8'))) await writeFile(f, text, 'utf8');
  await writeFile(COLUMNS_PATH, `${JSON.stringify(columns, null, 2)}\n`, 'utf8');
  console.log(`${changes.length}件を書き換えました（src/data/deck-columns.json・src/pages/columns/*.astro・src/content/blog/*.md）。本文の表記は git diff で確認してください`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
