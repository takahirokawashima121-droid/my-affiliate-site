// ポケカブックのデッキレシピRSSから新着の「ジムバトル優勝デッキまとめ」を検知し、
// 優勝デッキのカードを cards.json に追加して、デッキ解説コラム（src/pages/columns/*.astro）を自動生成する
//
// 使い方:
//   npm run auto-decks                     新着を処理（カード追加・価格取得・記事生成）
//   npm run auto-decks -- --dry-run        新着と生成予定を表示するだけ（何も保存しない）
//   npm run auto-decks -- --init           いまRSSにある記事を「処理済み」にするだけ（導入時・過去分を生成しない）
//   npm run auto-decks -- --max-columns=4  1回に生成する記事数の上限（既定 4）
//
// 仕組み:
// 1. RSS（https://pokecabook.com/archives/category/deck-recipe/feed）から「ジムバトル優勝デッキまとめ」の記事を取り出す。
//    まとめ記事は同じURLのまま毎日タイトル（日付）が更新されるため、処理済みの判定は「URL＋タイトル」と、デッキコードで行う
//    （scripts/cache/processed-decks.json）
// 2. 記事ページの見出し（h2 = デッキ名）ごとに、ポケモン公式のデッキURL（deckID）を取り出す
// 3. 既存の記事がないデッキ名を優先して最大 --max-columns 件を選び、import-official-decks.js で取り込む
//    （現行スタンダードの版がないカードを含む・60枚でないデッキは飛ばす。未登録カードは最低レアリティで追加し価格を取得）
// 4. src/data/deck-columns.json に記事情報を追記し、src/pages/columns/{slug}.astro を生成する。
//    本文は公式のカードテキストから作る「デッキの構成」「主力カードの効果」と、最安値つき60枚レシピ・代替案の枠。
//    回し方・カスタマイズ案は自動では書かないため、Pull Request で追記してから公開する
// 5. Pull Request の本文（.cache/auto-deck-pr.md）を書き出す（GitHub Actions の auto-deck-sync.yml が使う）
//
// マナー: ポケカブック・公式サイトへのリクエストは1.5秒以上あける（scripts/lib/official.js）

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { cardEffects, deckCards, fetchText, norm, romaji } from './lib/official.js';
import { importDecks } from './import-official-decks.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const FEED_URL = 'https://pokecabook.com/archives/category/deck-recipe/feed';
/** 対象にする記事（デッキタイプ別のまとめ記事は過去の環境のデッキを含むため対象外） */
const TARGET_TITLE = /ジムバトル優勝デッキまとめ/;
const PROCESSED_PATH = path('scripts/cache/processed-decks.json');
const COLUMNS_PATH = path('src/data/deck-columns.json');
const DECKS_PATH = path('src/data/official-decks.json');
const CARDS_PATH = path('src/data/cards.json');
const PR_BODY_PATH = path('.cache/auto-deck-pr.md');
/** どのデッキにも入る汎用カード（主力パーツとして記事上部に出さない） */
const STAPLES = new Set([
  'ハイパーボール', 'ポケパッド', 'なかよしポフィン', '夜のタンカ', 'リーリエの決心', 'ボスの指令', 'ジャッジマン', 'ポケギア3.0',
  'ポケモンいれかえ', 'エネルギー回収', 'エネルギー転送', 'スペシャルレッドカード', 'ふしぎなアメ', 'キチキギスex', 'ニャースex',
  'ノコッチ', 'ノココッチ', 'シークレットボックス', 'ヒカリ', 'トウコ', 'ペパー',
]);

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    init: argv.includes('--init'),
    maxColumns: Number(argv.find((a) => a.startsWith('--max-columns='))?.split('=')[1] ?? 4),
  };
}

const readJson = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback);
const writeJson = async (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};
const articleKey = (item) => `${item.link}#${item.title}`;
const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
/** Astro のテンプレートに埋め込む文字列（{ } < > & をエスケープ） */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/{/g, '&#123;').replace(/}/g, '&#125;');

