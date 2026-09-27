// 楽天市場商品検索API・Yahoo!ショッピング商品検索API（v3）で各カードの販売最安値を取得し、src/data/cards.json を更新する
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
//   YAHOO_APP_ID        Yahoo!デベロッパーネットワークのClient ID（未設定なら Yahoo! の取得はスキップ）
//
// 安全のための仕様:
// - 検索キーワードは「${name} ${rarity} ${cardNumber} ポケカ」→ 該当なしなら「${name} ${rarity} ${cardNumber}」→「${name} ${cardNumber}」の順に再検索（src/utils/cardFormat.ts の cardSearchKeywords）
// - カード名とカード番号（例: 096/071）の両方を商品名に含む商品だけを候補にする（オリパ・鑑定品・傷有り等の状態難は除外）
// - 商品名に別の弾記号・別のレアリティだけが書かれた商品は除外する（同名・同番号の別の弾の出品を拾わないため。例: ノココッチ 057/071 の SV5K R と SV2P U）
// - 全キーワードで在庫のある該当商品がないカードは「在庫なし」（salePrice=0, saleInStock=false）にする
// - APIエラーのカードは一切変更しない
// - 価格・在庫・購入リンク・商品画像のいずれかに変化があったカードだけを更新する（変化がなければ updatedAt も変えない）
// - 販売側（salePrice / saleShop / saleUrl / saleImpressionUrl / updatedAt）と商品画像（imageUrl）以外の項目は変更しない
// - 商品画像は最安商品の1枚目を 300x300 に変換して保存。画像がない商品の場合は既存の imageUrl を維持する
// - 一時ファイルに書き出してから置き換えるため、途中で失敗しても cards.json が壊れない
// - API ごとに呼び出し間隔を空ける（楽天・Yahoo! とも 1.5秒。Yahoo! の 429 は 5→15→30秒待って再試行）
// - Yahoo! は yahooPrice（該当なしは null）/ yahooUrl（もしも経由）/ yahooUpdatedAt を更新する

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cardDisplayName, cardSearchKeyword, cardSearchKeywords } from '../src/utils/cardFormat.ts';
import { moshimoClickUrl, moshimoImpressionUrl, moshimoLinkUrl } from '../src/utils/moshimo.ts';

const CARDS_PATH = fileURLToPath(new URL('../src/data/cards.json', import.meta.url));
const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
const API_URL = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const SITE_URL = 'https://my-affiliate-site-phi.vercel.app/';
const WAIT_MS = 1500;
const SHOP_NAME = '楽天市場';

// シングルカード以外の商品（鑑定品・オリパ・サプライ・海外版など）を検索段階で除外
const NG_KEYWORDS = ['PSA', 'BGS', 'ARS', '鑑定', 'オリパ', 'スリーブ', 'プレイマット', 'ローダー', 'ジャンク', '英語版', '韓国版', '中国版'];
// 検索の除外語をすり抜けた商品も、商品名で再度除外する（オリパ・くじ等は「当たり」としてカード名と番号を含むため）
const EXCLUDE_TITLE = /オリパ|くじ|クジ|ガチャ|福袋|PSA|BGS|ARS|CGC|鑑定|スリーブ|プレイマット|ローダー|ジャンク|英語版|韓国版|中国版|簡体字|繁体字/i;
// 状態の悪さがタイトルに明記された出品（最安値として表示すると美品相場とかけ離れて誤解を招くため除外）。
// 「プレイ用」「Bランク」など一般的な中古表記は対象外。除外をやめる場合は EXCLUDE_DAMAGED を false にする
const EXCLUDE_DAMAGED = true;
const DAMAGED_TITLE = /傷有り|傷あり|キズ有|キズあり|状態難|難あり|訳あり|折れ|汚れあり|汚れ有|白欠け|Cランク|Dランク|ランクC|ランクD/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 全角・半角や大文字小文字の違いをそろえ、空白を除く */
export function normalize(text) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

