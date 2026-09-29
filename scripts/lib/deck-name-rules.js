// デッキ名の言い換えルール（ポケカブックの●付き小見出しの名前・レシピからの推定より優先する）
// scripts/auto-deck-updater.js・scripts/apply-deck-name-rules.js・scripts/check-deck-names.js から使う
//
// ルールを増やすときは DECK_NAME_RULES に1行追加する（上にあるルールほど優先）。
//   name     … 言い換え後のデッキ名（型名は付けない。同名デッキが複数あれば「（〇〇採用型）」が自動で付く）
//   has      … すべて採用されていれば当てはまるカード名
//   without  … どれか1枚でも採用されていれば当てはまらないカード名
//   minQty   … has のカードの合計枚数がこれより少ないときは自動では言い換えず、「迷う」として PR で人に確認する（省略時 1）
// 対象は現行レギュレーションのデッキのみ（掲載できるデッキは現行スタンダードだけのため、ここでは判定しない）

export const DECK_NAME_RULES = [
  { name: 'ひらめきチャレンジ', has: ['ヤドキング'], minQty: 2, note: 'ヤドキングが採用されている' },
  { name: 'おまつりおんど', has: ['カミッチュ'], without: ['カミツオロチex'], note: 'カミッチュが採用され、カミツオロチexが採用されていない' },
];

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
/** レシピ（{ name, qty } または公式デッキの { name, count } の配列）のカードの合計枚数 */
const qtyOf = (recipe, name) => recipe.filter((e) => norm(e.name) === norm(name)).reduce((s, e) => s + (e.qty ?? e.count ?? 0), 0);

/**
 * レシピに当てはまる言い換えルールを返す。
 * 返り値: { name, rule, uncertain } … uncertain: true は、当てはまるが枚数が minQty 未満（自動では言い換えない）。当てはまらなければ null
 */
export function matchDeckNameRule(recipe) {
  for (const rule of DECK_NAME_RULES) {
    if (!rule.has.every((n) => qtyOf(recipe, n) > 0)) continue;
    if ((rule.without ?? []).some((n) => qtyOf(recipe, n) > 0)) continue;
    const total = rule.has.reduce((s, n) => s + qtyOf(recipe, n), 0);
    return { name: rule.name, rule, uncertain: total < (rule.minQty ?? 1) };
  }
  return null;
}

/** 言い換え後のデッキ名（当てはまらない・枚数が少なく迷う場合は元の名前のまま） */
export function applyDeckNameRules(name, recipe) {
  const hit = matchDeckNameRule(recipe);
  return hit && !hit.uncertain ? hit.name : name;
}
