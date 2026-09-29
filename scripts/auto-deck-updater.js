// ポケカブックのRSSから新着の「ジムバトル優勝デッキまとめ」「シティリーグ ベスト16デッキまとめ」を検知し、
// 入賞デッキのカードを cards.json に追加して、デッキ解説コラム（src/pages/columns/*.astro）を自動生成する
//
// 使い方:
//   npm run auto-decks                     ジムバトルの新着を処理（カード追加・価格取得・記事生成）
//   npm run auto-city                      シティリーグの新着を処理（= npm run auto-decks -- --source=city）
//   npm run auto-decks -- --dry-run        新着と生成予定を表示するだけ（何も保存しない）
//   npm run auto-decks -- --init           いまRSSにある記事を「処理済み」にするだけ（導入時・過去分を生成しない）
//   npm run auto-decks -- --max-columns=4  1回に生成する記事数の上限（既定 4）
//
// シティリーグ（--source=city）:
//   RSS（https://pokecabook.com/archives/category/tournament/city-league/feed）の新しい2記事から、会場（見出し）ごとの
//   「優勝・準優勝」の公式デッキコードを取り出し、最新の開催日から3日以内のデッキを 新しい日付 → 優勝 → 準優勝 の順に選ぶ
//   （選ばなかったデッキは処理済みにせず、次回以降に記事にする）。
//   デッキ名は画像の前の●付き小見出しがあればそれを正とし、なければレシピから推定する（メガシンカ ex → 既存の記事のデッキ名 → ex の順）。
//   推定したデッキ名は PR で確認・修正してからマージする。記事には eventType: 'city'・rank・eventName・venue・eventDate を付ける
//
// 仕組み:
// 1. RSS（https://pokecabook.com/archives/category/deck-recipe/feed）から「ジムバトル優勝デッキまとめ」の記事を取り出す。
//    まとめ記事は同じURLのまま毎日タイトル（日付）が更新されるため、処理済みの判定は「URL＋タイトル」と、デッキコードで行う
//    （scripts/cache/processed-decks.json）
// 2. 記事ページの●付き小見出し（「●スッカラカン」= デッキ名。ポケカブックの表記を正とする）ごとに、ポケモン公式のデッキURL（deckID）を取り出す
// 3. 既存の記事がないデッキ名を優先して最大 --max-columns 件を選び、import-official-decks.js で取り込む
//    （現行スタンダードの版がないカードを含む・60枚でないデッキは飛ばす。未登録カードは最低レアリティで追加し価格を取得）
// 4. src/data/deck-columns.json に記事情報を追記し、src/pages/columns/{slug}.astro を生成する。
//    本文は公式のカードテキストから作る「デッキの構成」「主力カードの効果」と、最安値つき60枚レシピ・代替案の枠。
//    序盤・中盤・終盤の立ち回り（gamePlan）は60枚の構成と公式のカードテキストから自動生成する（scripts/lib/game-plan.js）。
//    代替カード・カスタマイズ案は自動では書かないため、Pull Request で追記してから公開する
// 5. Pull Request の本文（.cache/auto-deck-pr.md）を書き出す（GitHub Actions の auto-deck-sync.yml が使う）
//
// マナー: ポケカブック・公式サイトへのリクエストは1.5秒以上あける（scripts/lib/official.js）

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardEffects, deckCards, norm, romaji } from './lib/official.js';
import { CITY_RANKS, FEEDS, articleDecks, cityArticleDecks, feedItems, isDeckName } from './lib/pokecabook.js';
import { importDecks } from './import-official-decks.js';
import { STAPLES, baseDeckName, variantLabel } from './lib/deck-variant.js';
import { deckEnglishName, englishName } from './lib/english-name.js';
import { buildXPosts, rawBestPrice } from '../src/utils/shareText.ts';
import { buildGamePlan, recipeProfiles } from './lib/game-plan.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
/** 取得元（デッキタイプ別のまとめ記事は過去の環境のデッキを含むため対象外） */
const SOURCES = {
  gym: { ...FEEDS.gym, label: 'ジムバトル', prBody: '.cache/auto-deck-pr.md' },
  city: { ...FEEDS.city, label: 'シティリーグ', prBody: '.cache/auto-city-pr.md' },
};
/** シティリーグで候補にする開催日の幅（最新の開催日から何日前まで）。これより古いデッキは記事にせず処理済みにする */
const CITY_WINDOW_DAYS = 3;
/** シティリーグで1回に見るまとめ記事の数（新しい順） */
const CITY_ARTICLES = 2;
/** ジムバトルで1回に見るまとめ記事の数の上限（新しい順。処理済みの記事に着いたらそこで止める） */
const GYM_ARTICLES = 3;
const PROCESSED_PATH = path('scripts/cache/processed-decks.json');
const COLUMNS_PATH = path('src/data/deck-columns.json');
const DECKS_PATH = path('src/data/official-decks.json');
const CARDS_PATH = path('src/data/cards.json');
const SITE_URL = 'https://www.pokeca-factory.com/';

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    init: argv.includes('--init'),
    maxColumns: Number(argv.find((a) => a.startsWith('--max-columns='))?.split('=')[1] ?? 4),
    source: argv.find((a) => a.startsWith('--source='))?.split('=')[1] === 'city' ? 'city' : 'gym',
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