// 商品名に書かれた弾記号（SV5K・M2a・S12a・SM4+ など）
const EXPANSION_CODE = /(?<![a-z0-9])(sv\d+[a-z]?|svp|m\d+[a-z]?|mc|mp|s\d+[a-z]?|sm\d+[a-z+]?)(?![a-z0-9])/gi;

/**
 * 商品名に別の弾の記号だけが書かれているか。
 * 同じカード名・同じ番号が別の弾にもある場合（例: ノココッチ 057/071 は SV5K と SV2P の両方にある）に、
 * 別の弾の出品を最安値として拾わないようにする。弾記号の書かれていない商品名は判定できないため対象外
 */
export function mentionsOtherExpansion(card, rawTitle) {
  const codes = [...rawTitle.normalize('NFKC').matchAll(EXPANSION_CODE)].map((m) => m[1].toUpperCase());
  return codes.length > 0 && !codes.includes(card.expansionCode.toUpperCase());
}

// 商品名に書かれたレアリティ記号（(U アンコモン)・[R]・/U/ など）
const RARITY_TOKEN = /(?<![A-Za-z])(MUR|FUR|SAR|SSR|CHR|ACE|RRR|UR|HR|SR|AR|RR|SA|R|U|C)(?![A-Za-z])/g;

/**
 * 商品名に別のレアリティだけが書かれているか。
 * 弾記号のない商品名でも、同番号の別の弾の出品（例: SV2P のノココッチ U）を除外できるようにする。
 * レアリティ表記のないカード（rarity「-」）や、商品名にレアリティが書かれていない場合は対象外
 */
export function mentionsOtherRarity(card, rawTitle) {
  const tokens = [...rawTitle.normalize('NFKC').matchAll(RARITY_TOKEN)].map((m) => m[1]);
  return card.rarity !== '-' && tokens.length > 0 && !tokens.includes(card.rarity);
}

