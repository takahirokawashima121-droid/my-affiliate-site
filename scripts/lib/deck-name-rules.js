// デッキ名の通称ルール（ポケカブックの●付き小見出しの名前・レシピからの推定より優先する）
// scripts/auto-deck-updater.js・scripts/apply-deck-name-rules.js・scripts/check-deck-names.js から使う
//
// ■ 通称の足し方（「〇〇が入った△△デッキは□□と呼ぶ」→ DECK_NAME_RULES に1行足す）
//   { name: '□□', deck: '△△', card: '〇〇' }         … △△と〇〇（カード名）が入っていれば□□
//   { name: '□□', deck: '△△', ability: '〇〇' }      … △△と、特性「〇〇」を持つカードが入っていれば□□
//                                                       （カード名ではなく特性の名前で見る。サマヨール・ヨノワールのように複数のカードが持つ特性でも1行で済む）
//   そのほかに書けること（どれも省略できる）
//     without … これが入っていたら当てはまらない（カード名。例: カミッチュ入りでもカミツオロチexが入っていれば「おまつりおんど」にしない）
//     minQty  … 〇〇のカードの合計枚数がこれより少ないときは自動では言い換えず、「迷う」として PR で人に確認する（省略時 1）
//     note    … 説明（PR・ログに出す）
//   card・without はカード名を1つ（文字列）でも複数（配列。すべて入っていれば当てはまる）でも書ける。deck を省略すると、どのデッキでも〇〇だけで判定する。
//   特性の名前で判定するときは、特性を持つカードが scripts/lib/card-abilities.json に載っている必要がある
//   （npm run auto-decks / auto-city が公式のカードテキストから自動で追記する。手で足してもよい）。
//   足したあとは scripts/lib/english-name.js の DECK_NAMES に英語表記を追記し、npm run apply-name-rules で公開済みの記事にも当てはめる。
//
// ■ 2つ以上のルール（違う名前）に当てはまるデッキは、どちらの名前にもせず元の名前のまま残し、PR で人に確認する（conflict）
// ■ デッキ名にはカードの採用・枚数による付け足し（「（〇〇採用型）」「（〇〇2枚型）」）を付けない。同じ名前のデッキが並んでもそのままにする
// 対象は現行レギュレーションのデッキのみ（掲載できるデッキは現行スタンダードだけのため、ここでは判定しない）

import { readFileSync } from 'node:fs';

export const DECK_NAME_RULES = [
  { name: 'ひらめきチャレンジ', card: 'ヤドキング', minQty: 2, note: 'ヤドキングが入っている' },
  { name: 'おまつりおんど', card: 'カミッチュ', without: 'カミツオロチex', note: 'カミッチュが入っていて、カミツオロチexが入っていない' },
  { name: 'ボムドラパ', deck: 'ドラパルトex', ability: 'カースドボム', note: 'ドラパルトexのデッキに、特性「カースドボム」を持つカード（サマヨール・ヨノワール）が入っている' },
  { name: 'ノココッチドラパ', deck: 'ドラパルトex', card: 'ノココッチ', note: 'ドラパルトexのデッキに、ノココッチが入っている' },
];

/** 特性を持つカードの一覧（カード名 → 特性の名前）。公式のカードテキストから集めたもの */
export const CARD_ABILITIES_PATH = new URL('./card-abilities.json', import.meta.url);
export const loadCardAbilities = () => JSON.parse(readFileSync(CARD_ABILITIES_PATH, 'utf8'));

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
/** レシピ（{ name, qty } または公式デッキの { name, count } の配列）のカードの合計枚数 */
const qtyOf = (recipe, name) => recipe.filter((e) => norm(e.name) === norm(name)).reduce((s, e) => s + (e.qty ?? e.count ?? 0), 0);
/** レシピのうち、特性 ability を持つカード（abilities はカード名 → 特性の名前の配列） */
const abilityCards = (recipe, ability, abilities) => {
  const has = new Map(Object.entries(abilities).map(([name, a]) => [norm(name), a.map(norm)]));
  return [...new Set(recipe.filter((e) => has.get(norm(e.name))?.includes(norm(ability))).map((e) => e.name))];
};

/** ルールの主役のカード（記事の主力カードの先頭に使う。「ひらめきチャレンジ」→ ヤドキング、「ボムドラパ」→ ドラパルトex） */
export const ruleMainCard = (rule) => rule.deck ?? list(rule.card)[0] ?? null;

/** ルールのうち、特性・カードを除いた条件（deck・without）だけを満たすか。特性の一覧を公式から取るかどうかの判定に使う */
const baseMatches = (rule, recipe) =>
  list(rule.deck).every((n) => qtyOf(recipe, n) > 0) && !list(rule.without).some((n) => qtyOf(recipe, n) > 0);

/** このレシピの判定に、カードの特性の一覧が必要か（特性で判定するルールの deck・without を満たす） */
export const needsAbilities = (recipe) => DECK_NAME_RULES.some((rule) => rule.ability && baseMatches(rule, recipe));

/** ルールに当てはまるなら、判定に使ったカードの合計枚数。当てはまらなければ 0 */
function ruleQty(rule, recipe, abilities) {
  if (!baseMatches(rule, recipe)) return 0;
  const cards = list(rule.card);
  if (!cards.every((n) => qtyOf(recipe, n) > 0)) return 0;
  let total = cards.reduce((s, n) => s + qtyOf(recipe, n), 0);
  if (cards.length === 0 && !rule.ability) total = list(rule.deck).reduce((s, n) => s + qtyOf(recipe, n), 0);
  if (rule.ability) {
    const found = abilityCards(recipe, rule.ability, abilities);
    if (found.length === 0) return 0;
    total += found.reduce((s, n) => s + qtyOf(recipe, n), 0);
  }
  return total;
}

/**
 * レシピに当てはまる通称ルールを返す。当てはまらなければ null。
 * 返り値: { name, rule, uncertain, conflict, rules }
 *   uncertain: true … 当てはまるが枚数が minQty 未満、または違う名前の2つ以上のルールに当てはまる（どちらも自動では言い換えない）
 *   conflict: true  … 違う名前の2つ以上のルールに当てはまる（rules に当てはまったルール、name はそれらを「／」でつないだもの）
 * abilities は特性の一覧（カード名 → 特性の名前の配列）。省略時は scripts/lib/card-abilities.json
 */
export function matchDeckNameRule(recipe, abilities = loadCardAbilities()) {
  const hits = DECK_NAME_RULES.map((rule) => ({ rule, qty: ruleQty(rule, recipe, abilities) })).filter((h) => h.qty > 0);
  if (hits.length === 0) return null;
  const names = [...new Set(hits.map((h) => h.rule.name))];
  if (names.length > 1) return { name: names.join('／'), rule: null, uncertain: true, conflict: true, rules: hits.map((h) => h.rule) };
  const { rule, qty } = hits[0];
  return { name: rule.name, rule, uncertain: qty < (rule.minQty ?? 1), conflict: false, rules: [rule] };
}

/** 言い換え後のデッキ名（当てはまらない・枚数が少なく迷う・2つ以上のルールに当てはまる場合は元の名前のまま） */
export function applyDeckNameRules(name, recipe, abilities) {
  const hit = matchDeckNameRule(recipe, abilities);
  return hit && !hit.uncertain ? hit.name : name;
}
