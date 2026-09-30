// 公開済みのデッキ記事の見どころ（deck-columns.json の highlight）を点検し、決まった文のままのものを書き直す
//
// 使い方:
//   npm run rewrite-highlights                 決まった文（scripts/lib/highlight.js の BANNED_PHRASES）の見どころを書き直す
//   npm run rewrite-highlights -- --dry-run    書き直す記事と、変更前 → 変更後を表示するだけ（何も保存しない）
//   npm run rewrite-highlights -- --check      点検だけ（決まった文・同じ日の記事の書き出しの似かよい）。結果は .cache/highlight-check.md
//
// 書き直しに使うのは、リポジトリにあるデータだけ（公式サイトにはアクセスしない・費用もかからない）:
//   - 記事ページ（src/pages/columns/{slug}.astro）の「主力カードの効果」（<KeyCardEffect>）に載っている公式のカードテキスト
//   - deck-columns.json の gamePlan（主役の進化ライン「〇〇を経由して」「起点となる〇〇」の読み取りに使う）
//   - src/data/official-decks.json の60枚レシピ・src/data/cards.json（カードID → カード名）
// 決まった文になっていない見どころ（手作業で書いたもの・すでに具体的なもの）と、highlightBy: 'manual'（人が手で直した印）の見どころは書き換えない。

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auditHighlights, bannedPhrases, chooseHighlights, highlightCandidates } from './lib/highlight.js';
import { buildXPosts } from '../src/utils/shareText.ts';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const COLUMNS_PATH = path('src/data/deck-columns.json');

const unescape = (s) =>
  s.replace(/&#123;/g, '{').replace(/&#125;/g, '}').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const COST = /^[草炎水雷超闘悪鋼竜無]+$|^(フェアリー)+$/;

/**
 * 記事ページの <KeyCardEffect id="…"> の効果の箇条書きを、公式のカードテキスト（scripts/lib/official.js の cardEffects と同じ形）に戻す。
 * 例: <li><strong>ワザ「やまどつき」</strong>（草草草・170）：相手の山札を上から2枚トラッシュする。</li>
 *   → { kind: 'ワザ', name: 'やまどつき', cost: '草草草', damage: '170', text: '相手の山札を上から2枚トラッシュする。' }
 * @returns Map<カード名, { effects }>
 */
export function effectsFromPage(source, nameOfId) {
  const profiles = new Map();
  for (const block of source.matchAll(/<KeyCardEffect id="([^"]+)"[^>]*>([\s\S]*?)<\/KeyCardEffect>/g)) {
    const name = nameOfId.get(block[1]);
    if (!name) continue;
    const effects = [];
    for (const li of block[2].matchAll(/<li><strong>(.+?)<\/strong>(?:（([^）]*)）)?(?:：(.*?))?<\/li>/g)) {
      const head = unescape(li[1]);
      const [, kind, effectName] = head.match(/^(.+?)(?:「(.+)」)?$/);
      const [a = '', b = ''] = (li[2] ? unescape(li[2]) : '').split('・');
      const [cost, damage] = COST.test(a) ? [a, b] : ['', a];
      effects.push({ kind, name: effectName ?? '', cost, damage, text: li[3] ? unescape(li[3]) : '' });
    }
    profiles.set(name, { effects });
  }
  return profiles;
}

/** gamePlan の文から主役の進化ライン（「[[カミッチュ]] を経由して」「起点となる [[カジッチュ]]（2枚）」）を読み取る */
export function lineFromGamePlan(gamePlan) {
  const text = [...(gamePlan?.early ?? []), ...(gamePlan?.mid ?? [])].join('\n');
  const names = new Set();
  for (const m of text.matchAll(/((?:\[\[[^\]]+\]\][^[。]*?)+) を経由して/g)) for (const n of m[1].matchAll(/\[\[([^\]]+)\]\]/g)) names.add(n[1]);
  for (const m of text.matchAll(/起点となる ((?:\[\[[^\]]+\]\][^[。]*?)+) を/g)) for (const n of m[1].matchAll(/\[\[([^\]]+)\]\]/g)) names.add(n[1]);
  return [...names];
}

