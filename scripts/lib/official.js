// ポケモンカード公式サイト（デッキページ・カード検索・カード詳細）の読み取りと、版（型番）選びの共通処理
// scripts/sync-trending-decks.js・scripts/import-official-decks.js から使う
//
// マナー: 同じサイトへのリクエストは1.5秒以上あけ、デッキページ・カード詳細（内容が変わらないもの）は .cache/ に保存して再取得しない

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { STANDARD_EXEMPT_NAMES, STANDARD_REGULATIONS } from '../../src/consts.ts';

export const OFFICIAL = 'https://www.pokemon-card.com';
const CACHE_DIR = fileURLToPath(new URL('../../.cache/trending/', import.meta.url));
const USER_AGENT = 'Mozilla/5.0 (compatible; pokeca-price-navi/1.0; +https://my-affiliate-site-phi.vercel.app/)';
const WAIT_MS = 1500;

/**
 * 弾ごとのレギュレーションマーク（公式の検索結果にはマークがないため、弾から決める）。
 * 再録・構築済みデッキの弾（REPRINT_SETS）は元のマークのままのカードがあるため、同じ効果の版があれば拡張パックの版を優先する
 */
export const SET_MARKS = {
  // G の弾は、公式の例外リストのカード（クラッシュハンマー等）の版を選ぶためにだけ使う
  SV1S: 'G', SV1V: 'G', SV1a: 'G', SV2P: 'G', SV2D: 'G', SV2a: 'G', SV3: 'G', SV3a: 'G', SV4K: 'G', SV4M: 'G', SV4a: 'G',
  // 構築済みデッキ等（カード画像で確認）: SVN・SVM（スタートデッキGenerations）= H、MC（スタートデッキ100 バトルコレクション）・MBG・MBD・SVOD = I、MEM（スターターセットex）= J
  SVN: 'H', SVM: 'H', MC: 'I', MBG: 'I', MBD: 'I', SVOD: 'I', MEM: 'J',
  SV5K: 'H', SV5M: 'H', SV5a: 'H', SV6: 'H', SV6a: 'H', SV7: 'H', SV7a: 'H', SV8: 'H', SV8a: 'H',
  SV9: 'I', SV9a: 'I', SV10: 'I', SV11B: 'I', SV11W: 'I', M1L: 'I', M1S: 'I', M2: 'I', M2a: 'I',
  M3: 'J', M4: 'J', M5: 'J', M6: 'J', M6a: 'J',
};
export const REPRINT_SETS = new Set(['SV4a', 'SV8a', 'M2a', 'M6a', 'MC', 'SVN', 'SVM', 'MBG', 'MBD', 'SVOD', 'MEM']);
/**
 * 最低レアリティを選ぶときの順。「-」はレアリティ表記のない版（MC・M2a などデッキ・ハイクラスパックの再録）で、
 * 拡張パックの通常レアリティ（C〜RR）の版がない場合に使う
 */
const RARITY_RANK = ['C', 'U', 'R', 'RR', '-', 'ACE', 'AR', 'RRR', 'CHR', 'SR', 'SA', 'HR', 'SAR', 'SSR', 'UR', 'FUR', 'MUR'];