/** 検索結果から、カード名とカード番号の両方を商品名に含む最安の商品を選ぶ（別の弾・別のレアリティと明記された商品は除く） */
export function pickCheapest(card, items) {
  const name = normalize(card.name);
  const number = normalize(card.cardNumber);
  const matches = items.filter((item) => {
    const rawTitle = item.itemName ?? '';
    const title = normalize(rawTitle);
    return (
      !EXCLUDE_TITLE.test(rawTitle.normalize('NFKC')) &&
      !(EXCLUDE_DAMAGED && DAMAGED_TITLE.test(rawTitle.normalize('NFKC'))) &&
      title.includes(name) &&
      number !== '' &&
      title.includes(number) &&
      !mentionsOtherExpansion(card, rawTitle) &&
      !mentionsOtherRarity(card, rawTitle) &&
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
const KEY_ORDER = ['id', 'name', 'rarity', 'cardNumber', 'expansionCode', 'regulationMark', 'imageUrl', 'salePrice', 'saleInStock', 'saleShop', 'saleUrl', 'saleImpressionUrl', 'yahooPrice', 'yahooUrl', 'yahooUpdatedAt', 'buybackPrice', 'buybackShop', 'buybackUrl', 'buybackImpressionUrl', 'substituteIds', 'updatedAt'];
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

/** API ごとに「前回の呼び出しから ms 以上」空けるスロットル（楽天・Yahoo! とも 1秒1回の制限を守る） */
function makeThrottle(ms) {
  let last = 0;
  return async () => {
    const wait = last + ms - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}
const rakutenThrottle = makeThrottle(WAIT_MS);
// Yahoo! は1秒1回に加えて短時間の合計回数でも 429 になる（実測で数十回連続すると拒否が続く）ため、間隔を広めに取る
const YAHOO_WAIT_MS = 1500;
const yahooThrottle = makeThrottle(YAHOO_WAIT_MS);
/** Yahoo! が 429 を返したときの待ち時間（再試行ごとに延ばす） */
const YAHOO_BACKOFF_MS = [5000, 15000, 30000];

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
    await rakutenThrottle();
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
 * 再検索の前にも1.5秒以上待機する（API負荷軽減）。
 */
async function findCheapest(card, credentials) {
  const tried = [];
  for (const [i, keyword] of cardSearchKeywords(card).entries()) {
    const items = await searchRakuten(keyword, credentials);
    tried.push(`「${keyword}」${items.length}件`);
    const best = pickCheapest(card, items);
    if (best) return { best, keyword, fallback: i > 0, tried };
  }
  return { best: undefined, tried };
}

const YAHOO_API_URL = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';

/**
 * Yahoo!ショッピング商品検索API（v3）。在庫ありの商品を価格の安い順に取得する。
 * results=1 だと最安の無関係商品（スリーブ・オリパ・別カード等）がそのまま入るため、複数件取得して pickCheapest で絞り込む。
 */
async function searchYahoo(keyword, appid) {
  const params = new URLSearchParams({ appid, query: keyword, sort: '+price', results: '30', in_stock: 'true' });
  for (let attempt = 0; attempt <= YAHOO_BACKOFF_MS.length; attempt++) {
    await yahooThrottle();
    const res = await fetch(`${YAHOO_API_URL}?${params}`);
    if (res.status === 429 && attempt < YAHOO_BACKOFF_MS.length) {
      // リクエスト過多：待ち時間を延ばしながら再試行
      await sleep(YAHOO_BACKOFF_MS[attempt]);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = body.Error?.Message ?? body.error?.message ?? res.statusText;
      throw new Error(`Yahoo HTTP ${res.status}: ${message}`);
    }
    // 楽天と同じ判定関数（pickCheapest）を使えるよう項目名をそろえる
    return (body.hits ?? [])
      .filter((h) => h.inStock !== false)
      .map((h) => ({ itemName: h.name ?? '', itemPrice: h.price, itemUrl: h.url, shopName: h.seller?.name ?? '' }));
  }
  throw new Error('Yahoo HTTP 429: リクエスト数の上限を超えました');
}

/** Yahoo!ショッピングで、楽天と同じキーワード候補・同じ判定条件の最安商品を探す */
async function findYahooCheapest(card, appid) {
  const tried = [];
  for (const keyword of cardSearchKeywords(card)) {
    const items = await searchYahoo(keyword, appid);
    tried.push(`「${keyword}」${items.length}件`);
    const best = pickCheapest(card, items);
    if (best) return { best, tried };
  }
  return { best: undefined, tried };
}

/** Yahoo!の取得結果を cards.json の項目に変換（該当なしは yahooPrice: null） */
export function yahooFields(best) {
  return best ? { yahooPrice: best.itemPrice, yahooUrl: moshimoLinkUrl('yahoo', best.itemUrl) } : { yahooPrice: null, yahooUrl: '' };
}

/**
 * 買取目安が未設定（0）のカードに、2大モールの販売最安値の約62%を目安として返す（端数は 1万円以上 500円・千円以上 100円・それ未満 10円単位で切り捨て）。
 * 販売在庫がない、または設定済みの場合は undefined。
 */
export function estimateBuyback(card) {
  if (card.buybackPrice !== 0) return undefined;
  const prices = [card.saleInStock && card.salePrice > 0 ? card.salePrice : null, typeof card.yahooPrice === 'number' && card.yahooPrice > 0 ? card.yahooPrice : null].filter(
    (p) => p !== null,
  );
  if (prices.length === 0) return undefined;
  const raw = Math.min(...prices) * 0.62;
  const unit = raw >= 10000 ? 500 : raw >= 1000 ? 100 : 10;
  const value = Math.floor(raw / unit) * unit;
  return value > 0 ? value : undefined;
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

  // Yahoo!ショッピングはキーがあるときだけ取得（未設定なら楽天のみ更新して続行）
  const yahooAppId = process.env.YAHOO_APP_ID;
  if (!yahooAppId) console.warn('⚠ YAHOO_APP_ID が未設定のため、Yahoo!ショッピングの価格取得をスキップします。');

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
  let yahooFailed = 0;
  let unchanged = 0;
  const yen = (n) => `¥${n.toLocaleString()}`;
  // 楽天・Yahoo! それぞれで価格・在庫・リンク等に変化があった項目だけを更新する（更新日時も変化した側のみ）
  for (const [i, card] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] ${cardDisplayName(card)}`;
    const lines = [label];
    let next = card;

    // ── 楽天市場 ──
    try {
      const { best, fallback, tried } = await findCheapest(card, { appId, accessKey });
      let rakuten;
      if (!best) {
        rakuten = markOutOfStock(card);
        lines.push(`  楽天  : 在庫のある該当商品なし（${tried.join(' → ')}）→「在庫なし」`);
      } else {
        if (fallback) lines.push(`  楽天  : ↻ フォールバック検索（${tried.join(' → ')}）`);
        let imageUrl = pickImageUrl(best);
        let imageNote = imageUrl ?? '（商品画像なし → 既存の値を維持）';
        if (imageUrl && !(await isImageAvailable(imageUrl))) {
          // 新しい画像が取得できない場合、既存の画像が有効ならそれを維持し、無効なら空にしてプレースホルダー表示にする
          const keepExisting = card.imageUrl !== '' && card.imageUrl !== imageUrl && (await isImageAvailable(card.imageUrl));
          imageNote = `（取得できない画像のため保存しません → ${keepExisting ? '既存の画像を維持' : 'プレースホルダー表示'}）`;
          imageUrl = keepExisting ? card.imageUrl : '';
        }
        rakuten = applySale(card, best, nowJst(), imageUrl);
        const before = card.saleInStock ? yen(card.salePrice) : '在庫なし';
        lines.push(`  楽天  : ${before} → ${yen(best.itemPrice)}（${best.shopName}）${best.itemName.slice(0, 50)}`, `          画像: ${imageNote}`);
      }
      if (hasMeaningfulChange(card, rakuten)) {
        next = { ...next, ...Object.fromEntries([...TRACKED_KEYS, 'updatedAt'].map((k) => [k, rakuten[k]])) };
      } else {
        lines.push('          = 楽天は変化なし');
      }
    } catch (error) {
      failed++;
      lines.push(`  楽天  : ✗ エラー: ${error.message} → 変更しません`);
    }

    // ── Yahoo!ショッピング ──
    if (yahooAppId) {
      try {
        const { best, tried } = await findYahooCheapest(card, yahooAppId);
        const fields = yahooFields(best);
        const before = typeof card.yahooPrice === 'number' ? yen(card.yahooPrice) : card.yahooPrice === null ? 'なし' : '未取得';
        lines.push(
          best
            ? `  Yahoo!: ${before} → ${yen(best.itemPrice)}（${best.shopName}）${best.itemName.slice(0, 50)}`
            : `  Yahoo!: ${before} → 在庫のある該当商品なし（${tried.join(' → ')}）`,
        );
        if (card.yahooPrice !== fields.yahooPrice || (card.yahooUrl ?? '') !== fields.yahooUrl) {
          next = { ...next, ...fields, yahooUpdatedAt: nowJst() };
        } else {
          lines.push('          = Yahoo!は変化なし');
        }
      } catch (error) {
        yahooFailed++;
        lines.push(`  Yahoo!: ✗ エラー: ${error.message} → 変更しません`);
      }
    }

    // 買取目安が未設定（0）のカード（add-cards で追加した直後など）は、販売最安値の約62%を目安として設定する
    const estimate = estimateBuyback(next);
    if (estimate !== undefined) {
      next = { ...next, buybackPrice: estimate };
      lines.push(`  買取  : 目安を設定 ¥${estimate.toLocaleString()}（販売最安値の約62%）`);
    }

    console.log(lines.join('\n'));
    if (next !== card) updated.set(card.id, next);
    else unchanged++;
  }

  console.log(
    `\n更新: ${updated.size}枚 / 変化なし: ${unchanged}枚 / 楽天エラー: ${failed}枚${yahooAppId ? ` / Yahoo!エラー: ${yahooFailed}枚` : '（Yahoo!はスキップ）'}`,
  );
  // 全件エラー（キーの失効・API障害など）は異常終了にして、GitHub Actions の失敗通知で気づけるようにする
  if (targets.length > 0 && (failed === targets.length || (yahooAppId && yahooFailed === targets.length))) process.exitCode = 1;
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
