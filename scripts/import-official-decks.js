// ポケモンカード公式のデッキコードからデッキレシピを取り込み、未登録カードを cards.json に追加する
//
// 使い方:
//   npm run import-decks -- --deck=mega-gengar:yURyXp-1LCAKr-M3MRyy --deck=...   （デッキページのURLでも可）
//   npm run import-decks -- --deck=... --dry-run                                 取り込み結果を表示するだけ
//
// 仕組み:
// 1. 公式のデッキページからカード（公式カードID・名前・枚数・種類）を読み取る
// 2. 各カードについて、公式カード検索（スタンダード）で「デッキで使われた版と効果テキストが同じ版」を調べ、
//    cards.json に登録済みの版があればそれ（複数あれば最安）を、なければ最低レアリティの版をシードにする
//    （同名でも効果の違うカード。例: ゲッコウガex の SV5a 版と M6a 版は別のカードとして扱う）
// 3. シード（scripts/seed/official-decks.json）を add-cards（楽天の出品で型番を確認）→ update-prices の順に実行する
// 4. レシピを src/data/official-decks.json に保存する（コラム記事のデッキレシピ表が使う。cardId は cards.json の id）

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STANDARD_EXEMPT_NAMES, STANDARD_REGULATIONS } from '../src/consts.ts';
import { deckCards, norm, OFFICIAL, samePrintings, seedFromPrintings } from './lib/official.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const CARDS_PATH = path('src/data/cards.json');
const DECKS_PATH = path('src/data/official-decks.json');
const SEED = 'scripts/seed/official-decks.json';
/** 価格比較の対象にしないカード（基本エネルギー） */
const SKIP_NAME = /^基本.+エネルギー$/;