/** 公式デッキページの入力欄 → カードの種類 */
const DECK_CATEGORIES = { pke: 'ポケモン', gds: 'グッズ', tool: 'ポケモンのどうぐ', tech: 'ポケモンのどうぐ', sup: 'サポート', sta: 'スタジアム', ene: 'エネルギー', ajs: 'グッズ' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
export const isStandardLegal = (name, mark) => STANDARD_REGULATIONS.includes(mark) || STANDARD_EXEMPT_NAMES.includes(name);

const lastRequest = new Map();
/** ホストごとに間隔をあけて取得する。cache: true のページは .cache/ に保存し、次回から再取得しない */
export async function fetchText(url, { cache = false } = {}) {
  const file = `${CACHE_DIR}${createHash('sha1').update(url).digest('hex')}.html`;
  if (cache && existsSync(file)) return readFile(file, 'utf8');
  const host = new URL(url).host;
  const wait = (lastRequest.get(host) ?? 0) + WAIT_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest.set(host, Date.now());
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const text = await res.text();
  if (cache) {
    mkdirSync(CACHE_DIR, { recursive: true });
    await writeFile(file, text, 'utf8');
  }
  return text;
}

/** 公式デッキページのカード（公式カードID・名前・枚数・種類）。デッキページの並び順のまま返す */
export async function deckCards(deckId) {
  const html = await fetchText(`${OFFICIAL}/deck/result.html/deckID/${deckId}/`, { cache: true });
  // 「ニュートラルセンター(ACE SPEC)」のような付記は、カード名（cards.json・公式検索）に合わせて外す
  const names = new Map([...html.matchAll(/searchItemNameAlt\[(\d+)\]='([^']*)'/g)].map((m) => [m[1], m[2].replace(/\s*\(ACE SPEC\)$/, '')]));
  const picts = new Map([...html.matchAll(/searchItemCardPict\[(\d+)\]='([^']*)'/g)].map((m) => [m[1], m[2]]));
  const aceSpec = new Set([...html.matchAll(/searchItemNameAlt\[(\d+)\]='[^']*\(ACE SPEC\)'/g)].map((m) => m[1]));
  const cards = [];
  for (const [, key, value] of html.matchAll(/name="deck_([a-z]+)"[^>]*value="([^"]*)"/g)) {
    for (const part of value.split('-').filter(Boolean)) {
      const [cardId, count] = part.split('_');
      if (names.has(cardId)) cards.push({ cardId, name: names.get(cardId), count: Number(count), category: DECK_CATEGORIES[key] ?? 'グッズ', aceSpec: aceSpec.has(cardId), thumb: picts.get(cardId) ?? '' });
    }
  }
  return cards;
}

/** 公式カード検索の「スタンダード」絞り込みで、同じ名前の版を集める（G以前の版は含まれない） */
export async function standardPrintings(name) {
  const found = [];
  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({ keyword: name, se_ta: '', regulation_sidebar_form: 'XY', pg: '', illust: '', sm_and_keyword: 'true', page: String(page) });
    const json = JSON.parse(await fetchText(`${OFFICIAL}/card-search/resultAPI.php?${params}`));
    for (const c of json.cardList ?? []) {
      if (norm(c.cardNameAltText) === norm(name)) found.push({ cardId: c.cardID, thumb: c.cardThumbFile });
    }
    if (page >= (json.maxPage ?? 1)) break;
  }
  return found;
}

/** 公式カード詳細: 型番・レアリティ・弾・効果テキスト（signature は同名で効果の違うカードの区別用） */
export async function cardDetail(cardId) {
  const html = await fetchText(`${OFFICIAL}/card-search/details.php/card/${cardId}/regu/XY`, { cache: true });
  const $ = cheerio.load(html);
  const subtext = $('.LeftBox .subtext').first();
  const number = subtext.text().normalize('NFKC').match(/(\d{3})\s*\/\s*(\d{3})/);
  const rarityIcon = subtext.find('img[src*="ic_rare_"]').attr('src')?.match(/ic_rare_([a-z0-9]+?)(?:_c)?\.gif/)?.[1];
  const inner = $('.RightBox-inner').first().clone();
  // エネルギーのアイコンも含めて比較する
  inner.find('span.icon').each((_, el) => { $(el).replaceWith(`[${($(el).attr('class') ?? '').replace(/\bicon\b/g, '').trim()}]`); });
  const body = cheerio.load(inner.html()?.split(/<h2[^>]*>\s*進化/)[0] ?? '');
  body('h2, h4, p').each((_, el) => { body(el).append('\n'); });
  return {
    cardNumber: number ? `${number[1]}/${number[2]}` : null,
    rarity: rarityIcon ? rarityIcon.toUpperCase() : '-',
    expansionCode: $('.LeftBox .subtext img.img-regulation').attr('alt') ?? null,
    signature: body.text().replace(/\s+/g, ''),
    text: body.text().split('\n').map((l) => l.trim()).filter(Boolean).join('\n'),
  };
}

/** 公式サイトのエネルギーアイコン（icon-xxx）→ 表記 */
const ENERGY = { grass: '草', fire: '炎', water: '水', electric: '雷', psychic: '超', fighting: '闘', dark: '悪', steel: '鋼', dragon: '竜', none: '無', fairy: 'フェアリー' };

/**
 * 公式カード詳細の効果を、特性・ワザ・トレーナーズの効果ごとに取り出す（自動生成する記事の本文用）。
 * 例: [{ kind: '特性', name: 'にげあしドロー', cost: '', damage: '', text: '自分の番に1回使える。…' },
 *      { kind: 'ワザ', name: 'ランドクラッシュ', cost: '無無無', damage: '90', text: '' }]
 */
/**
 * カードの進化段階・HP・進化ライン・効果（立ち回りの自動生成に使う）。
 * stage は「たね」「1進化」「2進化」（トレーナーズ・エネルギーは null）、line は公式ページの進化図に並ぶ名前
 */
export async function cardProfile(cardId) {
  const html = await fetchText(`${OFFICIAL}/card-search/details.php/card/${cardId}/regu/XY`, { cache: true });
  const $ = cheerio.load(html);
  const top = $('.TopInfo').first().text().normalize('NFKC').replace(/\s+/g, ' ');
  const stage = top.match(/たね|1\s*進化|2\s*進化/)?.[0].replace(/\s+/g, '') ?? null;
  const hp = Number(top.match(/HP\s*(\d+)/)?.[1] ?? 0) || null;
  const line = $('.evolution a, .evolution span')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return { stage, hp, line: [...new Set(line)], effects: await cardEffects(cardId) };
}

export async function cardEffects(cardId) {
  const html = await fetchText(`${OFFICIAL}/card-search/details.php/card/${cardId}/regu/XY`, { cache: true });
  const $ = cheerio.load(html);
  const inner = $('.RightBox-inner').first();
  const icon = (el) => ENERGY[($(el).attr('class') ?? '').match(/icon-([a-z]+)/)?.[1]] ?? '';
  // 文中のエネルギーアイコン（「基本[超]エネルギー」など）を文字にする
  const textOf = (el) => {
    const c = $(el).clone();
    c.find('span.icon').each((_, s) => { $(s).replaceWith(icon(s)); });
    c.find('br').replaceWith('\n');
    return c.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  };
  const entries = [];
  let kind = '';
  inner.find('h2, h4, p').each((_, el) => {
    if (el.tagName === 'h2') {
      kind = $(el).text().trim();
      return;
    }
    if (kind === '進化' || kind === '特別なルール') return;
    const label = kind || 'ルール'; // 見出しより前の文（テラスタルの「ベンチにいるかぎりワザのダメージを受けない」等）
    if (el.tagName === 'h4') {
      const h = $(el).clone();
      const damage = h.find('.f_right').text().trim();
      const cost = h.find('span.icon').map((_, s) => icon(s)).get().join('');
      h.find('span').remove();
      entries.push({ kind: label, name: h.text().trim(), cost, damage, text: '' });
      return;
    }
    const text = textOf(el);
    if (!text || /は、自分の番に(何枚でも|1枚しか)|自分のポケモンにつけられる|バトル場の横に出せる/.test(text)) return; // 種類ごとの共通ルールは省く
    const last = entries[entries.length - 1];
    if (last && last.kind === label && !last.text) last.text = text;
    else entries.push({ kind: label, name: '', cost: '', damage: '', text });
  });
  return entries;
}

/** 公式画像のファイル名（045203_P_NOKOKOTCHI.jpg）から id 用のローマ字を取り出す */
export const romaji = (thumb) => (thumb.split('/').pop().match(/^\d+_[A-Z]_(.+)\.\w+$/)?.[1] ?? 'card').toLowerCase().replace(/[^a-z0-9]/g, '');
const setCode = (thumb) => thumb.split('/').slice(-2, -1)[0];
const rank = (r) => (RARITY_RANK.includes(r) ? RARITY_RANK.indexOf(r) : RARITY_RANK.length);

/**
 * デッキで使われた版（usedCardIds の先頭ほど優先）と効果テキストが同じ、現行スタンダードの版をすべて調べる。
 * 返り値の any は現行スタンダードの版があるか（プロモを含む）、same は効果が同じ版（プロモを除き、最低レアリティ・拡張パック優先の順）
 */
export async function samePrintings(name, usedCardIds) {
  const all = await standardPrintings(name);
  // プロモは型番（弾記号・番号）で登録できないため除く。プロモだけのカードも現行スタンダードでは使える（any: true, same: []）
  const printings = all.filter((p) => !/-P$/i.test(setCode(p.thumb)));
  const details = [];
  for (const p of printings) details.push({ ...p, code: setCode(p.thumb), ...(await cardDetail(p.cardId)) });
  const reference = usedCardIds.map((id) => details.find((d) => d.cardId === id)).find(Boolean) ?? (usedCardIds[0] ? await cardDetail(usedCardIds[0]) : null);
  const same = reference
    ? details
        .filter((d) => d.signature === reference.signature && d.cardNumber)
        .sort((a, b) => rank(a.rarity) - rank(b.rarity) || REPRINT_SETS.has(a.code) - REPRINT_SETS.has(b.code))
    : [];
  return { any: all.length > 0, reference, same };
}

/** 効果が同じ版のうち、登録できる（マークの分かる弾・現行スタンダード）最低レアリティの版からシードを作る */
export function seedFromPrintings(name, same, extra = {}) {
  const best = same.find((d) => SET_MARKS[d.code]);
  if (!best) {
    // 新しい弾が出たら SET_MARKS に追記する（未対応の弾の記号を表示）
    const unknown = [...new Set(same.map((d) => d.code).filter((c) => !SET_MARKS[c]))];
    return { skip: unknown.length ? `マーク未対応の弾（${unknown.join('・')}）の版のみ → SET_MARKS に追記すると登録できます` : '型番で登録できる版なし（プロモのみ）' };
  }
  const mark = SET_MARKS[best.code];
  if (!isStandardLegal(name, mark)) return { skip: `レギュレーション ${mark}（現行スタンダード外）` };
  const num = best.cardNumber.split('/')[0];
  const source = `公式カードID ${best.cardId}${REPRINT_SETS.has(best.code) ? '・再録弾のためマークは推定' : ''}`;
  return {
    seed: {
      id: [romaji(best.thumb), best.rarity === '-' ? null : best.rarity.toLowerCase(), best.code.toLowerCase(), num].filter(Boolean).join('-'),
      name: name.normalize('NFKC'),
      rarity: best.rarity,
      cardNumber: best.cardNumber,
      expansionCode: best.code,
      regulationMark: mark,
      ...extra,
      role: extra.role ? `${extra.role}（${source}）` : source,
    },
  };
}
