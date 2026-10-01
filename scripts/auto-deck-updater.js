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
//   推定したデッキ名は PR で確認・修正してからマージする。
//   どちらの場合も、デッキ名の通称ルール（scripts/lib/deck-name-rules.js。例: ヤドキング採用→「ひらめきチャレンジ」）に当てはまれば、ルールの名前を優先する。記事には eventType: 'city'・rank・eventName・venue・eventDate を付ける
//
// 仕組み:
// 1. RSS（https://pokecabook.com/archives/category/deck-recipe/feed）から「ジムバトル優勝デッキまとめ」の記事を取り出す。
//    まとめ記事は同じURLのまま、1週間同じタイトル（「【9/28(月)～10/4(日)】…」）で毎日デッキが追記されるため、
//    いちばん新しい処理済みの記事も毎回見直し、新しいデッキかどうかはデッキコードで判定する
//    （scripts/cache/processed-decks.json）
// 2. 記事ページの●付き小見出し（「●スッカラカン」= デッキ名。ポケカブックの表記を正とする）ごとに、ポケモン公式のデッキURL（deckID）を取り出す
// 3. 既存の記事がないデッキ名を優先して最大 --max-columns 件を選び、import-official-decks.js で取り込む
//    （現行スタンダードの版がないカードを含む・60枚でないデッキは飛ばす。未登録カードは最低レアリティで追加し価格を取得）
// 4. src/data/deck-columns.json に記事情報を追記し、src/pages/columns/{slug}.astro を生成する。
//    本文は公式のカードテキストから作る「デッキの構成」「主力カードの効果」と、最安値つき60枚レシピ・代替案の枠。
//    序盤・中盤・終盤の立ち回り（gamePlan）は60枚の構成と公式のカードテキストから自動生成する（scripts/lib/game-plan.js）。
//    見どころ（highlight）は Claude API で書き（scripts/lib/ai-highlight.js。ANTHROPIC_API_KEY が必要）、
//    点検を通らない・API のエラー・キーがないときは公式のカードテキストから組み立てる従来の方法（scripts/lib/highlight.js）を使う。
//    一覧のカードに出すひとこと（tagline。30〜40字）も見どころのあとに Claude API で書く（書けなければなし。一覧は見どころを出す）。
//    代替カード・カスタマイズ案は自動では書かないため、Pull Request で追記してから公開する。
//    デッキ名には「（〇〇採用型）」のような付け足しをしない（同じ日・同じ名前のデッキが並んでもそのまま。PR に一覧で出す）
// 5. Pull Request の本文（.cache/auto-deck-pr.md）を書き出す（GitHub Actions の auto-deck-sync.yml が使う）
//
// マナー: ポケカブック・公式サイトへのリクエストは1.5秒以上あける（scripts/lib/official.js）

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardEffects, deckCards, norm, romaji } from './lib/official.js';
import { CITY_RANKS, FEEDS, articleDecks, cityArticleDecks, feedItems, gymFreshItems, isDeckName } from './lib/pokecabook.js';
import { importDecks } from './import-official-decks.js';
import { STAPLES, baseDeckName, variantLabel } from './lib/deck-variant.js';
import { memberNote, placeTitles } from './lib/title-place.js';
import { deckEnglishName, englishName } from './lib/english-name.js';
import { buildXPosts, rawBestPrice } from '../src/utils/shareText.ts';
import { buildGamePlan, recipeProfiles } from './lib/game-plan.js';
import { CARD_ABILITIES_PATH, loadCardAbilities, matchDeckNameRule, needsAbilities, ruleMainCard } from './lib/deck-name-rules.js';
import { auditHighlights, chooseHighlights, highlightCandidates } from './lib/highlight.js';
import { generatedItem, highlightMethod } from './lib/pr-body.js';
import { AI_HIGHLIGHT_CONFIG, createAiHighlighter, fixLabel, reviewLabel, taglineLength, usageLines } from './lib/ai-highlight.js';

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
/** ジムバトルで1回に見るまとめ記事の数の上限（新しい順。処理済みの記事に着いたら、その記事までで止める） */
const GYM_ARTICLES = 3;
const PROCESSED_PATH = path('scripts/cache/processed-decks.json');
const COLUMNS_PATH = path('src/data/deck-columns.json');
const DECKS_PATH = path('src/data/official-decks.json');
const CARDS_PATH = path('src/data/cards.json');
const SITE_URL = 'https://www.pokeca-factory.com/';
/** 見どころをカードテキストから作れなかったときの印（PR で報告し、人が書く） */
const HIGHLIGHT_TODO = 'TODO: 見どころを書く';

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
 * 特性で判定する通称ルール（「ボムドラパ」= 特性「カースドボム」）のために、レシピのポケモンの特性を公式のカードテキストから調べ、
 * abilities（カード名 → 特性の名前。scripts/lib/card-abilities.json の内容）に足す。足したら true を返す（呼び出し側でファイルに保存する）
 */