function parseArgs(argv) {
  const decks = argv
    .filter((a) => a.startsWith('--deck='))
    .map((a) => {
      const [slug, ref] = a.slice('--deck='.length).split(/:(.+)/);
      const deckId = ref?.match(/deckID\/([A-Za-z0-9-]+)/)?.[1] ?? ref;
      if (!/^[a-z0-9-]+$/.test(slug ?? '') || !/^[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(deckId ?? '')) {
        throw new Error(`--deck は「スラッグ:デッキコード（またはURL）」の形式で指定してください: ${a}`);
      }
      return { slug, deckId };
    });
  if (decks.length === 0) throw new Error('--deck=スラッグ:デッキコード を1つ以上指定してください');
  return { decks, dryRun: argv.includes('--dry-run') };
}

const priceOf = (c) => Math.min(...[c.saleInStock && c.salePrice > 0 ? c.salePrice : Infinity, c.yahooPrice > 0 ? c.yahooPrice : Infinity]);

const model = (code, number) => `${code} ${number}`.toUpperCase();

/** 効果が同じ版のうち cards.json に登録済みのもの（same は最低レアリティ順。同じ順位なら最安） */
function registeredMatch(cards, name, same) {
  const order = same.map((d) => model(d.code, d.cardNumber));
  return cards
    .filter((c) => norm(c.name) === norm(name) && order.includes(model(c.expansionCode, c.cardNumber)))
    .sort((a, b) => order.indexOf(model(a.expansionCode, a.cardNumber)) - order.indexOf(model(b.expansionCode, b.cardNumber)) || priceOf(a) - priceOf(b))[0];
}

/**
 * 公式デッキを取り込む（未登録カードの追加・価格取得・レシピ保存）。
 * skipInvalid: true なら、60枚でない・現行スタンダードの版がないカードを含むデッキは例外にせず飛ばす（自動取り込み用）
 * 返り値: 取り込めたデッキのキーと、追加したカードの id
 */
export async function importDecks(decks, { dryRun = false, skipInvalid = false } = {}) {
  let cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
  const fail = (message) => {
    if (!skipInvalid) throw new Error(message);
    console.log(`  ✗ ${message} → このデッキは取り込みません`);
  };

  // 1〜2. デッキを読み取り、カードごとに効果が同じ版を調べる
  const printingsById = new Map(); // 公式カードID → samePrintings の結果
  const loaded = [];
  deckLoop: for (const { slug, deckId } of decks) {
    const list = await deckCards(deckId);
    const total = list.reduce((s, c) => s + c.count, 0);
    console.log(`■ ${slug}（${deckId}）${list.length}種 ${total}枚`);
    if (total !== 60) {
      fail(`${slug} の合計が ${total} 枚です（60枚である必要があります）`);
      continue;
    }
    for (const c of list) {
      if (SKIP_NAME.test(c.name) || printingsById.has(c.cardId)) continue;
      printingsById.set(c.cardId, await samePrintings(c.name, [c.cardId]));
    }
    for (const c of list) {
      if (!SKIP_NAME.test(c.name) && !printingsById.get(c.cardId).any) {
        fail(`${c.name}（公式カードID ${c.cardId}）は現行スタンダードの版がありません`);
        continue deckLoop;
      }
    }
    loaded.push({ slug, deckId, list });
  }

  const seeds = [];
  for (const { slug, list } of loaded) {
    for (const c of list) {
      if (SKIP_NAME.test(c.name)) continue;
      const { same } = printingsById.get(c.cardId);
      // 最低レアリティと同じレアリティの版が登録済みなら追加しない（SAR などの高レアだけが登録済みなら、最低レアリティの版を追加する）
      const r = seedFromPrintings(c.name, same, { deck: slug, role: `${c.category}` });
      const registered = registeredMatch(cards, c.name, same);
      if (registered && (r.skip || registered.rarity === r.seed.rarity || model(registered.expansionCode, registered.cardNumber) === model(r.seed.expansionCode, r.seed.cardNumber))) continue;
      if (r.skip) {
        console.log(`  - ${c.name}: ${r.skip} → 追加できません`);
        continue;
      }
      if (!seeds.some((s) => s.id === r.seed.id)) seeds.push(r.seed);
    }
  }
  console.log(`\n未登録カード: ${seeds.length}枚`);
  for (const s of seeds) console.log(`  + ${s.name} ${s.rarity} [${s.expansionCode} ${s.cardNumber}] ${s.regulationMark}`);

  if (dryRun) {
    console.log('\n（dry-run: カードの追加・レシピの保存は行いません）');
    return { decks: loaded.map((d) => d.slug), added: [], printingsById, loaded };
  }

  // 3. add-cards → update-prices
  let added = [];
  if (seeds.length > 0) {
    await writeFile(path(SEED), `${JSON.stringify({ _comment: ['npm run import-decks が公式デッキコードから自動生成。'], cards: seeds }, null, 2)}\n`, 'utf8');
    const before = new Set(cards.map((c) => c.id));
    const run = (args) => spawnSync(process.execPath, args, { cwd: path('.'), stdio: 'inherit' }).status;
    console.log('\n■ add-cards');
    if (run(['scripts/add-cards.js', `--seed=${SEED}`]) !== 0) throw new Error('add-cards が失敗しました');
    cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
    added = cards.map((c) => c.id).filter((id) => !before.has(id));
    if (added.length > 0) {
      console.log('\n■ update-prices');
      if (run(['scripts/update-prices.js', `--ids=${added.join(',')}`]) !== 0) throw new Error('update-prices が失敗しました');
      cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
    }
  }

  // 4. レシピを保存（追加できなかったカードは cardId なしで載せる）
  const saved = JSON.parse(await readFile(DECKS_PATH, 'utf8').catch(() => '{}'));
  for (const { slug, deckId, list } of loaded) {
    saved[slug] = {
      deckId,
      url: `${OFFICIAL}/deck/result.html/deckID/${deckId}/`,
      cards: list.map((c) => {
        const match = SKIP_NAME.test(c.name) ? undefined : registeredMatch(cards, c.name, printingsById.get(c.cardId).same);
        const notes = [
          c.aceSpec && 'ACE SPEC（デッキに1枚まで）',
          match && !STANDARD_REGULATIONS.includes(match.regulationMark) && STANDARD_EXEMPT_NAMES.includes(c.name) && '公式の例外リストにより版を問わずスタンダードで使用可',
        ].filter(Boolean);
        return {
          name: c.name,
          qty: c.count,
          category: c.category,
          ...(match && { cardId: match.id }),
          ...(notes.length > 0 && { note: notes.join('・') }),
          officialCardId: c.cardId,
        };
      }),
    };
    const missing = saved[slug].cards.filter((c) => !c.cardId && !SKIP_NAME.test(c.name));
    console.log(`\n${slug}: ${saved[slug].cards.length}種を保存${missing.length ? `（価格未掲載: ${missing.map((c) => c.name).join('、')}）` : ''}`);
  }
  await writeFile(DECKS_PATH, `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
  console.log(`保存しました: src/data/official-decks.json`);
  return { decks: loaded.map((d) => d.slug), added, printingsById, loaded };
}

// コマンドとして実行されたときだけ動く（auto-deck-updater.js から import されたときは動かない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { decks, dryRun } = parseArgs(process.argv.slice(2));
  importDecks(decks, { dryRun }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
