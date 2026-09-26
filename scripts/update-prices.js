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
// - 検索キーワードは「${name} ${rarity} ${cardNumber} ポケカ」→ 該当なしなら「${name} ${rarity} ${cardNumber}」→「${name} ${cardNumber}」の順に再検索（src/utils/cardFormat.ts の cardSearchKeywords）
// - カード名とカード番号（例: 096/071）の両方を商品名に含む商品だけを候補にする
// - 全キーワードで在庫のある該当商品がないカードは「在庫なし」（salePrice=0, saleInStock=false）にする
// - APIエラーのカードは一切変更しない
// - 価格・在庫・購入リンク・商品画像のいずれかに変化があったカードだけを更新する（変化がなければ updatedAt も変えない）
// - 販売側（salePrice / saleShop / saleUrl / saleImpressionUrl / updatedAt）と商品画像（imageUrl）以外の項目は変更しない
// - 商品画像は最安商品の1枚目を 300x300 に変換して保存。画像がない商品の場合は既存の imageUrl を維持する
// - 一時ファイルに書き出してから置き換えるため、途中で失敗しても cards.json が壊れない
// - 1カードごとに1秒待機する

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cardDisplayName, cardSearchKeyword, cardSearchKeywords } from '../src/utils/cardFormat.ts';
import { moshimoClickUrl, moshimoImpressionUrl, moshimoLinkUrl } from '../src/utils/moshimo.ts';

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
export function applySale(card, item, updatedAt = nowJst(), imageUrl = pickImageUrl(item)) {
  return {
    ...card,
    // 商品画像が取れなかった場合は既存の画像URLを維持する
    imageUrl: imageUrl ?? card.imageUrl,
    salePrice: item.itemPrice,
    saleInStock: true,
    saleShop: SHOP_NAME,
    saleUrl: moshimoLinkUrl('rakuten', item.itemUrl),
    saleImpressionUrl: moshimoImpressionUrl('rakuten'),
    updatedAt,
  };
}

/**
 * 楽天市場に在庫のある該当商品がないカードを「在庫なし」にする。
 * 古い・架空の販売価格を残さないよう salePrice は 0 にし、購入ボタンは楽天市場の検索結果（もしも経由）へ向ける。
 */
export function markOutOfStock(card, updatedAt = nowJst()) {
  return {
    ...card,
    salePrice: 0,
    saleInStock: false,
    saleShop: SHOP_NAME,
    saleUrl: moshimoClickUrl('rakuten', cardSearchKeyword(card)),
    saleImpressionUrl: moshimoImpressionUrl('rakuten'),
    updatedAt,
  };
}

/** 変化を判定する項目（価格・在庫・購入リンク・商品画像）。updatedAt は含めない */
const TRACKED_KEYS = ['salePrice', 'saleInStock', 'saleShop', 'saleUrl', 'saleImpressionUrl', 'imageUrl'];

/** 取得結果に意味のある変化があるか（変化がなければ updatedAt も含めて書き換えない） */
export function hasMeaningfulChange(before, after) {
  return TRACKED_KEYS.some((key) => before[key] !== after[key]);
}

/** cards.json の項目の並び順（書き出し時にそろえる） */
const KEY_ORDER = ['id', 'name', 'rarity', 'cardNumber', 'expansionCode', 'regulationMark', 'imageUrl', 'salePrice', 'saleInStock', 'saleShop', 'saleUrl', 'saleImpressionUrl', 'buybackPrice', 'buybackShop', 'buybackUrl', 'buybackImpressionUrl', 'substituteIds', 'updatedAt'];
const orderKeys = (card) => Object.fromEntries([...KEY_ORDER.filter((k) => k in card), ...Object.keys(card).filter((k) => !KEY_ORDER.includes(k))].map((k) => [k, card[k]]));

/** 保存する画像サイズ（楽天のサムネイルサーバーは ?_ex=幅x高さ で縮小画像を返す） */
export const IMAGE_SIZE = '300x300';

/**
 * 商品の1枚目の画像URLを、表示に十分な解像度（300x300）に変換して返す。
 * API の mediumImageUrls は ?_ex=128x128（formatVersion=2 は文字列、1 は { imageUrl } の配列）。
 */
