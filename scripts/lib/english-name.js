// カード名（ポケモン）を、記事のURL（slug）に使う英語表記にする
// scripts/auto-deck-updater.js から使う（例: 「メガガルーラex」→ mega-kangaskhan-ex、「リーリエのピッピex」→ lillies-clefairy-ex）
//
// ポケモンの英語名は pokemon-names-en.json（PokeAPI の pokemon_species_names.csv から作成。キーはカタカナ名）。
// 新しいポケモンが出たら、同じ形式（"カタカナ名": "english-name"）で追記する。
// 英語名が分からないカード（トレーナーズ・未登録のポケモン）は null を返す（ローマ字の読み仮名は使わない）

import { readFileSync } from 'node:fs';

const SPECIES = JSON.parse(readFileSync(new URL('./pokemon-names-en.json', import.meta.url), 'utf8'));

/** 「〇〇の」ポケモン（トレーナーのポケモン）の持ち主 */
const OWNERS = {
  N: 'n',
  リーリエ: 'lillies',
  ホップ: 'hops',
  マリィ: 'marnies',
  エリカ: 'erikas',
  シロナ: 'cynthias',
  ヒビキ: 'ethans',
  ダイゴ: 'stevens',
  ロケット団: 'team-rockets',
  ナンジャモ: 'ionos',
  タケシ: 'brocks',
  カスミ: 'mistys',
};

/** リージョンフォーム・すがたの違い（名前の前に付くもの） */
const PREFIXES = { アローラ: 'alolan', ガラル: 'galarian', ヒスイ: 'hisuian', パルデア: 'paldean' };

/** 名前の後ろに付くフォーム名（「ガチグマ アカツキ」など） */
const FORMS = { ガチグマアカツキ: 'bloodmoon-ursaluna' };

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');

/** ポケモン名（「ex」「メガ」などを外したもの）→ 英語名 */
function species(name) {
  if (FORMS[name]) return FORMS[name];
  if (SPECIES[name]) return SPECIES[name];
  for (const [ja, en] of Object.entries(PREFIXES)) if (name.startsWith(ja) && SPECIES[name.slice(ja.length)]) return `${en}-${SPECIES[name.slice(ja.length)]}`;
  return null;
}

/**
 * カード名 → slug 用の英語表記（小文字・ハイフン区切り）。分からなければ null
 * 例: メガリザードンXex → mega-charizard-x-ex / Nのゾロアークex → n-zoroark-ex / パルデア ケンタロス → paldean-tauros
 */
export function englishName(cardName) {
  let name = norm(cardName);
  const parts = [];
  const ex = /ex$/.test(name);
  if (ex) name = name.slice(0, -2);
  const owner = name.match(/^(.+?)の(.+)$/);
  if (owner && OWNERS[owner[1]]) {
    parts.push(OWNERS[owner[1]]);
    name = owner[2];
  }
  let mega = '';
  let megaForm = '';
  if (/^メガ./.test(name) && !SPECIES[name]) {
    mega = 'mega';
    name = name.slice(2);
    const xy = name.match(/^(.+?)([XY])$/);
    if (xy && species(xy[1])) [name, megaForm] = [xy[1], xy[2].toLowerCase()];
  }
  const en = species(name);
  if (!en) return null;
  return [...parts, mega, en, megaForm, ex ? 'ex' : ''].filter(Boolean).join('-');
}

/**
 * ポケモン名ではないデッキの呼び名（ポケカブックの●付き小見出しで使われるもの）の英語表記。
 * 新しい呼び名が出てきたら追記する（ローマ字の読み仮名は使わない）
 */
export const DECK_WORDS = {
  スッカラカン: 'empty-hand',
  ボム: 'bomb',
  おまつりおんど: 'festival-lead',
  ロスト: 'lost',
  バレット: 'bullet',
  コントロール: 'control',
  ロック: 'lock',
};

/**
 * デッキ名全体の英語表記（通称ルール scripts/lib/deck-name-rules.js の名前など、語に分けずにそのまま訳すもの）。
 * 通称ルールを追加したら、ここにも英語表記を追記する（海外で通じるデッキの呼び名。ひらめきチャレンジはワザの英語名）
 */
export const DECK_NAMES = {
  ひらめきチャレンジ: 'seek-inspiration',
  おまつりおんど: 'dipplin-festival-lead',
  ボムドラパ: 'bomb-dragapult',
  ノココッチドラパ: 'dudunsparce-dragapult',
};

/**
 * デッキ名 → slug 用の英語表記。分からない部分があれば null
 * ポケモン名・DECK_WORDS の組み合わせに分けて訳す（例: ボムファイアロー → bomb-talonflame、
 * カミッチュ（おまつりおんど）→ dipplin-festival-lead、ケンタロス → tauros）
 */
export function deckEnglishName(deckName) {
  if (DECK_NAMES[norm(deckName)]) return DECK_NAMES[norm(deckName)];
  const parts = norm(deckName).split(/[（）()・]/).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const en = compound(part);
    if (!en) return null;
    out.push(en);
  }
  return out.length ? out.join('-') : null;
}

/** 文字列を、英語にできる語（ポケモン名・DECK_WORDS）の並びに分ける。長い語を優先し、分けきれなければ null */
function compound(text, memo = new Map()) {
  if (text === '') return '';
  if (memo.has(text)) return memo.get(text);
  let result = null;
  for (let end = text.length; end >= 2 && result === null; end--) {
    const head = text.slice(0, end);
    const en = DECK_WORDS[head] ?? englishName(head);
    if (!en) continue;
    const rest = compound(text.slice(end), memo);
    if (rest !== null) result = rest ? `${en}-${rest}` : en;
  }
  memo.set(text, result);
  return result;
}