/** 記事ごとの、見どころの材料（レシピ・カードテキスト・カード名） */
async function materials(column, recipes, nameOfId) {
  const file = path(`src/pages/columns/${column.slug}.astro`);
  const recipe = recipes[column.deckKey]?.cards ?? [];
  const profiles = existsSync(file) ? effectsFromPage(await readFile(file, 'utf8'), nameOfId) : new Map();
  const main = column.keyCards?.[0];
  if (main && profiles.has(main)) profiles.get(main).line = lineFromGamePlan(column.gamePlan);
  return { recipe, profiles, keyCards: column.keyCards ?? [], names: [...recipe.map((e) => e.name), ...(column.keyCards ?? [])] };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const checkOnly = argv.includes('--check');
  const columns = JSON.parse(await readFile(COLUMNS_PATH, 'utf8'));
  const recipes = JSON.parse(await readFile(path('src/data/official-decks.json'), 'utf8'));
  const cards = JSON.parse(await readFile(path('src/data/cards.json'), 'utf8'));
  const nameOfId = new Map(cards.map((c) => [c.id, c.name]));
  const mats = new Map();
  for (const c of columns) mats.set(c.slug, await materials(c, recipes, nameOfId));
  const xText = (c) => buildXPosts({ deckName: c.deckName, result: c.result, highlight: c.highlight, estimate: 0, url: '' }).parent;
  const auditItems = () => columns.map((c) => ({ slug: c.slug, pubDate: c.pubDate, highlight: c.highlight, names: mats.get(c.slug).names, xText: xText(c) }));

  const report = (title) => {
    const { banned, similar } = auditHighlights(auditItems());
    const lines = [`## ${title}`, '', `対象: ${columns.length}記事`, ''];
    lines.push(`### 決まった文が含まれる紹介文（${banned.length}件）`, ...(banned.length ? banned.map((b) => `- \`/columns/${b.slug}/\`（${b.where}）: ${b.labels.join('・')}`) : ['- なし']), '');
    lines.push(
      `### 同じ日の記事で書き出しがそっくりな組（${similar.length}組）`,
      ...(similar.length ? similar.map(([a, b, head]) => `- \`${a.slug}\` と \`${b.slug}\`（${a.pubDate}。書き出しの骨組み: 「${head}…」）`) : ['- なし']),
    );
    return lines.join('\n');
  };

  if (checkOnly) {
    const text = report('紹介文（見どころ）の点検');
    console.log(text);
    mkdirSync(path('.cache/'), { recursive: true });
    await writeFile(path('.cache/highlight-check.md'), `${text}\n`, 'utf8');
    return;
  }

  // 決まった文の記事を、公開日ごとに書き直す（同じ日の、書き直さない記事とも書き出しが重ならないようにする）
  const targets = columns.filter((c) => c.highlightBy !== 'manual' && bannedPhrases(c.highlight).length > 0);
  console.log(`■ 決まった文のままの見どころ: ${targets.length}件 / ${columns.length}記事`);
  const changes = [];
  const todo = [];
  for (const date of [...new Set(targets.map((c) => c.pubDate))]) {
    const group = targets.filter((c) => c.pubDate === date);
    const existing = columns
      .filter((c) => c.pubDate === date && !group.includes(c))
      .map((c) => ({ slug: c.slug, highlight: c.highlight, names: mats.get(c.slug).names }));
    const decks = group.map((c) => ({ slug: c.slug, names: mats.get(c.slug).names, candidates: highlightCandidates(mats.get(c.slug)) }));
    const chosen = chooseHighlights(decks, existing);
    for (const c of group) {
      const after = chosen.get(c.slug);
      if (!after) {
        todo.push(c);
        continue;
      }
      changes.push({ slug: c.slug, deckName: c.deckName, before: c.highlight, after });
      c.highlight = after;
      delete c.highlightBy; // 従来の方法で書き直した（AI の印は外す）
    }
  }
  for (const ch of changes) console.log(`\n- /columns/${ch.slug}/（${ch.deckName}）\n  変更前: ${ch.before}\n  変更後: ${ch.after}`);
  for (const c of todo) console.log(`\n- ⚠ /columns/${c.slug}/: カードテキストが足りず作れませんでした（TODO のまま）`);
  console.log(`\n${report('書き直し後の点検')}`);
  if (dryRun) return console.log('\n（dry-run: deck-columns.json は書き換えていません）');
  await writeFile(COLUMNS_PATH, `${JSON.stringify(columns, null, 2)}\n`, 'utf8');
  console.log(`\n${changes.length}件を書き直しました（src/data/deck-columns.json）`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