export function pickImageUrl(item) {
  const first = item.mediumImageUrls?.[0] ?? item.smallImageUrls?.[0];
  const raw = typeof first === 'string' ? first : first?.imageUrl;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return undefined;
    if (url.hostname === 'thumbnail.image.rakuten.co.jp') url.searchParams.set('_ex', IMAGE_SIZE);
    return url.toString();
  } catch {
    return undefined;
  }
}

/** 画像URLが実際に画像を返すか確認する（API が存在しない画像のURLを返すことがあるため） */
async function isImageAvailable(url) {
  try {
    const res = await fetch(url);
    const type = res.headers.get('content-type') ?? '';
    await res.body?.cancel();
    return res.ok && type.startsWith('image/');
  } catch {
    return false;
  }
}

async function searchRakuten(keyword, { appId, accessKey }) {
  const params = new URLSearchParams({
    applicationId: appId,
    accessKey,
    keyword,
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

/**
 * キーワード候補（cardSearchKeywords）を順に試し、カード名・番号が一致する最安商品が見つかった時点で返す。
 * 再検索の前にも1秒待機する（API負荷軽減）。
 */
async function findCheapest(card, credentials) {
  const tried = [];
  for (const [i, keyword] of cardSearchKeywords(card).entries()) {
    if (i > 0) await sleep(WAIT_MS);
    const items = await searchRakuten(keyword, credentials);
    tried.push(`「${keyword}」${items.length}件`);
    const best = pickCheapest(card, items);
    if (best) return { best, keyword, fallback: i > 0, tried };
  }
  return { best: undefined, tried };
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
  let unchanged = 0;
  // 価格・在庫・リンク・画像のいずれかが変わったカードだけを更新する（updatedAt も変化時のみ更新）
  const record = (card, next, message) => {
    if (hasMeaningfulChange(card, next)) {
      updated.set(card.id, next);
      console.log(message);
    } else {
      unchanged++;
      console.log(`${message}\n  = 変化なし → 変更しません`);
    }
  };
  for (const [i, card] of targets.entries()) {
    if (i > 0) await sleep(WAIT_MS);
    const label = `[${i + 1}/${targets.length}] ${cardDisplayName(card)}`;
    try {
      const { best, fallback, tried } = await findCheapest(card, { appId, accessKey });
      if (!best) {
        record(card, markOutOfStock(card), `${label}\n  - 在庫のある該当商品なし（${tried.join(' → ')}）→「在庫なし」`);
        continue;
      }
      if (fallback) console.log(`${label}\n  ↻ フォールバック検索で取得（${tried.join(' → ')}）`);
      let imageUrl = pickImageUrl(best);
      let imageNote = imageUrl ?? '（商品画像なし → 既存の値を維持）';
      if (imageUrl && !(await isImageAvailable(imageUrl))) {
        // 新しい画像が取得できない場合、既存の画像が有効ならそれを維持し、無効なら空にしてプレースホルダー表示にする
        const keepExisting = card.imageUrl !== '' && card.imageUrl !== imageUrl && (await isImageAvailable(card.imageUrl));
        imageNote = `（取得できない画像のため保存しません → ${keepExisting ? '既存の画像を維持' : 'プレースホルダー表示'}）`;
        imageUrl = keepExisting ? card.imageUrl : '';
      }
      const before = card.saleInStock ? `¥${card.salePrice.toLocaleString()}` : '在庫なし';
      record(
        card,
        applySale(card, best, nowJst(), imageUrl),
        `${label}\n  ✓ ${before} → ¥${best.itemPrice.toLocaleString()}（${best.shopName}）\n    ${best.itemName}\n    画像: ${imageNote}`,
      );
    } catch (error) {
      failed++;
      console.log(`${label}\n  ✗ エラー: ${error.message} → 変更しません`);
    }
  }

  console.log(`\n更新: ${updated.size}枚 / 変化なし: ${unchanged}枚 / エラー（変更なし）: ${failed}枚`);
  // 全件エラー（キーの失効・API障害など）は異常終了にして、GitHub Actions の失敗通知で気づけるようにする
  if (targets.length > 0 && failed === targets.length) process.exitCode = 1;
  if (dryRun || updated.size === 0) return;

  const next = cards.map((c) => orderKeys(updated.get(c.id) ?? c));
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