async function learnAbilities(list, abilities) {
  if (!needsAbilities(list)) return false;
  let added = false;
  for (const c of list.filter((e) => e.category === 'ポケモン' && !abilities[e.name])) {
    const names = (await cardEffects(c.cardId)).filter((e) => e.kind === '特性' && e.name).map((e) => e.name);
    if (names.length === 0) continue;
    abilities[c.name] = names;
    added = true;
  }
  return added;
}

/**
 * デッキ名の通称ルール（scripts/lib/deck-name-rules.js）を当てはめる。●付き小見出しの名前・推定した名前より優先する。
 * ルールのカードが少なく迷う場合（ヤドキング1枚だけなど）は名前を変えず、d.ruleUncertain に候補の名前を入れて PR で確認する。
 * 違う名前の2つ以上のルールに当てはまる場合（「ボムドラパ」と「ノココッチドラパ」など）も名前を変えず、d.ruleConflict に入れて PR で確認する
 */
function applyNameRule(d, abilities) {
  const hit = matchDeckNameRule(d.list, abilities);
  if (!hit) return;
  if (hit.conflict) {
    d.ruleConflict = hit.rules.map((r) => r.name);
    return;
  }
  if (hit.uncertain) {
    d.ruleUncertain = hit.name;
    return;
  }
  if (norm(hit.name) === norm(d.archetype)) return;
  d.sourceName = d.archetype;
  d.sourceInferred = Boolean(d.inferred); // 元の名前が推定だったか（PR に出す）
  d.archetype = hit.name;
  d.nameRule = hit.rule;
  d.inferred = false; // ルールで決まった名前は推定ではない
}

/**
 * デッキ名の英語表記から slug を作る（例: tauros-deck-0928・bomb-talonflame-deck-0928・dipplin-festival-lead-deck-0927）。
 * 同名デッキと区別するカード（variant）がポケモンなら、URL にだけその英語名を付ける（例: dragapult-ex-deck-0927-moltres。デッキ名には付けない）。
 * デッキ名を英語にできないときは主役のポケモン（デッキ名と同じ名前・デッキ名に含まれる名前のポケモン）の英語名を使い approx: true、
 * それもないときだけ公式画像のローマ字を使い fallback: true を返す（どちらも PR で人が確認する）
 */
