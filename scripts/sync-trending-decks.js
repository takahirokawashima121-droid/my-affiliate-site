// ポケカブックのデッキレシピ一覧から直近のデッキを集計し、採用の多い未登録カードを cards.json に追加する
//
// 使い方:
//   npm run sync-trending                        集計 → シード作成 → add-cards → update-prices まで実行
//   npm run sync-trending -- --dry-run           集計結果（ランキング・追加候補）を表示するだけ（シードも保存しない）
//   npm run sync-trending -- --pages=3           一覧の何ページ目まで読むか（既定 2）
//   npm run sync-trending -- --max-decks=200     集計するデッキ数の上限（新しい順。既定 200）
//   npm run sync-trending -- --top=15            優先デッキ以外で追加する未登録カードの上限（既定 15）
//   npm run sync-trending -- --min-decks=3       追加候補にする最低採用デッキ数（既定 3）
//
// 仕組み:
// 1. https://pokecabook.com/archives/category/deck-recipe の一覧から記事を集め、本文にあるポケモン公式の
//    デッキコード（pokemon-card.com/deck/…/deckID/xxx）を新しい記事順に取り出す
// 2. 公式のデッキページからカード（公式カードID・名前・枚数）を読み取り、カード名ごとに採用デッキ数を集計する
//    デッキを新しい半分・古い半分に分け、採用率の伸び（急上昇度）も出す
// 3. 未登録カードについて、公式カード検索の「スタンダード」絞り込みで現行スタンダードの版だけを取得する
//    （G以前の版はここで除外される）。デッキで使われた版と効果テキストが同じ版のうち、最低レアリティの版を選ぶ
// 4. scripts/seed/trending-cards.json を書き出し、add-cards（楽天の出品で型番を確認）→ update-prices の順に実行する
//
// マナー: 同じサイトへのリクエストは1秒以上あけ、デッキページ・カード詳細は .cache/ に保存して再取得しない（scripts/lib/official.js）

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { deckCards, fetchText, norm, samePrintings, seedFromPrintings } from './lib/official.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const CARDS_PATH = path('src/data/cards.json');
const SEED = 'scripts/seed/trending-cards.json';

const LIST_URL = 'https://pokecabook.com/archives/category/deck-recipe';

/** 記事タイトルにこの語を含むデッキのパーツは、採用数に関係なく追加候補にする（直近の話題デッキ） */
const PRIORITY_DECKS = ['ぷにぷにサークル', 'メガミミロップ'];
/** 価格比較の対象にしないカード（基本エネルギー） */
const SKIP_NAME = /^基本.+エネルギー$/;

function parseArgs(argv) {
  const get = (name, def) => Number(argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def);
  return {
    pages: get('pages', 2),
    maxDecks: get('max-decks', 200),
    top: get('top', 15),
    minDecks: get('min-decks', 3),
    dryRun: argv.includes('--dry-run'),
  };
}

// ---- 1. ポケカブック: 記事一覧 → デッキコード ----

async function listArticles(pages) {
  const urls = [];
  for (let page = 1; page <= pages; page++) {
    const html = await fetchText(page === 1 ? LIST_URL : `${LIST_URL}/page/${page}`);
    const $ = cheerio.load(html);
    // 本文の記事カードだけ（サイドバーの新着ウィジェットは除く）
    $('a.entry-card-wrap').each((_, a) => {
      const href = $(a).attr('href');
      if (href && !urls.includes(href)) urls.push(href);
    });
  }
  return urls;
}

/**
 * 記事内のデッキコードを、環境（「30th CELEBRATION環境」など）・デッキタイプと一緒に取り出す。
 * デッキタイプ別のまとめ記事は過去の環境・「レギュレーション変更前」のデッキも載せているため、
 * 見出し（h2「〇〇環境」）や「レギュレーション変更前」の表記で各デッキの環境を判定する
 */
