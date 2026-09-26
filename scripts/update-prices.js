// 楽天市場商品検索APIで各カードの販売最安値を取得し、src/data/cards.json を更新する
//
// 使い方:
//   npm run update-prices                         全カードを更新
//   npm run update-prices -- --ids=id1,id2        指定したカードだけ更新
//   npm run update-prices -- --limit=2            先頭から2枚だけ更新
//   npm run update-prices -- --dry-run            取得結果を表示するだけで保存しない
//
// 必要な環境変数（.env に記載。.env は Git 管理外）:
//   RAKUTEN_APP_ID      楽天ウェブサービスのアプリID
//   RAKUTEN_ACCESS_KEY  楽天ウェブサービスのアクセスキー
//
// 安全のための仕様:
// - 検索キーワードは「${name} ${rarity} ${cardNumber} ポケカ」（src/utils/cardFormat.ts の cardSearchKeyword）
// - カード名とカード番号（例: 096/071）の両方を商品名に含む商品だけを候補にする
// - 候補が見つからない・APIエラーのカードは一切変更しない
// - 販売側（salePrice / saleShop / saleUrl / saleImpressionUrl / updatedAt）以外の項目は変更しない
// - 一時ファイルに書き出してから置き換えるため、途中で失敗しても cards.json が壊れない
// - 1カードごとに1秒待機する

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cardDisplayName, cardSearchKeyword } from '../src/utils/cardFormat.ts';
import { moshimoImpressionUrl, moshimoLinkUrl } from '../src/utils/moshimo.ts';

const CARDS_PATH = fileURLToPath(new URL('../src/data/cards.json', import.meta.url));
const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
const API_URL = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const SITE_URL = 'https://my-affiliate-site-phi.vercel.app/';
const WAIT_MS = 1000;
const SHOP_NAME = '楽天市場';

// シングルカード以外の商品（鑑定品・オリパ・サプライ・海外版など）を検索段階で除外
const NG_KEYWORDS = ['PSA', 'BGS', 'ARS', '鑑定', 'オリパ', 'スリーブ', 'プレイマット', 'ローダー', 'ジャンク', '英語版', '韓国版', '中国版'];
// 検索の除外語をすり抜けた商品も、商品名で再度除外する（オリパ・くじ等は「当たり」としてカード名と番号を含むため）
const EXCLUDE_TITLE = /オリパ|くじ|クジ|ガチャ|福袋|PSA|BGS|ARS|CGC|鑑定|スリーブ|プレイマット|ローダー|ジャンク|英語版|韓国版|中国版|簡体字|繁体字/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 全角・半角や大文字小文字の違いをそろえ、空白を除く */
export function normalize(text) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** 検索結果から、カード名とカード番号の両方を商品名に含む最安の商品を選ぶ */
export function pickCheapest(card, items) {
  const name = normalize(card.name);
  const number = normalize(card.cardNumber);
  const matches = items.filter((item) => {
    const rawTitle = item.itemName ?? '';
    const title = normalize(rawTitle);
    return (
      !EXCLUDE_TITLE.test(rawTitle.normalize('NFKC')) &&
      title.includes(name) &&
      number !== '' &&
      title.includes(number) &&
      Number.isFinite(item.itemPrice) &&
      item.itemPrice > 0
    );
  });
  if (matches.length === 0) return undefined;
  return matches.reduce((min, item) => (item.itemPrice < min.itemPrice ? item : min));
}

/** 現在時刻を「2026-09-27T10:00:00+09:00」形式（日本時間）で返す */
export function nowJst(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}

/** 販売側の項目だけを差し替えたカードを返す（買取・画像などはそのまま） */
export function applySale(card, item, updatedAt = nowJst()) {
  return {
    ...card,
    salePrice: item.itemPrice,
    saleShop: SHOP_NAME,
    saleUrl: moshimoLinkUrl('rakuten', item.itemUrl),
    saleImpressionUrl: moshimoImpressionUrl('rakuten'),
    updatedAt,
  };
}