/** 「9/27」→ 月日の比較用の数値（927） */
const dateKey = (date) => (date ? date.split('/').map(Number).reduce((m, d) => m * 100 + d) : 0);

/**
 * レシピからデッキ名を推定する（シティリーグのまとめ記事はデッキ名を文字で載せていないため）。
 * メガシンカ ex > 既存の記事のデッキ名と同じポケモン（2枚以上）> ex > それ以外、同じなら枚数の多い順。汎用のポケモン（STAPLES）は選ばない。
 * knownArchetypes は「ポケモン名 → 既存記事のデッキ名」（「カミッチュ」→「カミッチュ（おまつりおんど）」）。
 * 既存記事のポケモンが選ばれたら、そのデッキ名（アーキタイプ名）を返す
 * （進化前の「カジッチュ」がデッキ名になり、正しくは「カミッチュ（おまつりおんど）」だったため）
 */
function inferArchetype(list, knownArchetypes) {
  const counts = new Map();
  for (const c of list.filter((c) => c.category === 'ポケモン')) counts.set(c.name, (counts.get(c.name) ?? 0) + c.count);
  // 既存のデッキ名の加点は2枚以上のときだけ（1枚だけのミュウex などの技枠が、メガシンカ ex より優先されないように）
  const score = (name) =>
    (counts.get(name) >= 2 && knownArchetypes.has(norm(name)) ? 150 : 0) +
    (/^メガ.+ex$/.test(name) ? 300 : /ex$/.test(name) ? 100 : 0) -
    (STAPLES.has(name) ? 500 : 0) +
    counts.get(name);
  const best = [...counts.keys()].sort((a, b) => score(b) - score(a))[0];
  return best ? (knownArchetypes.get(norm(best)) ?? best) : 'デッキ';
}

/**
 * デッキ名の英語表記から slug を作る（例: tauros-deck-0928・bomb-talonflame-deck-0928・dipplin-festival-lead-deck-0927）。
 * 同名デッキと区別するカード（variant）がポケモンなら、その英語名も付ける（例: dragapult-ex-deck-0927-moltres）。
 * デッキ名を英語にできないときは主役のポケモン（デッキ名と同じ名前・デッキ名に含まれる名前のポケモン）の英語名を使い approx: true、
 * それもないときだけ公式画像のローマ字を使い fallback: true を返す（どちらも PR で人が確認する）
 */
function makeSlug(archetype, list, date, taken, variant) {
  const pokemon = list.filter((c) => c.category === 'ポケモン');
  const main = pokemon.find((c) => norm(c.name) === norm(archetype)) ?? pokemon.find((c) => norm(archetype).includes(norm(c.name))) ?? pokemon[0];
  const deckEn = deckEnglishName(archetype);
  const mainEn = deckEn ?? (main && englishName(main.name));
  const [m, d] = (date ?? '').split('/').map((n) => n.padStart(2, '0'));
  const variantEn = variant?.card ? englishName(variant.card) : null;
  const head = mainEn ?? (main ? romaji(main.thumb) : 'deck');
  const base = `${head}-deck${m && d ? `-${m}${d}` : ''}${variantEn ? `-${variantEn}` : ''}`;
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return { slug, fallback: !mainEn, approx: !deckEn && Boolean(mainEn) };
}