function makeSlug(archetype, list, date, taken, variant, mainName = archetype) {
  const pokemon = list.filter((c) => c.category === 'ポケモン');
  const main = pokemon.find((c) => norm(c.name) === norm(mainName)) ?? pokemon.find((c) => norm(mainName).includes(norm(c.name))) ?? pokemon[0];
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

/**
 * 主力パーツ: デッキ名のポケモン、ex・メガシンカなどのポケモン（枚数の多い順）、汎用カード以外のトレーナーズの順。
 * archetype には、通称ルールで名前を変えたデッキなら、ルールのカード名（「ひらめきチャレンジ」→「ヤドキング」）を渡す
 */
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
  // ジムバトルは新しい順に最大 GYM_ARTICLES 件を見て、処理済みの記事に着いたらその記事までで打ち切る
  // （1週間同じタイトルのまま毎日デッキが追記されるため、処理済みの記事も見直し、新しいデッキはデッキコードで判定する）
  const fresh = opts.source === 'city' ? items.slice(0, CITY_ARTICLES) : gymFreshItems(items, (it) => doneArticles.has(articleKey(it)), GYM_ARTICLES);
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
  if (candidates.length === 0) return console.log('新着はありません。');
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
  const abilities = loadCardAbilities(); // 特性の一覧（特性で判定する通称ルールに使う。公式から調べて足したら保存する）
  let abilitiesAdded = false;
  const checkedIds = new Set(); // 今回確認したデッキ（記事にした・取り込めなかった）。シティリーグはこれだけを処理済みにする
  for (const d of pool) {
    if (selected.length >= opts.maxColumns) break;
    d.list = await deckCards(d.deckId);
    if (opts.source === 'city' && !d.archetype) {
      d.archetype = inferArchetype(d.list, knownArchetypes);
      d.inferred = true;
    }
    if (await learnAbilities(d.list, abilities)) abilitiesAdded = true;
    applyNameRule(d, abilities);
    if (opts.source === 'city' && selected.some((o) => norm(o.archetype) === norm(d.archetype))) continue;
    const check = await importDecks([{ slug: `check-${d.deckId}`, deckId: d.deckId }], { dryRun: true, skipInvalid: true });
    checkedIds.add(d.deckId);
    if (check.decks.length > 0) selected.push(d);
  }
  console.log(`\n■ 記事を生成するデッキ（最大 ${opts.maxColumns}件）`);
  const taken = new Set(columns.map((c) => c.slug));
  const recipesBefore = await readJson(DECKS_PATH, {});
  const asRecipe = (list) => list.map((c) => ({ name: c.name, qty: c.count, category: c.category, aceSpec: c.aceSpec }));
  const sameBase = (c, archetype) => norm(baseDeckName(c.deckName)) === norm(archetype);
  for (const d of selected) {
    // 主軸名が同じ既存記事・同じ回のデッキがあれば、レシピの差分から区別できるカードを選び、URL にだけ使う（デッキ名には付けない）
    const peers = [
      ...columns.filter((c) => sameBase(c, d.archetype) && recipesBefore[c.deckKey]).map((c) => recipesBefore[c.deckKey].cards),
      ...selected.filter((o) => o !== d && norm(o.archetype) === norm(d.archetype)).map((o) => asRecipe(o.list)),
    ];
    d.variant = peers.length > 0 ? variantLabel(asRecipe(d.list), peers) : null;
    if (d.variant && !d.variant.card) d.variant = null;
    if (!isDeckName(d.archetype)) throw new Error(`デッキ名が日付・大会名になっています: 「${d.archetype}」（${d.deckId}）`);
    ({ slug: d.slug, fallback: d.slugFallback, approx: d.slugApprox } = makeSlug(d.archetype, d.list, d.date, taken, d.variant, d.nameRule ? ruleMainCard(d.nameRule) : d.archetype));
    taken.add(d.slug);
    console.log(
      `  - ${d.archetype}（${d.date ?? '日付不明'}${d.venue ? ` ${d.venue}` : ''} ${d.rank ?? '順位不明'}${d.venueNo ? `・元記事の${d.venueNo}会場目` : ''}${d.nameRule ? `・通称ルール（元の名前: ${d.sourceName}）` : d.inferred ? '・デッキ名は推定' : d.nameSource === 'bullet' ? '・デッキ名は●小見出し' : ''}${d.ruleUncertain ? `・⚠「${d.ruleUncertain}」に当てはまるか要確認` : ''}${d.ruleConflict ? `・⚠ 通称ルール「${d.ruleConflict.join('」「')}」の両方に当てはまるため要確認` : ''}）→ /columns/${d.slug}/${d.slugFallback ? '（⚠ 英語名が不明のためローマ字）' : d.slugApprox ? '（⚠ デッキ名を英語にできないため主役ポケモンの英語名）' : ''}`,
    );
  }
  if (opts.dryRun) return console.log('\n（dry-run: カード追加・記事生成・処理済みの記録は行いません）');
  if (abilitiesAdded) await writeFile(CARD_ABILITIES_PATH, `${JSON.stringify(Object.fromEntries(Object.entries(abilities).sort(([a], [b]) => a.localeCompare(b, 'ja'))), null, 2)}\n`, 'utf8');

  // カードの取り込み（無効なデッキは飛ばす）
  const result = selected.length > 0 ? await importDecks(selected.map((d) => ({ slug: d.slug, deckId: d.deckId })), { skipInvalid: true }) : { decks: [], added: [], skipped: [] };
  const recipes = await readJson(DECKS_PATH, {});
  const cards = await readJson(CARDS_PATH, []);
  const generated = [];
  const highlightInputs = []; // 見どころの材料（同じ日の記事と書き出しが重ならないよう、全記事の生成後にまとめて選ぶ）
  for (const d of selected.filter((x) => result.decks.includes(x.slug))) {
    const recipe = recipes[d.slug].cards;
    const keyCards = pickKeyCards(recipe, d.nameRule ? ruleMainCard(d.nameRule) : d.archetype);
    const profiles = await recipeProfiles(recipe); // 採用カードの公式テキスト（立ち回り・見どころに使う。キャッシュつき）
    const isCity = opts.source === 'city';
    const rank = d.rank ?? '優勝';
    const label = `${d.date ?? ''} ${isCity ? 'シティリーグ' : 'ジムバトル'}${rank}`.trim();
    const placed = { 優勝: '優勝した', 準優勝: '準優勝した', TOP4: 'TOP4に入賞した' }[rank] ?? '優勝した';
    // デッキ名には「（〇〇採用型）」のような付け足しをしない（同じ名前のデッキが並んでもそのまま）
    const deckName = d.archetype;
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
      // 見どころ: 主役の特性・ワザ（名前・ダメージ・効果）と組み合わせるカードを、公式のカードテキストから作る（scripts/lib/highlight.js）。
      // 下で同じ日の記事と書き出しが重ならない候補を選んで入れる。作れなかったときは TODO のまま PR で報告する
      highlight: HIGHLIGHT_TODO,
      // 見どころを書いたのは誰か（'ai' = Claude API / 'manual' = 人が手で直した。従来の方法なら付けない）。下で AI の文を使ったら 'ai' にする
      highlightBy: undefined,
      // ひとこと（一覧のカードに出す30〜40字。scripts/lib/ai-highlight.js の writeTagline）。下で AI が書けたら入れる（書けなければ一覧は見どころを出す）
      tagline: undefined,
      taglineBy: undefined,
      keyCards,
      // 序盤・中盤・終盤の立ち回り（60枚の構成と公式のカードテキストから自動生成。ページの「立ち回り・対戦の手順」に表示）
      gamePlan: buildGamePlan(recipe, profiles, keyCards[0]),
    };
    highlightInputs.push({ column, recipe, profiles });
    await writeFile(path(`src/pages/columns/${d.slug}.astro`), await renderPage(column, recipe), 'utf8');
    columns.push(column);
    generated.push({
      ...column,
      inferred: Boolean(d.inferred),
      slugFallback: Boolean(d.slugFallback),
      slugApprox: Boolean(d.slugApprox),
      sourceName: d.sourceName,
      renamedByRule: Boolean(d.nameRule),
      ruleUncertain: d.ruleUncertain,
      ruleConflict: d.ruleConflict,
      // PR の「生成した記事」に出す大会の情報（取れなかった項目は「取得できず」と出す）
      source: {
        eventLabel: source.label,
        date: d.date,
        rank: d.rank,
        venue: d.venue,
        nameSource: d.nameSource,
        sourceInferred: Boolean(d.sourceInferred),
        articleTitle: d.article.title,
        articleLink: d.article.link,
        venueNo: d.venueNo,
      },
    });
    console.log(`  ✓ src/pages/columns/${d.slug}.astro`);
  }
  // 見どころを選ぶ（同じ日に公開する記事同士で、書き出しがそっくりにならない候補を選ぶ）
  const namesOf = (recipe, column) => [...recipe.map((e) => e.name), ...column.keyCards];
  const sameDay = columns
    .filter((c) => c.pubDate === todayJst() && !highlightInputs.some((h) => h.column === c))
    .map((c) => ({ slug: c.slug, highlight: c.highlight, names: [...(recipes[c.deckKey]?.cards ?? []).map((e) => e.name), ...(c.keyCards ?? [])] }));
  const chosen = chooseHighlights(
    highlightInputs.map(({ column, recipe, profiles }) => ({
      slug: column.slug,
      names: namesOf(recipe, column),
      candidates: highlightCandidates({ recipe, profiles, keyCards: column.keyCards }),
    })),
    sameDay,
  );
  // AI（Claude API）で見どころを書く（scripts/lib/ai-highlight.js）。点検を通らない・API のエラー・キーがない・呼び出し回数の上限のときは、
  // 上で選んだ従来の方法の見どころを使う（AI の失敗で記事の自動生成を止めない）
  const ai = createAiHighlighter({ log: (msg) => console.log(msg) });
  const current = new Map(highlightInputs.map(({ column }) => [column.slug, chosen.get(column.slug) ?? null]));
  const highlightResult = new Map(); // slug → { ai: boolean, reason?: string, review?: { status, reasons }, fix?: { outcome, … } }（PR 本文用）
  if (highlightInputs.length) console.log(`\n■ 見どころ（AI: ${ai.stats.enabled ? AI_HIGHLIGHT_CONFIG.model : 'ANTHROPIC_API_KEY なし → 従来の方法'}）`);
  for (const { column, recipe, profiles } of highlightInputs) {
    try {
      if (ai.stats.enabled) console.log(`- ${column.slug}`);
      // 書き出しを比べる相手: 同じ日の既存の記事と、今回のほかの記事（AI で書き直したものはその文）
      const others = [
        ...sameDay,
        ...highlightInputs.filter((h) => h.column !== column).map((h) => ({ slug: h.column.slug, highlight: current.get(h.column.slug), names: namesOf(h.recipe, h.column) })),
      ].filter((o) => o.highlight && o.highlight !== HIGHLIGHT_TODO);
      const input = { deckName: column.deckName, main: column.keyCards[0], recipe, profiles, names: namesOf(recipe, column), others };
      const r = await ai.write(input);
      if (!r.text) {
        highlightResult.set(column.slug, { ai: false, reason: r.reason });
        continue;
      }
      // チェック役: AI の文を公式テキストと見比べ、要確認なら「誤り」の理由を渡して1回だけ直させ、もう一度チェックする。
      // それでも要確認なら（直した文を使い）PR で人に知らせる
      const checked = await ai.checkAndFix(input, r.text);
      current.set(column.slug, checked.text);
      highlightResult.set(column.slug, { ai: true, review: checked.review, fix: checked.fix });
    } catch (error) {
      console.log(`  ⚠ AI の見どころを作れませんでした（${error?.message ?? error}）。従来の方法を使います`);
      highlightResult.set(column.slug, { ai: false, reason: '予期しないエラー' });
    }
  }
  // ひとこと（一覧のカードに出す30〜40字）: 見どころがすべて決まってから、AI で書く（見どころを優先して呼び出し回数の上限を使う）。
  // 長さをはみ出す・点検に通らないときは2回まで書き直させ（「あと○字削って」と伝える）、チェック役が要確認なら1回だけ直させる（見どころと同じ基準）。
  // 書けなかったときはひとことなし（一覧は今までどおり見どころを出す）
  const taglineResult = new Map(); // slug → { text?: string, reason?: string, review?, fix? }（PR 本文用）
  if (ai.stats.enabled && highlightInputs.length) console.log('\n■ ひとこと（一覧のカード）');
  for (const { column, recipe, profiles } of highlightInputs) {
    const highlight = current.get(column.slug);
    if (!ai.stats.enabled) {
      taglineResult.set(column.slug, { reason: 'ANTHROPIC_API_KEY が設定されていない' });
      continue;
    }
    if (!highlight) {
      taglineResult.set(column.slug, { reason: '見どころがない' });
      continue;
    }
    try {
      console.log(`- ${column.slug}`);
      const others = [
        ...columns.filter((c) => c.pubDate === column.pubDate && c.slug !== column.slug && c.tagline).map((c) => ({ slug: c.slug, tagline: c.tagline, names: [] })),
        ...[...taglineResult].filter(([slug, t]) => slug !== column.slug && t.text).map(([slug, t]) => ({ slug, tagline: t.text, names: [] })),
      ];
      const input = { deckName: column.deckName, main: column.keyCards[0], recipe, profiles, names: namesOf(recipe, column), others, highlight };
      const r = await ai.writeTagline(input);
      if (!r.text) {
        taglineResult.set(column.slug, { reason: r.reason });
        continue;
      }
      const checked = await ai.checkAndFix(input, r.text, { kind: 'tagline' });
      taglineResult.set(column.slug, { text: checked.text, review: checked.review, fix: checked.fix });
    } catch (error) {
      console.log(`  ⚠ ひとことを作れませんでした（${error?.message ?? error}）。一覧は見どころを出します`);
      taglineResult.set(column.slug, { reason: '予期しないエラー' });
    }
  }
  console.log(usageLines(ai.stats).join('\n'));
  for (const { column } of highlightInputs) {
    column.highlight = current.get(column.slug) ?? HIGHLIGHT_TODO;
    const result = highlightResult.get(column.slug) ?? { ai: false };
    if (result.ai) column.highlightBy = 'ai';
    const tagline = taglineResult.get(column.slug) ?? {};
    if (tagline.text) Object.assign(column, { tagline: tagline.text, taglineBy: 'ai' });
    const g = generated.find((x) => x.slug === column.slug);
    if (g) Object.assign(g, { highlight: column.highlight, highlightBy: column.highlightBy, highlightResult: result, tagline: column.tagline, taglineResult: tagline });
  }
  // 同じ日・同じ大会の種類・同じ名前の記事ができたら、タイトルの【】に都道府県（同じなら店舗名）を付けて区別する。
  // 店舗のデータがない記事（ジムバトルなど）は、レシピの違いからタイトルに「（〇〇採用型）」を付ける（scripts/lib/title-place.js。デッキ名には付けない）。
  // 今回の記事を含むグループだけを直す（同じグループの既存の記事のタイトルも変わることがある。URL は変えない）
  const place = placeTitles(columns, (c) => recipes[c.deckKey]?.cards ?? recipes[c.slug]?.cards ?? null);
  const generatedSlugSet = new Set(generated.map((g) => g.slug));
  const touches = (g) => g.columns.some(({ c }) => generatedSlugSet.has(c.slug));
  const sameNameDay = place.groups.filter(touches);
  const unresolvedTitles = place.unresolved.filter((g) => g.columns.some((c) => generatedSlugSet.has(c.slug)));
  const retitled = [];
  for (const g of sameNameDay) {
    for (const { c } of g.columns) {
      const title = place.titles.get(c.slug);
      if (!title) continue;
      retitled.push({ slug: c.slug, before: c.title, after: title, existing: !generatedSlugSet.has(c.slug) });
      c.title = title;
      const gen = generated.find((x) => x.slug === c.slug);
      if (gen) gen.title = title;
    }
  }
  // 新しくルールで付けた採用型を保存する（保存済み・手で書いた採用型は付け直さない）
  for (const g of sameNameDay) {
    for (const { c } of g.columns) {
      if (place.newLabels.has(c.slug)) Object.assign(c, { titleLabel: place.newLabels.get(c.slug), titleLabelBy: 'auto' });
    }
  }
  await writeJson(COLUMNS_PATH, columns);

  // 処理済みを記録（選ばなかったデッキ・無効だったデッキも記録し、次回は新しい記事のデッキだけを見る）
  for (const it of fresh) {
    // シティリーグは今回確認したデッキと、候補の期間より古いデッキだけを処理済みにする（残りは次回の候補）
    const ids = candidates.filter((c) => c.article === it && (opts.source !== 'city' || checkedIds.has(c.deckId) || !inWindow(c))).map((c) => c.deckId);
    // 同じ記事を毎回見るため、新しいデッキがなかった記事は記録しない（処理済みの判定はデッキコードで行う）
    if (ids.length === 0) continue;
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
    const { parent, reply } = buildXPosts({ deckName: c.deckName, result: c.result, highlight: c.highlight, tagline: c.tagline, estimate: estimateOf(c.slug), url: `${SITE_URL}columns/${c.slug}/` });
    return [`#### ${c.deckName}`, '1ポスト目（親）', '```', parent, '```', '2ポスト目（リプライ）', '```', reply, '```', ''];
  });
  // 紹介文の点検: 決まった文（BANNED_PHRASES）と、同じ日の記事同士の書き出しの似かよい
  const xParentOf = (c) => buildXPosts({ deckName: c.deckName, result: c.result, highlight: c.highlight, tagline: c.tagline, estimate: estimateOf(c.slug), url: '' }).parent;
  const audit = auditHighlights([
    ...sameDay.map((c) => ({ ...c, pubDate: todayJst() })),
    ...generated.map((c) => ({ slug: c.slug, pubDate: c.pubDate, highlight: c.highlight, names: namesOf(recipes[c.slug].cards, c), xText: xParentOf(c) })),
  ]);
  const generatedSlugs = new Set(generated.map((c) => c.slug));
  const bannedHits = audit.banned.filter((b) => generatedSlugs.has(b.slug));
  const similarHits = audit.similar.filter(([a, b]) => generatedSlugs.has(a.slug) || generatedSlugs.has(b.slug));
  const todoHighlights = generated.filter((c) => c.highlight === HIGHLIGHT_TODO);
  const inferredColumns = generated.filter((c) => c.inferred);
  const romajiColumns = generated.filter((c) => c.slugFallback);
  const approxColumns = generated.filter((c) => c.slugApprox);
  const ruleColumns = generated.filter((c) => c.renamedByRule);
  const uncertainColumns = generated.filter((c) => c.ruleUncertain);
  const conflictColumns = generated.filter((c) => c.ruleConflict);
  // チェック役で ⚠（要確認・チェックできず）になった AI の見どころは、本文のいちばん上にまとめる
  // （要確認で AI が自分で直し、問題なしになった記事は ✅ なのでここには出さない。直せなかった記事は「直せずに人に知らせた」を付ける）
  const reviewFlagged = generated.filter((c) => c.highlightResult?.ai && c.highlightResult.review?.status !== 'ok');
  const selfFixed = generated.filter((c) => c.highlightResult?.fix?.outcome === 'fixed');
  // ひとことで ⚠（要確認・チェックできず）になった記事も、本文のいちばん上にまとめる
  const taglineFlagged = generated.filter((c) => c.taglineResult?.text && c.taglineResult.review?.status !== 'ok');
  const taglineLine = (c) => {
    const t = c.taglineResult ?? {};
    if (!t.text) return `  - ひとこと: なし（一覧は見どころを出す${t.reason ? `・${t.reason}` : ''}）`;
    const parts = ['AIで作成', `${taglineLength(t.text)}字`, t.review ? reviewLabel(t.review) : null, t.fix ? fixLabel(t.fix) : null, t.fix?.after ? `直す前の文：${t.fix.before}` : null];
    return `  - ひとこと（${parts.filter(Boolean).join('・')}）: ${t.text}`;
  };
  const body = [
    ...(taglineFlagged.length
      ? [
          '> [!WARNING]',
          `> **ひとこと（一覧のカード）のチェック役の AI が ⚠ を付けた記事（${taglineFlagged.length}本）**。記事の「主力カードの効果」と見比べ、直すなら \`tagline\` を手で直して \`taglineBy\` を \`"manual"\` にしてください`,
          ...taglineFlagged.map(
            (c) => `> - \`/columns/${c.slug}/\`（${c.deckName}）「${c.taglineResult.text}」: ${reviewLabel(c.taglineResult.review) || '⚠ チェックできず'}${c.taglineResult.fix ? `・${fixLabel(c.taglineResult.fix)}` : ''}`,
          ),
          '',
        ]
      : []),
    ...(reviewFlagged.length
      ? [
          '> [!WARNING]',
          `> **見どころのチェック役の AI が ⚠ を付けた記事（${reviewFlagged.length}本）**。記事の「主力カードの効果」と見比べ、直すなら \`highlight\` を手で直して \`highlightBy\` を \`"manual"\` にしてください`,
          ...reviewFlagged.map(
            (c) => `> - \`/columns/${c.slug}/\`（${c.deckName}）: ${reviewLabel(c.highlightResult.review) || '⚠ チェックできず'}${c.highlightResult.fix ? `・${fixLabel(c.highlightResult.fix)}` : ''}`,
          ),
          '',
        ]
      : []),
    ...(selfFixed.length
      ? [
          `> 🔧 見どころのチェック役が要確認にし、AI が自分で直して問題なしになった記事（${selfFixed.length}本）: ${selfFixed.map((c) => `\`/columns/${c.slug}/\``).join('・')}（直す前の文と指摘は「生成した記事」に出しています）`,
          '',
        ]
      : []),
    `## 🏭 ポケカファクトリー｜新着${source.label}入賞デッキ記事の自動生成`,
    '',
    `RSS（${source.feed}）の新着記事から自動生成しました。`,
    '',
    '> デッキ名はポケカブックのまとめ記事の●付き小見出しの名前を正としています（通称ルール `scripts/lib/deck-name-rules.js` に当てはまるデッキは、ルールの名前を優先）。「（〇〇採用型）」のような付け足しはしません。',
    ...(inferredColumns.length
      ? [
          `> ⚠ 次の記事は●付き小見出しのデッキ名が取れなかったため、**デッキ名をレシピから推定**しています: ${inferredColumns.map((c) => c.deckName).join('・')}。元記事（画像を含む）と見比べて、違っていれば deck-columns.json の deckName・title・slug とページを直してください。`,
        ]
      : []),
    '',
    ...fresh.map((it) => `- 元記事: [${it.title}](${it.link})`),
    '',
    `### 生成した記事（${generated.length}本）`,
    '（「〇会場目」は、元記事の会場の見出しを上から数えた順番です。結果の画像がない会場も数えます。ジムバトルは店舗名が載っていないため、デッキ1つを1会場として上から数えています）',
    '',
    ...(generated.length ? generated.map((c) => `${generatedItem(c)}\n  - 見どころ（${highlightMethod(c)}）: ${c.highlight}\n${taglineLine(c)}`) : ['- なし']),
    '',
    '### Claude API（見どころ・ひとこと）の使用量',
    ...usageLines(ai.stats),
    '',
    ...(bannedHits.length || similarHits.length || todoHighlights.length
      ? [
          '### ⚠ 紹介文（見どころ・X投稿文）の確認すべき点',
          ...bannedHits.map((b) => `- \`/columns/${b.slug}/\` の${b.where}に決まった文が含まれています: ${b.labels.join('・')}`),
          ...similarHits.map(([a, b, head]) => `- \`/columns/${a.slug}/\` と \`/columns/${b.slug}/\` の見どころの書き出しがそっくりです（骨組み: 「${head}…」）`),
          ...todoHighlights.map((c) => `- \`/columns/${c.slug}/\` はカードテキストから見どころを作れませんでした（TODO のまま。deck-columns.json の highlight を書いてください）`),
          '',
        ]
      : []),
    ...(ruleColumns.length
      ? ['### 通称ルールでデッキ名を変えた記事', ...ruleColumns.map((c) => `- \`/columns/${c.slug}/\` ${c.sourceName ?? '—'} → **${c.deckName}**`), '']
      : []),
    ...(uncertainColumns.length
      ? [
          '### ⚠ 通称ルールに当てはまるか迷う記事（デッキ名は変えていません）',
          ...uncertainColumns.map((c) => `- \`/columns/${c.slug}/\` ${c.deckName}（「${c.ruleUncertain}」のカードが少ない）`),
          '',
        ]
      : []),
    ...(conflictColumns.length
      ? [
          '### ⚠ 2つ以上の通称ルールに当てはまる記事（デッキ名は変えていません。どちらの名前にするか決めてください）',
          ...conflictColumns.map((c) => `- \`/columns/${c.slug}/\` ${c.deckName}（「${c.ruleConflict.join('」「')}」の両方に当てはまる）`),
          '',
        ]
      : []),
    ...(sameNameDay.length
      ? [
          '### 同じ日・同じ名前の記事（デッキ名に付け足しをしないため、タイトルに都道府県・店舗名、店舗のデータがなければ「（〇〇採用型）」を付けて区別しました）',
          ...sameNameDay.map((g) => `- ${g.deckName}（${g.day}）: ${g.columns.map((t) => `\`/columns/${t.c.slug}/\`（${memberNote(t)}）`).join('・')}`),
          ...retitled.map((r) => `  - \`/columns/${r.slug}/\`${r.existing ? '（既存の記事）' : ''}: ${r.before} → **${r.after}**`),
          '',
        ]
      : []),
    ...(unresolvedTitles.length
      ? [
          '### ⚠ タイトルで区別できない記事（店舗のデータもレシピもない。タイトルが同じになっています）',
          ...unresolvedTitles.map((g) => `- ${g.deckName}（${g.day}）: ${g.columns.map((c) => `\`/columns/${c.slug}/\``).join('・')}`),
          '',
        ]
      : []),
    `### 追加したカード（${addedCards.length}枚）`,
    ...(addedCards.length ? addedCards.map((c) => `- ${c.name} ${c.rarity} [${c.expansionCode} ${c.cardNumber}] ${c.regulationMark ?? ''}`) : ['- なし']),
    '',
    ...(result.skipped?.length ? ['### 価格を掲載できなかったカード（レシピには載るがリンクなし）', ...result.skipped.map((x) => `- ${x.name}: ${x.reason}`), ''] : []),
    ...(xSection.length ? ['### 📱 X（Twitter）投稿用コピペ文', 'マージして公開されたあとに投稿してください（見どころを書き直した場合は、公開後の記事末尾「Xシェア用テキスト」の文面を使うと最新になります）。', '', ...xSection] : []),
    '### マージ前に確認すること',
    ...(bannedHits.length || similarHits.length || todoHighlights.length ? ['- [ ] 「紹介文の確認すべき点」の見どころを書き直した'] : []),
    ...(generated.some((c) => c.highlightResult?.ai) ? ['- [ ] 「AIで作成」の見どころを記事の「主力カードの効果」と見比べ、カードテキストにないことが書かれていないか確認した'] : []),
    ...(generated.some((c) => c.taglineResult?.text) ? ['- [ ] ひとこと（一覧のカード）を記事の「主力カードの効果」と見比べ、カードテキストにないことが書かれていないか確認した'] : []),
    ...(inferredColumns.length ? ['- [ ] 推定したデッキ名が元記事のデッキ名と合っている'] : []),
    ...(uncertainColumns.length ? ['- [ ] 通称ルールに当てはまるか迷う記事のデッキ名を決めた'] : []),
    ...(conflictColumns.length ? ['- [ ] 2つ以上の通称ルールに当てはまる記事のデッキ名を決めた'] : []),
    ...(unresolvedTitles.length ? ['- [ ] タイトルで区別できない同じ日・同じ名前の記事をどうするか決めた'] : []),
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
