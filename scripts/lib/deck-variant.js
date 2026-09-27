// 同じデッキ名（主軸）のレシピどうしを比べ、「〇〇採用型」のように区別できるカードを選ぶ
// scripts/auto-deck-updater.js から使う（同名デッキの記事タイトル・デッキ名の命名）

/** どのデッキにも入る汎用カード（区別の手がかりにしない） */
export const STAPLES = new Set([
  'ハイパーボール', 'ポケパッド', 'なかよしポフィン', '夜のタンカ', 'リーリエの決心', 'ボスの指令', 'ジャッジマン', 'ポケギア3.0',
  'ポケモンいれかえ', 'エネルギー回収', 'エネルギー転送', 'スペシャルレッドカード', 'ふしぎなアメ', 'キチキギスex', 'ニャースex',
  'ノコッチ', 'ノココッチ', 'シークレットボックス', 'ヒカリ', 'トウコ', 'ペパー',
]);

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
const isBasicEnergy = (name) => /^基本.+エネルギー$/.test(name);
const isAceSpec = (e) => Boolean(e.aceSpec) || /ACE SPEC/.test(e.note ?? '');

/**
 * recipe（{ name, qty, category, note?/aceSpec? } の配列）にだけ入っていて、others のどのレシピにも入っていないカードから、
 * 区別の手がかりになるものを選ぶ。優先順:
 *   1. ポケモンex（汎用 ex をのぞく）  2. ACE SPEC  3. そのほかのポケモン（進化ライン・システムポケモン）  4. トレーナーズ・特殊エネルギー
 * 同じ優先度なら枚数の多い順・レシピの並び順。どれもなければ、共通カードのうち枚数の差がいちばん大きいカードを使う。
 * 返り値: { card: カード名, text: 「ノココッチex採用」「ボスの指令4枚」のような型名の中身 }
 */
export function variantLabel(recipe, others) {
  const othersNames = new Set(others.flatMap((r) => r.map((e) => norm(e.name))));
  const unique = recipe
    .map((e, i) => ({ ...e, i }))
    .filter((e) => !isBasicEnergy(e.name) && !STAPLES.has(e.name) && !othersNames.has(norm(e.name)));
  const rank = (e) => {
    if (e.category === 'ポケモン' && /ex$/.test(e.name)) return 0;
    if (isAceSpec(e)) return 1;
    if (e.category === 'ポケモン') return 2;
    return 3;
  };
  const best = unique.sort((a, b) => rank(a) - rank(b) || b.qty - a.qty || a.i - b.i)[0];
  if (best) return { card: best.name, text: `${best.name}採用` };

  // すべてのカードが共通なら、枚数の差がいちばん大きいカード（例: 「ボスの指令4枚型」）
  const qtyIn = (r, name) => r.filter((e) => norm(e.name) === norm(name)).reduce((s, e) => s + e.qty, 0);
  const diffs = recipe
    .filter((e) => !isBasicEnergy(e.name))
    .map((e) => ({ name: e.name, qty: qtyIn(recipe, e.name), diff: Math.min(...others.map((r) => Math.abs(qtyIn(recipe, e.name) - qtyIn(r, e.name)))) }))
    .sort((a, b) => b.diff - a.diff);
  const top = diffs[0];
  return top && top.diff > 0 ? { card: top.name, text: `${top.name}${top.qty}枚` } : { card: '', text: '別構築' };
}

/** 「メガゲッコウガex（ノココッチex採用型）」→「メガゲッコウガex」（型名・旧形式の「（構築2）」を外す） */
export const baseDeckName = (deckName) => deckName.replace(/（[^（）]*(型|構築\d+)）$/, '');