/** 主力パーツ: デッキ名のポケモン、ex・メガシンカなどのポケモン（枚数の多い順）、汎用カード以外のトレーナーズの順 */
function pickKeyCards(recipe, archetype) {
  const priced = recipe.filter((e) => e.cardId && !STAPLES.has(e.name));
  // デッキ名と同じ名前 > デッキ名に含まれる名前（「デカヌチャン」に対する「カヌチャン」など）の順に優先
  const mainRank = (e) => (norm(e.name) === norm(archetype) ? 2 : norm(archetype).includes(norm(e.name)) ? 1 : 0);
  const pokemon = priced
    .filter((e) => e.category === 'ポケモン')
    .sort((a, b) => mainRank(b) - mainRank(a) || Number(/ex$/.test(b.name)) - Number(/ex$/.test(a.name)) || b.qty - a.qty);
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
    // 左にカード画像、右にカード名（枚数）と効果を並べる（src/components/KeyCardEffect.astro）
    effectBlocks.push(`  <KeyCardEffect id="${entry.cardId}" qty={${entry.qty}}>\n    <ul>\n  ${items.join('\n  ')}\n    </ul>\n  </KeyCardEffect>`);
  }
  return `---
// このページは scripts/auto-deck-updater.js が ${column.pubDate} に自動生成しました（出典: 公式デッキコード）。
// 立ち回り（序盤・中盤・終盤）は自動生成済み（deck-columns.json の gamePlan）。公開前に「代替カード・カスタマイズ案」を追記してください（TODO の箇所）。
import DeckColumn from '../../layouts/DeckColumn.astro';
import CardLink from '../../components/CardLink.astro';
import KeyCardEffect from '../../components/KeyCardEffect.astro';
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

  const source = SOURCES[opts.source];
  const PR_BODY_PATH = path(source.prBody);
  console.log(`■ 取得元: ${source.label}（${source.feed}）`);
  const items = (await feedItems(source.feed)).filter((it) => source.title.test(it.title));
  // シティリーグの期間まとめ記事は同じタイトルのまま会場が追記されていくため、記事単位ではなくデッキコード単位で処理済みを判定する
  // ジムバトルは新しい順に最大 GYM_ARTICLES 件を見て、処理済みの記事に着いた時点で打ち切る（新着がない日は RSS 1回だけで終わる）
  const firstDone = items.findIndex((it) => doneArticles.has(articleKey(it)));
  const fresh = opts.source === 'city' ? items.slice(0, CITY_ARTICLES) : items.slice(0, Math.min(firstDone === -1 ? items.length : firstDone, GYM_ARTICLES));
  const decksOf = (it) => (opts.source === 'city' ? cityArticleDecks(it.link, it.title) : articleDecks(it.link));
  console.log(`■ RSS: 対象記事 ${items.length}件 / 未処理 ${fresh.length}件`);
  for (const it of fresh) console.log(`  - ${it.title}（${it.link}）`);

  // 導入時: いまある記事を処理済みにするだけ
  if (opts.init) {
    for (const it of fresh) {
      const decks = await decksOf(it);
      processed.articles.push({ key: articleKey(it), link: it.link, title: it.title, processedAt: todayJst(), decks: decks.map((d) => d.deckId), columns: [] });
      for (const d of decks) doneDecks.add(d.deckId);
    }
    processed.decks = [...doneDecks];
    if (!opts.dryRun) await writeJson(PROCESSED_PATH, processed);
    return console.log(`\n${fresh.length}件を処理済みにしました（記事は生成していません）`);
  }
  if (fresh.length === 0) return console.log('新着はありません。');

  // 記事ごとのデッキを集める（記事化済みのデッキコードは除く）
  const columns = await readJson(COLUMNS_PATH, []);
  const imported = new Set(Object.values(await readJson(DECKS_PATH, {})).map((d) => d.deckId));
  const existingNames = new Set(columns.map((c) => norm(baseDeckName(c.deckName))));
  // 「カミッチュ（おまつりおんど）」のように、ポケモン名に補足を付けたアーキタイプ名は、ポケモン名から引けるようにする
  const knownArchetypes = new Map(columns.map((c) => [norm(baseDeckName(c.deckName).replace(/（[^（）]*）$/, '')), baseDeckName(c.deckName)]));
  const candidates = [];
  for (const it of fresh) {
    const decks = (await decksOf(it)).filter((d) => !doneDecks.has(d.deckId) && !imported.has(d.deckId));
    console.log(`
