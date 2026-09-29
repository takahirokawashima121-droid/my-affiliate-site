// 楽天市場商品検索API・Yahoo!ショッピング商品検索API（v3）で各カードの販売最安値を取得し、src/data/cards.json を更新する
//
// 使い方:
//   npm run update-prices                         更新時期が来たカードを優先度順に更新（下の「差分更新」）
//   npm run update-prices -- --all                全カードを更新
//   npm run update-prices -- --budget=210         210秒たったら新しいカードの取得を始めない（残りは次回。GitHub Actions で使用）
//   npm run update-prices -- --ids=id1,id2        指定したカードだけ更新（時期・上限に関係なく必ず取得）
//   npm run update-prices -- --limit=2            先頭から2枚だけ更新
//   npm run update-prices -- --dry-run            取得結果を表示するだけで保存しない
//
// 差分更新（--ids / --all 以外）:
// - 前回の確認日時（.cache/price-checks.json。GitHub Actions ではキャッシュで引き継ぐ）と updatedAt の新しい方から、
//   優先カード（環境Tier1〜2のデッキ・新着のデッキ記事12本のレシピに入っているカード）は約1日（20時間）、それ以外は約2日（44時間）
//   たったものだけを取得する
// - 更新間隔に対する遅れが大きいものから取得する。--budget の時間を過ぎたら打ち切り、残りは次回に回す
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
// - 商品画像は、宣伝帯を焼き込む出品者（BANNER_IMAGE_SHOP_CODES）を除いた最安商品の1枚目を 300x300 に変換して保存。
//   該当する商品がなければ既存のクリーンな画像を維持し、画像がない商品の場合も既存の imageUrl を維持する
// - 一時ファイルに書き出してから置き換えるため、途中で失敗しても cards.json が壊れない
// - API ごとに呼び出し間隔を空ける（楽天 1.05秒・Yahoo! 2.5秒。2つの API は別々の制限のため同じカードを並行して取得する。
//   Yahoo! の 429 は3秒待って1回だけ再試行し、それでも拒否されたら60秒間 Yahoo! を休む（そのあいだのカードは次回取り直す））
// - Yahoo! は yahooPrice（該当なしは null）/ yahooUrl（もしも経由）/ yahooUpdatedAt を更新する

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardDisplayName, cardSearchKeyword, cardSearchKeywords } from '../src/utils/cardFormat.ts';
import { moshimoClickUrl, moshimoImpressionUrl, moshimoLinkUrl } from '../src/utils/moshimo.ts';
import { TIER_LIST } from '../src/data/tier.ts';

const CARDS_PATH = fileURLToPath(new URL('../src/data/cards.json', import.meta.url));
const COLUMNS_PATH = fileURLToPath(new URL('../src/data/deck-columns.json', import.meta.url));
const DECKS_PATH = fileURLToPath(new URL('../src/data/official-decks.json', import.meta.url));
/** カードごとの前回の確認日時（Git 管理外。GitHub Actions では actions/cache で次回に引き継ぐ） */
const CHECKS_PATH = fileURLToPath(new URL('../.cache/price-checks.json', import.meta.url));
/**
 * 更新間隔：優先カードは毎日（20時間。毎日同じ時刻の実行で「24時間に数分足りない」ために1日飛ばさないよう短めにする）、
 * それ以外は約2日（44時間）ごと
 */
const PRIORITY_INTERVAL_MS = 20 * 3600e3;
const ROTATION_INTERVAL_MS = 44 * 3600e3;
/** 「注目カード」とみなす新着デッキ記事の数（トップページの特集に載る最新の記事） */
const FEATURED_COLUMNS = 12;
const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
const API_URL = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
// 楽天APIの Origin/Referer。新APIはアプリ登録時の「許可されたWebサイト」と一致しないと 403 になるため、
// 楽天側に www.pokeca-factory.com を登録するまでは登録済みの Vercel のURLのままにする
const RAKUTEN_ORIGIN_URL = 'https://my-affiliate-site-phi.vercel.app/';
/** 楽天の呼び出し間隔（楽天ウェブサービスの上限は1秒1回。わずかに余裕を持たせる） */
const WAIT_MS = 1050;
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

