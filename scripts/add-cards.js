// シードデータ（scripts/seed/*.json）のカードを、楽天の出品で型番を確認したうえで src/data/cards.json に追加する
//
// 使い方:
//   npm run add-cards                                   scripts/seed/meta-cards.json を追加
//   npm run add-cards -- --seed=scripts/seed/xxx.json   別のシードを追加
//   npm run add-cards -- --dry-run                      確認結果を表示するだけで保存しない
//   npm run add-cards -- --min-hits=3                   一致とみなす出品数の下限（既定 3）
//
// 追加後に npm run update-prices を実行すると、販売価格・画像・Yahoo!価格・買取目安が入る。
//
// 安全のための仕様:
// - 既存カードと id または「弾記号＋番号」が重複するものは追加しない
// - 楽天で「カード名・番号・弾記号」をすべて含む出品が min-hits 件以上あるカードだけを追加する（型番の誤りを防ぐ）
// - 追加するカードは販売「在庫なし」・買取目安 0（未設定）の状態で登録し、価格は update-prices に任せる

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cardDisplayName, cardSearchKeyword } from '../src/utils/cardFormat.ts';
import { moshimoClickUrl, moshimoImpressionUrl } from '../src/utils/moshimo.ts';
import { normalize } from './update-prices.js';
import { STANDARD_EXEMPT_NAMES, STANDARD_REGULATIONS } from '../src/consts.ts';
import { SHOPS, isShopEnabled } from '../src/config/affiliate.ts';

/** 現行スタンダードで使えるか（マークが H・I・J 等、または公式の例外リストのカード）。サイトはスタンダード専用 */
const isStandardLegal = (s) => STANDARD_REGULATIONS.includes(s.regulationMark) || STANDARD_EXEMPT_NAMES.includes(s.name);

const ROOT = new URL('../', import.meta.url);
const CARDS_PATH = fileURLToPath(new URL('src/data/cards.json', ROOT));
const ENV_PATH = fileURLToPath(new URL('.env', ROOT));
const API_URL = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
// 楽天APIの Origin/Referer。新APIはアプリ登録時の「許可されたWebサイト」と一致しないと 403 になるため、
// 楽天側には www 付き・www なし・Vercel のURLの3つを登録済み。本番のURLを送る
const RAKUTEN_ORIGIN_URL = 'https://www.pokeca-factory.com/';
const EXCLUDE = /オリパ|くじ|PSA|BGS|ARS|鑑定|BOX|未開封|英語|韓国|中国/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// カードごとの買取提携先（カーナベル）。src/config/affiliate.ts の SHOPS.kanabell.enabled が true のときだけ書き込む
// （false の間は買取リンクなしで登録し、画面では古本市場（ふるいち）の宅配買取に案内する）
const BUYBACK = isShopEnabled('kanabell')
  ? { buybackShop: SHOPS.kanabell.name, buybackUrl: SHOPS.kanabell.url, buybackImpressionUrl: SHOPS.kanabell.impressionUrl }
  : {};

function parseArgs(argv) {
  const get = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    seed: get('seed') ?? 'scripts/seed/meta-cards.json',
    minHits: Number(get('min-hits') ?? 3),
    dryRun: argv.includes('--dry-run'),
  };
}

/** 楽天で「名前 番号」を検索し、名前・番号・弾記号をすべて含む出品数を数える */
async function countMatches(card, { appId, accessKey }) {
  const params = new URLSearchParams({
    applicationId: appId,
    accessKey,
    keyword: `${card.name} ${card.cardNumber}`,
    hits: '30',
    availability: '0',
    formatVersion: '2',
  });
  const res = await fetch(`${API_URL}?${params}`, { headers: { Origin: new URL(RAKUTEN_ORIGIN_URL).origin, Referer: RAKUTEN_ORIGIN_URL } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.errors?.errorMessage ?? res.statusText}`);
  const name = normalize(card.name);
  const number = normalize(card.cardNumber);
  const code = normalize(card.expansionCode);
  return (body.Items ?? []).filter((it) => {
    const raw = (it.itemName ?? '').normalize('NFKC');
    const t = normalize(raw);
    return !EXCLUDE.test(raw) && t.includes(name) && t.includes(number) && t.includes(code);
  }).length;
}

function newCard(seed, now) {
  const { id, name, rarity, cardNumber, expansionCode, regulationMark } = seed;
  return {
    id,
    name,
    rarity,
    cardNumber,
    expansionCode,
    ...(regulationMark && { regulationMark }),
    imageUrl: '',
    salePrice: 0,
    saleInStock: false,
    saleShop: '楽天市場',
    saleUrl: moshimoClickUrl('rakuten', cardSearchKeyword(seed)),
    saleImpressionUrl: moshimoImpressionUrl('rakuten'),
    buybackPrice: 0, // update-prices が販売最安値の約62%を目安として自動設定する
    ...BUYBACK,
    updatedAt: now,
  };
}

async function main() {
  if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
  const appId = process.env.RAKUTEN_APP_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;
  if (!appId || !accessKey) {
    console.error('RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY を .env に設定してください。');
    process.exit(1);
  }
  const { seed, minHits, dryRun } = parseArgs(process.argv.slice(2));
  const seedCards = JSON.parse(await readFile(fileURLToPath(new URL(seed, ROOT)), 'utf8')).cards;
  const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
  const ids = new Set(cards.map((c) => c.id));
  const models = new Set(cards.map((c) => `${c.expansionCode} ${c.cardNumber}`.toUpperCase()));
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00';

  console.log(`シード: ${seed}（${seedCards.length}枚）${dryRun ? '（dry-run: 保存しません）' : ''}\n`);
  const added = [];
  for (const [i, s] of seedCards.entries()) {
    const label = `[${i + 1}/${seedCards.length}] ${cardDisplayName(s)}`;
    if (!/^[a-z0-9-]+$/.test(s.id ?? '')) {
      console.log(`${label}\n  ✗ id「${s.id}」が不正です（半角英小文字・数字・ハイフン）→ スキップ`);
      continue;
    }
    if (!isStandardLegal(s)) {
      console.log(`${label}\n  ✗ 現行スタンダード外（regulationMark: ${s.regulationMark ?? 'なし'}）のため追加しません（H・I・J または公式の例外リストのみ）`);
      continue;
    }
    if (ids.has(s.id) || models.has(`${s.expansionCode} ${s.cardNumber}`.toUpperCase())) {
      console.log(`${label}\n  - 登録済み → スキップ`);
      continue;
    }
    if (i > 0) await sleep(1500);
    try {
      const hits = await countMatches(s, { appId, accessKey });
      if (hits < minHits) {
        console.log(`${label}\n  ✗ 型番を確認できません（一致する出品 ${hits}件 < ${minHits}件）→ 追加しません`);
        continue;
      }
      added.push(newCard(s, now));
      ids.add(s.id);
      models.add(`${s.expansionCode} ${s.cardNumber}`.toUpperCase());
      console.log(`${label}\n  ✓ 一致する出品 ${hits}件 → 追加${s.regulationMark ? `（レギュ ${s.regulationMark}）` : ''}`);
    } catch (error) {
      console.log(`${label}\n  ✗ エラー: ${error.message} → 追加しません`);
    }
  }

  console.log(`\n追加: ${added.length}枚`);
  if (dryRun || added.length === 0) return;
  const next = [...cards, ...added];
  const tmp = `${CARDS_PATH}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  JSON.parse(await readFile(tmp, 'utf8'));
  await rename(tmp, CARDS_PATH);
  console.log(`保存しました。続けて価格を取得してください: npm run update-prices -- --ids=${added.map((c) => c.id).join(',')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