■ ${it.title}: 新しいデッキ ${decks.length}件`);
    for (const d of decks) candidates.push({ ...d, article: it });
    // シティリーグは、最新の記事に新しいデッキがなくても1つ前の記事まで見る（前回選ばれなかったデッキが残っていることがあるため）
  }
  if (opts.source === 'city' && candidates.length === 0) return console.log('新着はありません。');
  // ジムバトル: ●付きの小見出し・デッキ名の見出しがなかったデッキは、レシピからデッキ名を推定する
  if (opts.source === 'gym') {
    for (const d of candidates.filter((c) => !c.archetype)) {
      d.archetype = inferArchetype(await deckCards(d.deckId), knownArchetypes);
      d.inferred = true;
    }
  }
  // 優先順: 記事のないデッキ名の1つ目 → 記事のあるデッキ名の1つ目 → 同じデッキ名の2つ目以降（別構築）
  // （シティリーグはこの時点でデッキ名が未定のため、下の成績順で並べる）
  const occurrence = new Map();
  const rank = (d) => d.nth * 2 + Number(existingNames.has(norm(d.archetype)));
  const ordered = candidates
    .filter(() => opts.source === 'gym')
    .map((d) => {
      const nth = occurrence.get(norm(d.archetype)) ?? 0;
      occurrence.set(norm(d.archetype), nth + 1);
      return { ...d, nth };
    })
    .sort((a, b) => rank(a) - rank(b));
  // シティリーグ: 最新の開催日から CITY_WINDOW_DAYS 日以内のデッキを、新しい日付 → 成績（優勝 → 準優勝）→ 会場の掲載順に並べる。
  // 今回選ばなかったデッキは処理済みにしないので、次回以降に順番に記事になる（取りこぼさない）。
  // ●付き小見出しのデッキ名がないデッキは、ここで公式のデッキページを取得してレシピから名前を付け、同じ回に同じデッキ名が重ならないようにする
  const latest = Math.max(...candidates.map((d) => dateKey(d.date)));
  const dayOf = (date) => {
    const [m, d] = (date ?? '').split('/').map(Number);
    return m && d ? Date.UTC(2000, m - 1, d) / 86400e3 : 0;
  };
  const latestDay = Math.max(...candidates.map((d) => dayOf(d.date)));
  const inWindow = (d) => latestDay - dayOf(d.date) <= CITY_WINDOW_DAYS;
  const pool =
    opts.source === 'city'
      ? candidates.filter(inWindow).sort((a, b) => dateKey(b.date) - dateKey(a.date) || CITY_RANKS.indexOf(a.rank) - CITY_RANKS.indexOf(b.rank))
      : ordered;
  if (opts.source === 'city')
    console.log(`\n■ 最新の開催日 ${candidates.find((d) => dateKey(d.date) === latest)?.date}から${CITY_WINDOW_DAYS}日以内：${CITY_RANKS.join('・')} ${pool.length}件（未処理）`);
  // 取り込めないデッキ（60枚でない・現行スタンダード外のカードを含む）は飛ばして次の候補で埋める
  const selected = [];
  const checkedIds = new Set(); // 今回確認したデッキ（記事にした・取り込めなかった）。シティリーグはこれだけを処理済みにする
  for (const d of pool) {
    if (selected.length >= opts.maxColumns) break;
    if (opts.source === 'city') {
      if (!d.archetype) {
        d.archetype = inferArchetype(await deckCards(d.deckId), knownArchetypes);
        d.inferred = true;
      }
      if (selected.some((o) => norm(o.archetype) === norm(d.archetype))) continue;
    }
    const check = await importDecks([{ slug: `check-${d.deckId}`, deckId: d.deckId }], { dryRun: true, skipInvalid: true });
    checkedIds.add(d.deckId);
    if (check.decks.length > 0) selected.push(d);
  }
  console.log(`\n■ 記事を生成するデッキ（最大 ${opts.maxColumns}件）`);
  const taken = new Set(columns.map((c) => c.slug));
  const recipesBefore = await readJson(DECKS_PATH, {});
  const asRecipe = (list) => list.map((c) => ({ name: c.name, qty: c.count, category: c.category, aceSpec: c.aceSpec }));
  const sameBase = (c, archetype) => norm(baseDeckName(c.deckName)) === norm(archetype);
  for (const d of selected) d.list = await deckCards(d.deckId);
  for (const d of selected) {
    // 主軸名が同じ既存記事・同じ回のデッキがあれば、レシピの差分から「〇〇採用型」と名付ける（連番の「構築2」は使わない）
    const peers = [
      ...columns.filter((c) => sameBase(c, d.archetype) && recipesBefore[c.deckKey]).map((c) => recipesBefore[c.deckKey].cards),
      ...selected.filter((o) => o !== d && norm(o.archetype) === norm(d.archetype)).map((o) => asRecipe(o.list)),
    ];
    d.variant = peers.length > 0 ? variantLabel(asRecipe(d.list), peers) : null;
    if (!isDeckName(d.archetype)) throw new Error(`デッキ名が日付・大会名になっています: 「${d.archetype}」（${d.deckId}）`);
    ({ slug: d.slug, fallback: d.slugFallback, approx: d.slugApprox } = makeSlug(d.archetype, d.list, d.date, taken, d.variant));
    taken.add(d.slug);
    console.log(
      `  - ${d.archetype}${d.variant ? `（${d.variant.text}型）` : ''}（${d.date ?? '日付不明'}${d.venue ? ` ${d.venue}` : ''} ${d.rank ?? ''}${d.inferred ? '・デッキ名は推定' : d.nameSource === 'bullet' ? '・デッキ名は●小見出し' : ''}）→ /columns/${d.slug}/${d.slugFallback ? '（⚠ 英語名が不明のためローマ字）' : d.slugApprox ? '（⚠ デッキ名を英語にできないため主役ポケモンの英語名）' : ''}`,
    );
  }
  if (opts.dryRun) return console.log('\n（dry-run: カード追加・記事生成・処理済みの記録は行いません）');

  // カードの取り込み（無効なデッキは飛ばす）
  const result = selected.length > 0 ? await importDecks(selected.map((d) => ({ slug: d.slug, deckId: d.deckId })), { skipInvalid: true }) : { decks: [], added: [], skipped: [] };
  const recipes = await readJson(DECKS_PATH, {});
  const cards = await readJson(CARDS_PATH, []);
  const generated = [];
  const renamedColumns = []; // 同名デッキの追加で型名を付けた既存記事
  for (const d of selected.filter((x) => result.decks.includes(x.slug))) {
    const recipe = recipes[d.slug].cards;
    const keyCards = pickKeyCards(recipe, d.archetype);
    const isCity = opts.source === 'city';
    const rank = d.rank ?? '優勝';
    const label = `${d.date ?? ''} ${isCity ? 'シティリーグ' : 'ジムバトル'}${rank}`.trim();
    const placed = { 優勝: '優勝した', 準優勝: '準優勝した', TOP4: 'TOP4に入賞した' }[rank] ?? '優勝した';
    const deckName = d.variant ? `${d.archetype}（${d.variant.text}型）` : d.archetype;
    // 型名のない既存の同名記事にも、新しいデッキとの差分から型名を付ける（一覧・タイトルで区別できるように）
    for (const c of columns.filter((c) => c.deckName === d.archetype && recipes[c.deckKey])) {
      const others = [recipe, ...columns.filter((o) => o !== c && sameBase(o, d.archetype) && recipes[o.deckKey]).map((o) => recipes[o.deckKey].cards)];
      const renamed = `${d.archetype}（${variantLabel(recipes[c.deckKey].cards, others).text}型）`;
      c.title = c.title.replace(`${d.archetype}デッキレシピ`, `${renamed}デッキレシピ`);
      c.deckName = renamed;
      renamedColumns.push(c);
      console.log(`  ↻ 既存の記事を改名: /columns/${c.slug}/ → ${renamed}`);
    }
    const column = {
      slug: d.slug,
      deckKey: d.slug,
      deckName,
      title: `【${label}】${deckName}デッキレシピ！採用カード最安値・代替パーツ提案`,
      description: isCity
        ? `${d.date ? `${d.date}の` : ''}シティリーグ（${d.venue}）で${placed}${d.archetype}デッキの60枚レシピを、採用カードの最安値つきで紹介。主力カードの効果と、予算を抑える版の選び方をまとめています。`
        : `${d.date ? `${d.date}の` : ''}ジムバトルで${placed}${d.archetype}デッキの60枚レシピを、採用カードの最安値つきで紹介。主力カードの効果と、予算を抑える版の選び方をまとめています。`,
      result: label,
      // 大会の種類・成績（トップページの特集・一覧の大会バッジと絞り込みに使う）
      ...(isCity
        ? {
            eventType: 'city',
            rank,
            eventName: 'シティリーグ',
            venue: d.venue,
            ...(d.date && { eventDate: `${todayJst().slice(0, 4)}-${d.date.split('/').map((n) => n.padStart(2, '0')).join('-')}` }),
          }
        : { eventType: 'gym', rank, eventName: 'ジムバトル' }),
      pubDate: todayJst(),
      highlight: `${keyCards.slice(0, 2).join('・')}を採用した${d.archetype}デッキ。主力カードの効果と最安値をまとめて確認`,
      keyCards,
      // 序盤・中盤・終盤の立ち回り（60枚の構成と公式のカードテキストから自動生成。ページの「立ち回り・対戦の手順」に表示）
      gamePlan: buildGamePlan(recipe, await recipeProfiles(recipe), keyCards[0]),
    };
    await writeFile(path(`src/pages/columns/${d.slug}.astro`), await renderPage(column, recipe), 'utf8');
    columns.push(column);
    generated.push({ ...column, inferred: Boolean(d.inferred), slugFallback: Boolean(d.slugFallback), slugApprox: Boolean(d.slugApprox) });
    console.log(`  ✓ src/pages/columns/${d.slug}.astro`);
  }
  await writeJson(COLUMNS_PATH, columns);

  // 処理済みを記録（選ばなかったデッキ・無効だったデッキも記録し、次回は新しい記事のデッキだけを見る）
  for (const it of fresh) {
    // シティリーグは今回確認したデッキと、候補の期間より古いデッキだけを処理済みにする（残りは次回の候補）
    const ids = candidates.filter((c) => c.article === it && (opts.source !== 'city' || checkedIds.has(c.deckId) || !inWindow(c))).map((c) => c.deckId);
    // シティリーグは同じ記事を毎回見るため、新しいデッキがなかった記事は記録しない（処理済みの判定はデッキコードで行う）
    if (opts.source === 'city' && ids.length === 0) continue;
    processed.articles.push({ key: articleKey(it), link: it.link, title: it.title, processedAt: todayJst(), decks: ids, columns: generated.filter((g) => selected.some((s) => s.slug === g.slug && s.article === it)).map((g) => g.slug) });
    for (const id of ids) doneDecks.add(id);
  }
  processed.decks = [...doneDecks];
  await writeJson(PROCESSED_PATH, processed);

  // Pull Request の本文
  const addedCards = result.added.map((id) => cards.find((c) => c.id === id)).filter(Boolean);
  // X 告知用のコピペ文（記事末尾の「Xシェア用テキスト」と同じ文面。スマホの GitHub アプリからそのままコピーできるようコードブロックにする）
  const byId = new Map(cards.map((c) => [c.id, c]));
  const estimateOf = (slug) =>
    recipes[slug].cards.reduce((sum, e) => {
      const price = e.cardId && byId.has(e.cardId) ? rawBestPrice(byId.get(e.cardId)) : null;
      return sum + (price ?? 0) * e.qty;
    }, 0);
  const xSection = generated.flatMap((c) => {
    const { parent, reply } = buildXPosts({ deckName: c.deckName, result: c.result, highlight: c.highlight, estimate: estimateOf(c.slug), url: `${SITE_URL}columns/${c.slug}/` });
    return [`#### ${c.deckName}`, '1ポスト目（親）', '```', parent, '```', '2ポスト目（リプライ）', '```', reply, '```', ''];
  });
  const inferredColumns = generated.filter((c) => c.inferred);
  const romajiColumns = generated.filter((c) => c.slugFallback);
  const approxColumns = generated.filter((c) => c.slugApprox);
  const body = [
    `## 🏭 ポケカファクトリー｜新着${source.label}入賞デッキ記事の自動生成`,
    '',
    `RSS（${source.feed}）の新着記事から自動生成しました。`,
    '',
    '> デッキ名はポケカブックのまとめ記事の●付き小見出しの名前を正としています。',
    ...(inferredColumns.length
      ? [
          `> ⚠ 次の記事は●付き小見出しのデッキ名が取れなかったため、**デッキ名をレシピから推定**しています: ${inferredColumns.map((c) => c.deckName).join('・')}。元記事（画像を含む）と見比べて、違っていれば deck-columns.json の deckName・title・slug とページを直してください。`,
        ]
      : []),
    '',
    ...fresh.map((it) => `- 元記事: [${it.title}](${it.link})`),
    '',
    `### 生成した記事（${generated.length}本）`,
    ...(generated.length ? generated.map((c) => `- \`/columns/${c.slug}/\` ${c.title}`) : ['- なし']),
    '',
    ...(renamedColumns.length ? ['### 型名を付けた既存の記事（同名デッキと区別するため）', ...renamedColumns.map((c) => `- \`/columns/${c.slug}/\` → ${c.deckName}（本文中の表記も必要に応じて更新）`), ''] : []),
    `### 追加したカード（${addedCards.length}枚）`,
    ...(addedCards.length ? addedCards.map((c) => `- ${c.name} ${c.rarity} [${c.expansionCode} ${c.cardNumber}] ${c.regulationMark ?? ''}`) : ['- なし']),
    '',
    ...(result.skipped?.length ? ['### 価格を掲載できなかったカード（レシピには載るがリンクなし）', ...result.skipped.map((x) => `- ${x.name}: ${x.reason}`), ''] : []),
    ...(xSection.length ? ['### 📱 X（Twitter）投稿用コピペ文', 'マージして公開されたあとに投稿してください（見どころを書き直した場合は、公開後の記事末尾「Xシェア用テキスト」の文面を使うと最新になります）。', '', ...xSection] : []),
    '### マージ前に確認すること',
    ...(inferredColumns.length ? ['- [ ] 推定したデッキ名が元記事のデッキ名と合っている'] : []),
    ...(approxColumns.length ? [`- [ ] デッキ名を英語にできず主役ポケモンの英語名にした URL でよいか確認した（scripts/lib/english-name.js の DECK_WORDS に追記すると直訳になる）: ${approxColumns.map((c) => `\`${c.slug}\``).join('・')}`] : []),
    ...(romajiColumns.length ? [`- [ ] 英語名が分からずローマ字の slug になった記事の URL を英語表記に直した（scripts/lib/pokemon-names-en.json に追記）: ${romajiColumns.map((c) => `\`${c.slug}\``).join('・')}`] : []),
    '- [ ] 自動生成の立ち回り（序盤・中盤・終盤）をプレビューで読み、不自然な箇所があれば deck-columns.json の gamePlan を直した',
    '- [ ] 各記事の TODO（代替カード / カスタマイズ案）を追記した',
    '- [ ] 追加したカードの型番・レギュレーションマークに誤りがない',
    '- [ ] トップページの特集（優勝日が新しい順に自動で選ばれる）に載る記事の見どころ（highlight）を確認した',
    '',
    '— ポケカファクトリー（ポケトリー）自動デッキ更新',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');
  mkdirSync(path('.cache/'), { recursive: true });
  await writeFile(PR_BODY_PATH, `${body}\n`, 'utf8');
  console.log(`\n記事 ${generated.length}本・カード ${addedCards.length}枚。PR本文: ${source.prBody}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