/** 検索結果から、カード名とカード番号の両方を商品名に含む商品を返す（別の弾・別のレアリティと明記された商品・除外語を含む商品は除く） */
export function matchingItems(card, items) {
  const name = normalize(card.name);
  const number = normalize(card.cardNumber);
  return items.filter((item) => {
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
}

/** 該当商品のうち最安の商品を選ぶ */
export function pickCheapest(card, items) {
  const matches = matchingItems(card, items);
  if (matches.length === 0) return undefined;
  return matches.reduce((min, item) => (item.itemPrice < min.itemPrice ? item : min));
}

/** 現在時刻を「2026-09-27T10:00:00+09:00」形式（日本時間）で返す */
export function nowJst(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}

/**
 * 楽天の商品URLから計測用のパラメータを取り除く。
 * API が返す itemUrl には「?rafcid=wsc_i_is_{アプリID}」が付くため、そのまま保存するとアプリIDがサイト・リポジトリに公開される。
 * 購入リンクの計測はもしもアフィリエイトで行うので、このパラメータは不要
 */
export function cleanItemUrl(itemUrl) {
  try {
    const url = new URL(itemUrl);
    url.searchParams.delete('rafcid');
    return url.toString();
  } catch {
    return itemUrl;
  }
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
    saleUrl: moshimoLinkUrl('rakuten', cleanItemUrl(item.itemUrl)),
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
  // Yahoo!の商品は searchYahoo で imageUrl（300x300）に変換済み
  const first = item.mediumImageUrls?.[0] ?? item.smallImageUrls?.[0] ?? item.imageUrl;
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

/**
 * 商品画像に「送料無料」の文字帯やショップロゴを大きく焼き込んでいる出品者。
 * カードの代表画像（imageUrl）には使わない（価格・購入リンクの判定には影響しない）。
 * 楽天のショップコード（商品URL・画像URLの /@0_mall/{code}/ の部分）と、ショップ名で判定する
 */
export const BANNER_IMAGE_SHOP_CODES = ['card-museum', 'cardmuseum'];
const BANNER_IMAGE_SHOP_NAME = /カードミュージアム|card\s*-?\s*museum/i;

/** 楽天の画像URL・商品URL、Yahoo!の画像URL（/i/j/{ストアID}_{商品コード}）からショップコードを取り出す */
function shopCodeOf(url) {
  return (
    url?.match(/@0_mall\/([^/?#]+)\//)?.[1] ??
    url?.match(/item\.rakuten\.co\.jp\/([^/?#]+)\//)?.[1] ??
    url?.match(/item-shopping\.c\.yimg\.jp\/i\/[a-z]\/([^_/?#]+)_/)?.[1]
  );
}

/** 宣伝帯入りの画像URLか（既存の imageUrl の判定にも使う） */
export function isBannerImageUrl(url) {
  return BANNER_IMAGE_SHOP_CODES.includes(shopCodeOf(url) ?? '');
}

/** 商品画像に宣伝帯を焼き込んでいる出品者の商品か */
export function isBannerImageItem(item) {
  const code = item.shopCode ?? shopCodeOf(item.itemUrl) ?? shopCodeOf(pickImageUrl(item));
  return BANNER_IMAGE_SHOP_CODES.includes(code ?? '') || BANNER_IMAGE_SHOP_NAME.test(item.shopName ?? '');
}

/**
 * カードの代表画像に使う商品を選ぶ。価格の最安ではなく「宣伝帯のない出品者のうち最も安い商品」を優先する
 * （安い順に見ていき、画像のある最初のクリーンな商品）。クリーンな商品がなければ undefined
 */
export function pickCleanImageItem(matches) {
  return [...matches].sort((a, b) => a.itemPrice - b.itemPrice).find((item) => !isBannerImageItem(item) && pickImageUrl(item));
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
// Yahoo! は1秒1回に加えて1分あたりの合計回数でも 429 になる（実測で2秒間隔 = 毎分30回でも約30回で拒否が始まる）ため、
// 毎分24回（2.5秒間隔）に抑える
const YAHOO_WAIT_MS = 2500;
const yahooThrottle = makeThrottle(YAHOO_WAIT_MS);
/** Yahoo! が 429 を返したときの待ち時間（1回だけ再試行する） */
const YAHOO_BACKOFF_MS = [3000];
/** 再試行しても 429 のときは、この時間 Yahoo! の取得を休む（待たずに飛ばす。飛ばしたカードは次回取り直す） */
const YAHOO_COOLDOWN_MS = 60000;
let yahooCooldownUntil = 0;
/** Yahoo! を休んでいるあいだに飛ばしたことを表すエラー（取得失敗とは区別する） */
class YahooSkipped extends Error {}

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
    const res = await fetch(`${API_URL}?${params}`, { headers: { Origin: new URL(RAKUTEN_ORIGIN_URL).origin, Referer: RAKUTEN_ORIGIN_URL } });
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
    const matches = matchingItems(card, items);
    const best = pickCheapest(card, items);
    if (best) return { best, matches, keyword, fallback: i > 0, tried };
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
    if (Date.now() < yahooCooldownUntil) throw new YahooSkipped('Yahoo!の呼び出し制限のため休止中');
    await yahooThrottle();
    const res = await fetch(`${YAHOO_API_URL}?${params}`);
    if (res.status === 429) {
      if (attempt < YAHOO_BACKOFF_MS.length) {
        // リクエスト過多：少し待って再試行
        await sleep(YAHOO_BACKOFF_MS[attempt]);
        continue;
      }
      // 再試行しても拒否される：しばらく Yahoo! を休み、そのあいだのカードは待たずに飛ばす
      yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
      throw new YahooSkipped(`Yahoo!の呼び出し制限（429）のため ${YAHOO_COOLDOWN_MS / 1000}秒休止`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = body.Error?.Message ?? body.error?.message ?? res.statusText;
      throw new Error(`Yahoo HTTP ${res.status}: ${message}`);
    }
    // 楽天と同じ判定関数（pickCheapest）を使えるよう項目名をそろえる
    return (body.hits ?? [])
      .filter((h) => h.inStock !== false)
      .map((h) => ({ itemName: h.name ?? '', itemPrice: h.price, itemUrl: h.url, shopName: h.seller?.name ?? '', imageUrl: yahooImageUrl(h.image?.medium) }));
  }
  throw new Error('Yahoo HTTP 429: リクエスト数の上限を超えました');
}

/**
 * Yahoo!の商品画像URLを 300x300 に変換する（API の image.medium は /i/g/ = 146x146。/i/j/ = 300x300、/i/l/ = 600x600）
 */
export function yahooImageUrl(url) {
  if (!url?.startsWith('https://item-shopping.c.yimg.jp/i/')) return undefined;
  return url.replace(/\/i\/[a-z]\//, '/i/j/');
}

/** Yahoo!ショッピングで、楽天と同じキーワード候補・同じ判定条件の最安商品を探す */
async function findYahooCheapest(card, appid) {
  const tried = [];
  for (const keyword of cardSearchKeywords(card)) {
    const items = await searchYahoo(keyword, appid);
    tried.push(`「${keyword}」${items.length}件`);
    const best = pickCheapest(card, items);
    if (best) return { best, matches: matchingItems(card, items), tried };
  }
  return { best: undefined, matches: [], tried };
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
    all: argv.includes('--all'),
    budgetMs: get('budget') ? Number(get('budget')) * 1000 : undefined,
  };
}

const readJsonFile = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback);

/** 優先して毎日更新するカード：環境Tier1〜2のデッキと、新着のデッキ記事（最新 FEATURED_COLUMNS 本）のレシピに入っているカード */
async function priorityCardIds() {
  const columns = await readJsonFile(COLUMNS_PATH, []);
  const recipes = await readJsonFile(DECKS_PATH, {});
  const tierSlugs = new Set(TIER_LIST.tiers.filter((t) => t.rank <= 2).flatMap((t) => t.decks.map((d) => d.slug)));
  // 新着の記事：公開日の新しい順（同じ日は deck-columns.json で後ろにあるほど新しい）
  const featured = columns
    .map((c, order) => ({ c, order }))
    .sort((a, b) => b.c.pubDate.localeCompare(a.c.pubDate) || b.order - a.order)
    .slice(0, FEATURED_COLUMNS)
    .map(({ c }) => c.slug);
  const deckKeys = columns.filter((c) => tierSlugs.has(c.slug) || featured.includes(c.slug)).map((c) => c.deckKey);
  return new Set(deckKeys.flatMap((key) => (recipes[key]?.cards ?? []).map((e) => e.cardId).filter(Boolean)));
}

/**
 * 更新時期が来たカードを、更新間隔に対する経過の割合（遅れ）が大きい順に返す。優先カードは間隔が短いぶん先に来やすいが、
 * それ以外のカードも遅れが大きくなれば先に来るため、1回で取り切れない日が続いても取り残されない。
 * 前回の確認日時は checks（取得したがどの項目も変わらなかった場合も記録）と updatedAt・yahooUpdatedAt の最も新しいもの
 */
export function scheduleCards(cards, checks, priority, now = Date.now()) {
  const lastChecked = (c) => Math.max(Date.parse(checks[c.id] ?? '') || 0, Date.parse(c.updatedAt ?? '') || 0, Date.parse(c.yahooUpdatedAt ?? '') || 0);
  return cards
    .map((c) => ({ c, lag: (now - lastChecked(c)) / (priority.has(c.id) ? PRIORITY_INTERVAL_MS : ROTATION_INTERVAL_MS) }))
    .filter(({ lag }) => lag >= 1)
    .sort((a, b) => b.lag - a.lag)
    .map(({ c }) => c);
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

  const { ids, limit, dryRun, all, budgetMs } = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const raw = await readFile(CARDS_PATH, 'utf8');
  const cards = JSON.parse(raw);
  const checks = await readJsonFile(CHECKS_PATH, {});

  // --ids / --all 以外は、更新時期が来たカードだけを優先度順に取得する（差分更新）
  const scheduled = !ids && !all;
  let targets = ids ? cards.filter((c) => ids.includes(c.id)) : all ? cards : scheduleCards(cards, checks, await priorityCardIds(), startedAt);
  if (limit !== undefined) targets = targets.slice(0, limit);
  if (ids) {
    const unknown = ids.filter((id) => !cards.some((c) => c.id === id));
    if (unknown.length) console.warn(`⚠ 見つからないID: ${unknown.join(', ')}`);
  }
  console.log(
    `対象: ${targets.length}枚${scheduled ? `（全${cards.length}枚のうち更新時期が来たカード）` : ''}${budgetMs ? `・時間の上限 ${budgetMs / 1000}秒` : ''}${dryRun ? '（dry-run: 保存しません）' : ''}\n`,
  );

  const updated = new Map();
  let failed = 0;
  let yahooFailed = 0;
  let unchanged = 0;
  let checked = 0;
  let yahooSkipped = 0;
  const yen = (n) => `¥${n.toLocaleString()}`;
  // 楽天・Yahoo! それぞれで価格・在庫・リンク等に変化があった項目だけを更新する（更新日時も変化した側のみ）
  for (const [i, card] of targets.entries()) {
    // 時間の上限（--budget）を過ぎたら新しいカードは始めない。残りは確認日時が古いまま残るので、次回の先頭で取得される
    if (budgetMs && !ids && Date.now() - startedAt > budgetMs) {
      console.log(`\n⏱ 時間の上限（${budgetMs / 1000}秒）に達したため打ち切り、残り ${targets.length - i}枚は次回に回します`);
      break;
    }
    checked++;
    const label = `[${i + 1}/${targets.length}] ${cardDisplayName(card)}`;
    const lines = [label];
    let next = card;
    // 楽天と Yahoo! は別々の呼び出し制限のため並行して取得する（Yahoo! の結果は楽天の処理のあとで使う）
    const yahooResult = yahooAppId ? findYahooCheapest(card, yahooAppId).then((value) => ({ value }), (error) => ({ error })) : null;
    let rakutenOk = false;
    let yahooOk = !yahooAppId;

    // ── 楽天市場 ──
    try {
      const { best, matches, fallback, tried } = await findCheapest(card, { appId, accessKey });
      let rakuten;
      if (!best) {
        rakuten = markOutOfStock(card);
        lines.push(`  楽天  : 在庫のある該当商品なし（${tried.join(' → ')}）→「在庫なし」`);
      } else {
        if (fallback) lines.push(`  楽天  : ↻ フォールバック検索（${tried.join(' → ')}）`);
        // 代表画像：宣伝帯のない出品者の商品を優先。なければ既存のクリーンな画像を維持し、それもなければ最安商品の画像
        const imageItem = pickCleanImageItem(matches);
        const keepCleanExisting = !imageItem && card.imageUrl !== '' && !isBannerImageUrl(card.imageUrl);
        let imageUrl = imageItem ? pickImageUrl(imageItem) : keepCleanExisting ? card.imageUrl : pickImageUrl(best);
        let imageNote = imageUrl
          ? `${imageUrl}${imageItem && imageItem !== best ? `（宣伝帯のない ${imageItem.shopName} の画像）` : keepCleanExisting ? '（クリーンな画像がないため既存の画像を維持）' : ''}`
          : '（商品画像なし → 既存の値を維持）';
        // 画像が前回と同じなら確認済みなので、取得できるかの確認（画像のダウンロード）は省く
        if (imageUrl && imageUrl !== card.imageUrl && !(await isImageAvailable(imageUrl))) {
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
      rakutenOk = true;
    } catch (error) {
      failed++;
      lines.push(`  楽天  : ✗ エラー: ${error.message} → 変更しません`);
    }

    // ── Yahoo!ショッピング ──
    if (yahooResult) {
      try {
        const { value, error } = await yahooResult;
        if (error) throw error;
        const { best, matches, tried } = value;
        const fields = yahooFields(best);
        // 楽天に宣伝帯のない画像がなかった（代表画像が宣伝帯入り・または空の）カードは、Yahoo!のクリーンな商品画像に差し替える
        if (next.imageUrl === '' || isBannerImageUrl(next.imageUrl)) {
          const imageItem = pickCleanImageItem(matches);
          if (imageItem && (await isImageAvailable(imageItem.imageUrl))) {
            next = { ...next, imageUrl: imageItem.imageUrl };
            lines.push(`          画像: ${imageItem.imageUrl}（楽天に宣伝帯のない画像がないため Yahoo!の ${imageItem.shopName} の画像）`);
          }
        }
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
        yahooOk = true;
      } catch (error) {
        if (error instanceof YahooSkipped) {
          yahooSkipped++;
          lines.push(`  Yahoo!: ⏸ ${error.message} → 今回は取得せず、次回取り直します`);
        } else {
          yahooFailed++;
          lines.push(`  Yahoo!: ✗ エラー: ${error.message} → 変更しません`);
        }
      }
    }
    // 楽天・Yahoo! の両方を取得できたときだけ確認日時を記録する（どちらかが取れなかったカードは次回また取得する）
    if (rakutenOk && yahooOk) checks[card.id] = nowJst();

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
    `\n取得: ${checked}枚 / 更新: ${updated.size}枚 / 変化なし: ${unchanged}枚 / 楽天エラー: ${failed}枚${yahooAppId ? ` / Yahoo!エラー: ${yahooFailed}枚・休止で後回し: ${yahooSkipped}枚` : '（Yahoo!はスキップ）'}（${Math.round((Date.now() - startedAt) / 1000)}秒）`,
  );
  // 全件エラー（キーの失効・API障害など）は異常終了にして、GitHub Actions の失敗通知で気づけるようにする
  if (checked > 0 && (failed === checked || (yahooAppId && yahooFailed === checked))) process.exitCode = 1;
  if (dryRun) return;
  // 確認日時は価格に変化がなくても保存する（次回の差分更新で同じカードを取り直さないため）
  if (checked > 0) {
    mkdirSync(dirname(CHECKS_PATH), { recursive: true });
    await writeFile(CHECKS_PATH, `${JSON.stringify(checks)}\n`, 'utf8');
  }
  if (updated.size === 0) return;

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