async function articleDecks(url) {
  const $ = cheerio.load(await fetchText(url));
  const title = $('h1.entry-title').first().text().trim();
  const titleEnv = title.match(/【([^】]*環境)】/)?.[1] ?? null;
  const titleArchetype = title.match(/【([^】]+)】/)?.[1] ?? title;
  let env = titleEnv;
  let section = null; // 日付別まとめ記事の h2（デッキタイプ名）
  const decks = [];
  $('.entry-content').children().each((_, el) => {
    const text = $(el).text().trim();
    if (/^h[2-4]$/.test(el.tagName) && /環境$/.test(text)) env = text;
    else if (el.tagName === 'h2') section = text;
    if (/レギュレーション変更前/.test(text)) env = 'レギュレーション変更前';
    $(el).find('a[href*="deckID/"]').addBack('a[href*="deckID/"]').each((_, a) => {
      const id = $(a).attr('href').match(/deckID\/([A-Za-z0-9-]+)/)?.[1];
      if (id && !decks.some((d) => d.id === id)) decks.push({ id, env, archetype: titleEnv ? section ?? titleArchetype : titleArchetype });
    });
  });
  return { url, title, decks };
}

/** デッキで使われた版と効果が同じ、現行スタンダードの最低レアリティの版を選ぶ */
async function resolvePrinting(entry) {
  const usedIds = [...entry.printings.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const { any, same } = await samePrintings(entry.name, usedIds);
  if (!any) return { skip: '現行スタンダードの版なし（G以前のみ）' };
  return seedFromPrintings(entry.name, same, { deck: entry.topArchetype, role: `採用 ${entry.decks}デッキ` });
}

// ---- 集計・実行 ----

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
  const registered = new Set(cards.map((c) => norm(c.name)));

  console.log(`■ ポケカブックの記事一覧（${opts.pages}ページ）`);
  const allDecks = new Map(); // デッキコード → { env, archetype }（新しい記事順。同じデッキコードは最初の記事のものを使う）
  for (const url of await listArticles(opts.pages)) {
    const a = await articleDecks(url);
    console.log(`  ${a.decks.length.toString().padStart(3)}デッキ  ${a.title}`);
    for (const d of a.decks) if (!allDecks.has(d.id)) allDecks.set(d.id, d);
  }

  // 環境は新しい記事から順に現れるので、最初に出てきた環境を「現環境」、次を「前環境」とする
  const envs = [...new Set([...allDecks.values()].map((d) => d.env))].filter((e) => e && e !== 'レギュレーション変更前');
  const [currentEnv, previousEnv] = envs;
  if (!currentEnv) throw new Error('記事から環境（「〇〇環境」の見出し）を判定できませんでした');
  const pick = (env) => [...allDecks.entries()].filter(([, d]) => d.env === env).slice(0, opts.maxDecks);
  const current = pick(currentEnv);
  const previous = previousEnv ? pick(previousEnv) : [];
  console.log(`\n■ 公式デッキページを読み込み（現環境「${currentEnv}」${current.length}デッキ${previousEnv ? ` / 前環境「${previousEnv}」${previous.length}デッキ` : ''}）`);

  const stats = new Map(); // 正規化名 → 集計
  const loaded = { current: 0, previous: 0 };
  for (const [period, decks] of [['current', current], ['previous', previous]]) {
    for (const [id, deck] of decks) {
      let list;
      try { list = await deckCards(id); } catch (e) { console.log(`  ✗ ${id}: ${e.message}`); continue; }
      if (list.length === 0) continue;
      loaded[period]++;
      const seen = new Set();
      for (const c of list) {
        const key = norm(c.name);
        const s = stats.get(key) ?? { name: c.name, current: 0, previous: 0, printings: new Map(), archetypes: new Map() };
        if (seen.has(key)) continue;
        seen.add(key);
        s[period]++;
        if (period === 'current') {
          s.printings.set(c.cardId, (s.printings.get(c.cardId) ?? 0) + 1);
          s.archetypes.set(deck.archetype, (s.archetypes.get(deck.archetype) ?? 0) + 1);
        }
        stats.set(key, s);
      }
    }
  }
  const recentN = loaded.current || 1;
  const olderN = loaded.previous || 1;
  const ranking = [...stats.values()]
    .filter((s) => s.current > 0)
    .map((s) => ({
      ...s,
      decks: s.current,
      rate: s.current / recentN,
      // 前環境のデッキがなければ伸びは計算しない
      trend: loaded.previous ? s.current / recentN - s.previous / olderN : 0,
      topArchetype: [...s.archetypes.entries()].sort((a, b) => b[1] - a[1])[0][0],
      priority: PRIORITY_DECKS.some((k) => [...s.archetypes.keys()].some((a) => a.includes(k))),
      registered: registered.has(norm(s.name)),
    }))
    .sort((a, b) => b.decks - a.decks || b.trend - a.trend);

  const pct = (x) => `${Math.round(x * 100)}%`;
  const sign = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}pt`;
  console.log(`\n■ 採用ランキング（現環境 ${loaded.current}デッキ中。急上昇 = 前環境 ${loaded.previous}デッキからの採用率の伸び）`);
  for (const [i, s] of ranking.slice(0, 30).entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${s.name.padEnd(16, '　')} ${String(s.decks).padStart(3)}デッキ（${pct(s.rate)}） 急上昇 ${sign(s.trend).padStart(6)}  ${s.registered ? '登録済み' : '未登録'}`);
  }
  console.log('\n■ 急上昇（採用率の伸びが大きい順）');
  for (const s of [...ranking].filter((s) => s.decks >= opts.minDecks).sort((a, b) => b.trend - a.trend).slice(0, 10)) {
    console.log(`  ${s.name.padEnd(16, '　')} ${sign(s.trend).padStart(6)}（${s.current}/${recentN} ← ${s.previous}/${olderN}） ${s.registered ? '登録済み' : '未登録'}`);
  }
  for (const k of PRIORITY_DECKS) {
    const parts = ranking.filter((s) => [...s.archetypes.keys()].some((a) => a.includes(k)) && !SKIP_NAME.test(s.name));
    const missing = parts.filter((s) => !s.registered).map((s) => s.name);
    console.log(`\n■ 優先デッキ「${k}」: パーツ ${parts.length}種 / 未登録 ${missing.length}種${missing.length ? `（${missing.join('、')}）` : ''}`);
  }

  // 追加候補: 優先デッキの未登録パーツすべて ＋ 採用の多い未登録カード上位
  const unregistered = ranking.filter((s) => !s.registered && !SKIP_NAME.test(s.name));
  const targets = [
    ...unregistered.filter((s) => s.priority),
    ...unregistered.filter((s) => !s.priority && s.decks >= opts.minDecks).slice(0, opts.top),
  ];
  console.log(`\n■ 追加候補 ${targets.length}枚の版を公式カード検索（スタンダード）で確認`);
  const seeds = [];
  for (const t of targets) {
    try {
      const r = await resolvePrinting(t);
      if (r.skip) { console.log(`  - ${t.name}: ${r.skip} → 対象外`); continue; }
      const s = r.seed;
      if (seeds.some((x) => x.id === s.id || (x.expansionCode === s.expansionCode && x.cardNumber === s.cardNumber))) continue;
      seeds.push(s);
      console.log(`  ✓ ${s.name} ${s.rarity} [${s.expansionCode} ${s.cardNumber}] ${s.regulationMark}${t.priority ? '（優先デッキ）' : ''} 採用${t.decks}デッキ`);
    } catch (e) {
      console.log(`  ✗ ${t.name}: ${e.message}`);
    }
  }

  if (opts.dryRun) return console.log('\n（dry-run: シードの保存・カード追加は行いません）');
  if (seeds.length === 0) return console.log('\n追加する候補はありません。');

  const seedBody = {
    _comment: [
      `npm run sync-trending が ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}（JST）に自動生成。`,
      `出典: ${LIST_URL}（${opts.pages}ページ、現環境「${currentEnv}」${loaded.current}デッキ）の公式デッキコードを集計。版は公式カード検索のスタンダード絞り込みで選択。`,
    ],
    cards: seeds,
  };
  await writeFile(path(SEED), `${JSON.stringify(seedBody, null, 2)}\n`, 'utf8');
  console.log(`\nシードを保存しました: ${SEED}\n\n■ add-cards（楽天の出品で型番を確認して追加）`);

  const before = new Set(cards.map((c) => c.id));
  const run = (args) => spawnSync(process.execPath, args, { cwd: path('.'), stdio: 'inherit' }).status;
  if (run(['scripts/add-cards.js', `--seed=${SEED}`]) !== 0) process.exit(1);
  const added = JSON.parse(await readFile(CARDS_PATH, 'utf8')).map((c) => c.id).filter((id) => !before.has(id));
  if (added.length === 0) return console.log('\n追加されたカードはありません。');
  console.log(`\n■ update-prices（${added.length}枚の価格・画像を取得）`);
  if (run(['scripts/update-prices.js', `--ids=${added.join(',')}`]) !== 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