/** RSS の記事一覧 */
async function feedItems() {
  const $ = cheerio.load(await fetchText(FEED_URL), { xmlMode: true });
  return $('item')
    .map((_, it) => ({ title: $(it).find('title').first().text().trim(), link: $(it).find('link').first().text().trim(), pubDate: $(it).find('pubDate').text().trim() }))
    .get();
}

/** 記事ページから、見出し（デッキ名）ごとの公式デッキコードを取り出す */
async function articleDecks(url) {
  const $ = cheerio.load(await fetchText(url));
  const decks = [];
  let archetype = null;
  $('.entry-content').children().each((_, el) => {
    if (el.tagName === 'h2') archetype = $(el).text().trim();
    $(el).find('a[href*="deckID/"]').addBack('a[href*="deckID/"]').each((_, a) => {
      const deckId = $(a).attr('href').match(/https:\/\/www\.pokemon-card\.com\/deck\/(?:result|confirm)\.html\/deckID\/([A-Za-z0-9-]+)/)?.[1];
      const date = ($(a).text() + $(el).text()).match(/(\d{1,2}\/\d{1,2})/)?.[1];
      if (deckId && archetype && !decks.some((d) => d.deckId === deckId)) decks.push({ deckId, archetype, date });
    });
  });
  return decks;
}