async function searchRakuten(card, { appId, accessKey }) {
  const params = new URLSearchParams({
    applicationId: appId,
    accessKey,
    keyword: cardSearchKeyword(card),
    NGKeyword: NG_KEYWORDS.join(' '),
    sort: '+itemPrice',
    hits: '30',
    availability: '1',
    formatVersion: '2',
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    // 新APIはアプリ登録時の「許可されたWebサイト」と一致する Origin ヘッダーが必須（ないと 403）
    const res = await fetch(`${API_URL}?${params}`, { headers: { Origin: new URL(SITE_URL).origin, Referer: SITE_URL } });
    if (res.status === 429 && attempt === 1) {
      // リクエスト過多：少し待って1回だけ再試行
      await sleep(WAIT_MS * 3);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = body.errors?.errorMessage ?? body.error_description ?? body.error ?? res.statusText;
      throw new Error(`HTTP ${res.status}: ${message}`);
    }
    // formatVersion=2 の商品一覧は「Items」（旧形式の { item: {...} } 包みにも対応）
    const list = body.Items ?? body.items ?? [];
    return list.map((entry) => entry.Item ?? entry.item ?? entry);
  }
  throw new Error('HTTP 429: リクエスト数の上限を超えました');
}

function parseArgs(argv) {
  const get = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    ids: get('ids')?.split(',').filter(Boolean),
    limit: get('limit') ? Number(get('limit')) : undefined,
    dryRun: argv.includes('--dry-run'),
  };
}

async function main() {
  if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
  const appId = process.env.RAKUTEN_APP_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;
  if (!appId || !accessKey) {
    console.error('RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY を .env に設定してください（.env.example を参照）。');
    process.exit(1);
  }

  const { ids, limit, dryRun } = parseArgs(process.argv.slice(2));
  const raw = await readFile(CARDS_PATH, 'utf8');
  const cards = JSON.parse(raw);

  let targets = ids ? cards.filter((c) => ids.includes(c.id)) : cards;
  if (limit !== undefined) targets = targets.slice(0, limit);
  if (ids) {
    const unknown = ids.filter((id) => !cards.some((c) => c.id === id));
    if (unknown.length) console.warn(`⚠ 見つからないID: ${unknown.join(', ')}`);
  }
  console.log(`対象: ${targets.length}枚${dryRun ? '（dry-run: 保存しません）' : ''}\n`);

  const updated = new Map();
  let failed = 0;
  for (const [i, card] of targets.entries()) {
    if (i > 0) await sleep(WAIT_MS);
    const label = `[${i + 1}/${targets.length}] ${cardDisplayName(card)}`;
    try {
      const items = await searchRakuten(card, { appId, accessKey });
      const best = pickCheapest(card, items);
      if (!best) {
        console.log(`${label}\n  - 該当商品なし（検索結果 ${items.length}件）→ 変更しません`);
        continue;
      }
      updated.set(card.id, applySale(card, best));
      console.log(`${label}\n  ✓ ¥${card.salePrice.toLocaleString()} → ¥${best.itemPrice.toLocaleString()}（${best.shopName}）\n    ${best.itemName}`);
    } catch (error) {
      failed++;
      console.log(`${label}\n  ✗ エラー: ${error.message} → 変更しません`);
    }
  }

  console.log(`\n更新: ${updated.size}枚 / 該当なし: ${targets.length - updated.size - failed}枚 / エラー: ${failed}枚`);
  if (dryRun || updated.size === 0) return;

  const next = cards.map((c) => updated.get(c.id) ?? c);
  const tmp = `${CARDS_PATH}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  JSON.parse(await readFile(tmp, 'utf8')); // 書き出した内容が正しい JSON か確認
  await rename(tmp, CARDS_PATH);
  console.log(`保存しました: ${CARDS_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