/** 記事の主役（デッキ名と同じ名前、なければデッキ名に含まれる名前のポケモン）の公式画像から slug を作る */
function makeSlug(archetype, list, date, taken) {
  const pokemon = list.filter((c) => c.category === 'ポケモン');
  const main = pokemon.find((c) => norm(c.name) === norm(archetype)) ?? pokemon.find((c) => norm(archetype).includes(norm(c.name))) ?? pokemon[0];
  const [m, d] = (date ?? '').split('/').map((n) => n.padStart(2, '0'));
  const base = `${main ? romaji(main.thumb) : 'deck'}-deck${m && d ? `-${m}${d}` : ''}`;
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

/** 主力パーツ: ex・メガシンカなどのポケモン（枚数の多い順）と、汎用カード以外のトレーナーズ */
function pickKeyCards(recipe) {
  const priced = recipe.filter((e) => e.cardId && !STAPLES.has(e.name));
  const pokemon = priced.filter((e) => e.category === 'ポケモン').sort((a, b) => Number(/ex$/.test(b.name)) - Number(/ex$/.test(a.name)) || b.qty - a.qty);
  const trainers = priced.filter((e) => e.category !== 'ポケモン').sort((a, b) => b.qty - a.qty);
  const picked = [...pokemon.slice(0, 4), ...trainers].slice(0, 6);
  return [...new Set(picked.map((e) => e.name))];
}

async function renderPage(column, recipe) {
  const count = (cat) => recipe.filter((e) => e.category === cat).reduce((s, e) => s + e.qty, 0);
  const composition = ['ポケモン', 'グッズ', 'ポケモンのどうぐ', 'サポート', 'スタジアム', 'エネルギー'].map((cat) => [cat, count(cat)]).filter(([, n]) => n > 0);
  const effectBlocks = [];
  for (const name of column.keyCards) {
    const entry = recipe.find((e) => e.name === name && e.cardId);
    const effects = (await cardEffects(entry.officialCardId)).filter((e) => e.text || e.damage);
    if (effects.length === 0) continue;
    const items = effects.map((e) => {
      const head = e.name ? `${e.kind}「${e.name}」` : e.kind;
      const cost = e.cost ? `（${e.cost}${e.damage ? `・${e.damage}` : ''}）` : e.damage ? `（${e.damage}）` : '';
      return `      <li><strong>${esc(head)}</strong>${esc(cost)}${e.text ? `：${esc(e.text).replace(/\n/g, '')}` : ''}</li>`;
    });
    effectBlocks.push(`  <h3><CardLink id="${entry.cardId}" />（${entry.qty}枚）</h3>\n  <ul>\n${items.join('\n')}\n  </ul>`);
  }
  return `---
// このページは scripts/auto-deck-updater.js が ${column.pubDate} に自動生成しました（出典: 公式デッキコード）。
// 公開前に「回し方」と「代替カード・カスタマイズ案」を追記してください（TODO の箇所）。
import DeckColumn from '../../layouts/DeckColumn.astro';
import CardLink from '../../components/CardLink.astro';
---

<DeckColumn slug="${column.slug}">
  <p>
    ${esc(column.result)}の<strong>${esc(column.deckName)}デッキ</strong>を、公式のデッキコードから60枚そのまま紹介します。採用カードの効果と、同じ効果で最もレアリティの低い版の最安値をまとめました。記事の下に、採用カード全種の最安値つきレシピ表を掲載しています。
  </p>

  <h2>デッキの構成</h2>
  <p>${composition.map(([cat, n]) => `${cat} ${n}枚`).join('・')}（合計60枚）。</p>

  <h2>主力カードの効果</h2>
  <p>効果は公式のカードテキストから引用しています。カード名をタップすると、そのカードの最安値・買取相場ページへ移動します。</p>
${effectBlocks.join('\n\n')}

  {/* TODO: 回し方（序盤・中盤・終盤）を追記する */}

  <Fragment slot="custom">
    <h3>予算を抑えるなら：同じ効果の安い版を選ぶ</h3>
    <p>
      レシピ表のカードは、すべて<strong>効果が同じ版の中で最もレアリティの低い版</strong>にリンクしています。SAR などの高レアリティ版と効果は同じなので、対戦用にはこの版で十分です。価格の高いカードは、楽天市場・Yahoo!ショッピングの両方の価格を確認してから購入しましょう。
    </p>
    {/* TODO: 代替カード・カスタマイズ案を追記する */}
  </Fragment>
</DeckColumn>
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const processed = await readJson(PROCESSED_PATH, { articles: [], decks: [] });
  const doneArticles = new Set(processed.articles.map((a) => a.key));
  const doneDecks = new Set(processed.decks);

  const items = (await feedItems()).filter((it) => TARGET_TITLE.test(it.title));
  const fresh = items.filter((it) => !doneArticles.has(articleKey(it)));
  console.log(`■ RSS: 対象記事 ${items.length}件 / 未処理 ${fresh.length}件`);
  for (const it of fresh) console.log(`  - ${it.title}（${it.link}）`);

  // 導入時: いまある記事を処理済みにするだけ
  if (opts.init) {
    for (const it of fresh) {
      const decks = await articleDecks(it.link);
      processed.articles.push({ key: articleKey(it), link: it.link, title: it.title, processedAt: todayJst(), decks: decks.map((d) => d.deckId), columns: [] });
      for (const d of decks) doneDecks.add(d.deckId);
    }
    processed.decks = [...doneDecks];
    if (!opts.dryRun) await writeJson(PROCESSED_PATH, processed);
    return console.log(`\n${fresh.length}件を処理済みにしました（記事は生成していません）`);
  }
  if (fresh.length === 0) return console.log('新着はありません。');

  // 記事ごとのデッキを集め、既存の記事がないデッキ名を優先して選ぶ
  const columns = await readJson(COLUMNS_PATH, []);
  const existingNames = new Set(columns.map((c) => norm(c.deckName)));
  const candidates = [];
  for (const it of fresh) {
    const decks = (await articleDecks(it.link)).filter((d) => !doneDecks.has(d.deckId));
    console.log(`\n■ ${it.title}: 新しいデッキ ${decks.length}件`);
    for (const d of decks) candidates.push({ ...d, article: it });
  }
  const seenNames = new Set();
  const selected = candidates
    .filter((d) => (seenNames.has(norm(d.archetype)) ? false : seenNames.add(norm(d.archetype))))
    .sort((a, b) => Number(existingNames.has(norm(a.archetype))) - Number(existingNames.has(norm(b.archetype))))
    .slice(0, opts.maxColumns);
  console.log(`\n■ 記事を生成するデッキ（最大 ${opts.maxColumns}件）`);
  const taken = new Set(columns.map((c) => c.slug));
  for (const d of selected) {
    d.list = await deckCards(d.deckId);
    d.slug = makeSlug(d.archetype, d.list, d.date, taken);
    taken.add(d.slug);
    console.log(`  - ${d.archetype}（${d.date ?? '日付不明'}）→ /columns/${d.slug}/`);
  }
  if (opts.dryRun) return console.log('\n（dry-run: カード追加・記事生成・処理済みの記録は行いません）');

  // カードの取り込み（無効なデッキは飛ばす）
  const result = selected.length > 0 ? await importDecks(selected.map((d) => ({ slug: d.slug, deckId: d.deckId })), { skipInvalid: true }) : { decks: [], added: [] };
  const recipes = await readJson(DECKS_PATH, {});
  const cards = await readJson(CARDS_PATH, []);
  const generated = [];
  for (const d of selected.filter((x) => result.decks.includes(x.slug))) {
    const recipe = recipes[d.slug].cards;
    const keyCards = pickKeyCards(recipe);
    const label = `${d.date ?? ''} ジムバトル優勝`.trim();
    const column = {
      slug: d.slug,
      deckKey: d.slug,
      deckName: d.archetype,
      title: `【${label}】${d.archetype}デッキレシピ！採用カード最安値・代替パーツ提案`,
      description: `${d.date ? `${d.date}の` : ''}ジムバトルで優勝した${d.archetype}デッキの60枚レシピを、採用カードの最安値つきで紹介。主力カードの効果と、予算を抑える版の選び方をまとめています。`,
      result: label,
      pubDate: todayJst(),
      highlight: `${keyCards.slice(0, 2).join('・')}を採用した${d.archetype}デッキ。主力カードの効果と最安値をまとめて確認`,
      keyCards,
    };
    await writeFile(path(`src/pages/columns/${d.slug}.astro`), await renderPage(column, recipe), 'utf8');
    columns.push(column);
    generated.push(column);
    console.log(`  ✓ src/pages/columns/${d.slug}.astro`);
  }
  await writeJson(COLUMNS_PATH, columns);

  // 処理済みを記録（選ばなかったデッキ・無効だったデッキも記録し、次回は新しい記事のデッキだけを見る）
  for (const it of fresh) {
    const ids = candidates.filter((c) => c.article === it).map((c) => c.deckId);
    processed.articles.push({ key: articleKey(it), link: it.link, title: it.title, processedAt: todayJst(), decks: ids, columns: generated.filter((g) => selected.some((s) => s.slug === g.slug && s.article === it)).map((g) => g.slug) });
    for (const id of ids) doneDecks.add(id);
  }
  processed.decks = [...doneDecks];
  await writeJson(PROCESSED_PATH, processed);

  // Pull Request の本文
  const addedCards = result.added.map((id) => cards.find((c) => c.id === id)).filter(Boolean);
  const body = [
    '## 新着優勝デッキ記事の自動生成',
    '',
    `RSS（${FEED_URL}）の新着記事から自動生成しました。`,
    '',
    ...fresh.map((it) => `- 元記事: [${it.title}](${it.link})`),
    '',
    `### 生成した記事（${generated.length}本）`,
    ...(generated.length ? generated.map((c) => `- \`/columns/${c.slug}/\` ${c.title}`) : ['- なし']),
    '',
    `### 追加したカード（${addedCards.length}枚）`,
    ...(addedCards.length ? addedCards.map((c) => `- ${c.name} ${c.rarity} [${c.expansionCode} ${c.cardNumber}] ${c.regulationMark ?? ''}`) : ['- なし']),
    '',
    '### マージ前に確認すること',
    '- [ ] 各記事の TODO（回し方・代替カード / カスタマイズ案）を追記した',
    '- [ ] 追加したカードの型番・レギュレーションマークに誤りがない',
    '- [ ] トップページの特集（src/data/deck-columns.ts の FEATURED_DECKS）を更新するか決めた',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');
  mkdirSync(path('.cache/'), { recursive: true });
  await writeFile(PR_BODY_PATH, `${body}\n`, 'utf8');
  console.log(`\n記事 ${generated.length}本・カード ${addedCards.length}枚。PR本文: .cache/auto-deck-pr.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
