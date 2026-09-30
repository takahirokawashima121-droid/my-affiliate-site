// 同じ日・同じ大会の種類・同じ名前のデッキ記事のタイトルを区別する
// scripts/auto-deck-updater.js・scripts/apply-deck-name-rules.js から使う
//
// デッキ名には「（〇〇採用型）」のような付け足しをしないため、同じ日に同じ名前の記事が並ぶとタイトルが重なることがある。
// そのときだけ、タイトルで区別する（一覧のカードや記事の見出しに出るデッキ名はシンプルなまま。URL（slug）も変えない）。
// 1. 開催地: タイトルの【】の中に都道府県を付ける（例: 【9/26 シティリーグ優勝・千葉】メガゲッコウガexデッキレシピ！…）。
//    同じグループに同じ都道府県の記事があれば、代わりに店舗名を付ける
// 2. 店舗のデータ（venue）がない記事（ジムバトルなど）は、レシピの違いからデッキ名のあとに「（〇〇採用型）」を付ける
//    （例: 【9/26 ジムバトル優勝】メガゲッコウガex（ノココッチex採用型）デッキレシピ…）。選び方は recipeLabels を見る
//    （サイトの全デッキ記事の半分以上に入っている定番カードは選ばない。入っている記事の数が少ないカードを優先する）
//    付けた採用型は deck-columns.json の titleLabel に保存し（titleLabelBy: 'auto'）、あとで付け直さない。
//    人が titleLabel を書き換えたら titleLabelBy: 'manual' にする（その名前を使い、自動では上書きしない）
// グループは「大会の日・大会の種類（シティリーグ / ジムバトル）・デッキ名」が同じ記事。大会の種類が違えば区別の対象にしない

import { columnDay } from './deck-variant.js';

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');

/** 「シーガル　仙台駅前店（宮城）」→ { store: 'シーガル 仙台駅前店', pref: '宮城' }（都道府県がなければ pref: null） */
export function venueParts(venue) {
  if (!venue) return null;
  const m = venue.match(/^(.*?)[（(]([^（）()]+)[）)]\s*$/);
  const clean = (s) => s.replace(/[\s　]+/g, ' ').trim();
  return m ? { store: clean(m[1]), pref: clean(m[2]) } : { store: clean(venue), pref: null };
}

/** 大会の種類（eventType がない古い記事は result から判断）。分からなければ null */
export function eventTypeOf(c) {
  if (c.eventType) return c.eventType;
  if (/シティリーグ/.test(c.result ?? '')) return 'city';
  if (/ジムバトル/.test(c.result ?? '')) return 'gym';
  return null;
}

/** タイトルの先頭の【】を「【{result}・{tag}】」にする（tag がなければ「【{result}】」）。先頭が【{result} でなければ変えない */
export function withPlace(title, result, tag) {
  if (!title.startsWith(`【${result}`)) return title;
  return title.replace(/^【[^】]*】/, `【${result}${tag ? `・${tag}` : ''}】`);
}

/** タイトルの【】のすぐあとのデッキ名に「（{label}）」を付ける（label がなければ外す。デッキ名のすぐあとの（…）は、手で書いた名前も含めて採用型とみなして付け替える）。【】のあとがデッキ名でなければ変えない */
export function withLabel(title, deckName, label) {
  const m = title.match(/^(【[^】]*】)(.*)$/);
  if (!m || !m[2].startsWith(deckName)) return title;
  const rest = m[2].slice(deckName.length).replace(/^（[^（）]*）/, '');
  return `${m[1]}${deckName}${label ? `（${label}）` : ''}${rest}`;
}

/** カードの種類の優先順（ポケモン → サポート → グッズ・ポケモンのどうぐ・スタジアム）。それ以外（エネルギーなど）は選ばない */
const CATEGORY_RANK = { ポケモン: 0, サポート: 1, グッズ: 2, ポケモンのどうぐ: 2, スタジアム: 2 };
const qtyOfEntry = (e) => e.qty ?? e.count ?? 0;

/**
 * サイトの全デッキ記事のうち、そのカードが入っている記事の数（カード名 → 本数）と記事の総数。
 * 半分以上の記事に入っているカードは「定番カード」として、採用型の候補にしない
 */
export function cardUsage(allRecipes) {
  const counts = new Map();
  for (const recipe of allRecipes) for (const name of new Set(recipe.map((e) => norm(e.name)))) counts.set(name, (counts.get(name) ?? 0) + 1);
  return { counts, total: allRecipes.length };
}
const decksWith = (usage, name) => usage?.counts.get(norm(name)) ?? 0;
/** 定番カード（サイトの全デッキ記事の半分以上に入っている）か */
export const isStapleCard = (usage, name) => Boolean(usage?.total) && decksWith(usage, name) * 2 >= usage.total;

/**
 * 同じグループのレシピどうしを比べて、タイトルに付ける「（〇〇採用型）」を決める。
 * - その記事にしか入っていないカードから選ぶ（ほかの記事にも入っているカードは、枚数が違っても選ばない）
 * - 定番カード（サイトの全デッキ記事の半分以上に入っているカード。usage で判定）は選ばない
 * - 種類の順: ポケモン → サポート → グッズ・ポケモンのどうぐ・スタジアム（基本エネルギー・特殊エネルギーは選ばない）
 * - 同じ種類なら、入っているデッキ記事の数が少ないカード → 枚数の多いカード → レシピ（元の公式デッキ）で先に出てくるカードの順
 * - 候補が1枚もなければ（定番カードしかない場合も）「別構築」（2本以上あれば「別構築」「別構築2」「別構築3」…の順）
 * recipes は記事の順に並んだレシピ（{ name, qty|count, category } の配列）、usage は cardUsage の結果。
 * 返り値: 記事の順に { card: 選んだカード名（別構築なら null）, decks: そのカードが入っているデッキ記事の数, label: 「ノココッチex採用型」「別構築2」など }
 */
export function recipeLabels(recipes, usage = null) {
  let other = 0;
  return recipes.map((recipe, i) => {
    const best = pickLabelCard(recipe, recipes.filter((_, j) => j !== i), usage);
    if (best) return best;
    other += 1;
    return { card: null, decks: null, label: other === 1 ? '別構築' : `別構築${other}` };
  });
}

/** recipe にだけ入っていて others のどれにも入っていないカードから、採用型のカードを選ぶ（選べなければ null）。選び方は recipeLabels と同じ */
export function pickLabelCard(recipe, others, usage = null) {
  const otherNames = new Set(others.flatMap((r) => r.map((e) => norm(e.name))));
  const totals = new Map();
  recipe.forEach((e, order) => {
    if (!(e.category in CATEGORY_RANK) || otherNames.has(norm(e.name)) || isStapleCard(usage, e.name)) return;
    const t = totals.get(e.name) ?? { name: e.name, rank: CATEGORY_RANK[e.category], decks: decksWith(usage, e.name), qty: 0, order };
    t.qty += qtyOfEntry(e);
    totals.set(e.name, t);
  });
  const best = [...totals.values()].sort((a, b) => a.rank - b.rank || a.decks - b.decks || b.qty - a.qty || a.order - b.order)[0];
  return best ? { card: best.name, decks: best.decks, label: `${best.name}採用型` } : null;
}

/**
 * 同じ日・同じ大会の種類・同じ名前の記事のグループごとに、タイトルを決める（columns は書き換えない）。
 * recipeOf(c) は記事のレシピ（なければ null）。
 * 採用型は一度付けたら記事のデータ（deck-columns.json の titleLabel）に保存し、保存済みの記事は付け直さない
 * （titleLabelBy: 'auto' = ルールで付けた / 'manual' = 人が手で書いた。どちらも自動では上書きしない）。
 * ルールで選ぶのは、採用型が必要で titleLabel がまだない記事だけ。
 * 返り値:
 *   titles     … Map(slug → 新しいタイトル)（今のタイトルと違うものだけ）
 *   newLabels  … Map(slug → 新しくルールで付けた採用型)（呼び出し側で titleLabel・titleLabelBy: 'auto' として保存する）
 *   groups     … グループの一覧（[{ day, eventType, deckName, columns: [{ c, tag, card, decks, label, saved }] }]。tag は開催地、label は「（〇〇採用型）」の中身、
 *                  card は選んだカード、decks はそのカードが入っているデッキ記事の数、saved は保存済みの採用型を使ったとき 'auto' / 'manual'）
 *   total      … 定番カードの判定に使ったデッキ記事の数
 *   unresolved … それでもタイトルが重なったままの記事（レシピがないなど）のグループ（[{ day, deckName, columns }]）
 */
export function placeTitles(columns, recipeOf = () => null) {
  const byKey = new Map();
  for (const c of columns) {
    const day = columnDay(c);
    const type = eventTypeOf(c);
    if (!day || !type) continue;
    const key = `${day}#${type}#${norm(c.deckName)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }
  const titles = new Map();
  const newLabels = new Map();
  const groups = [];
  const unresolved = [];
  const usage = cardUsage(columns.map(recipeOf).filter(Boolean)); // 定番カードの判定（サイトの全デッキ記事）
  // 保存済みの採用型は、グループに関係なくそのまま使う（付け直さない）
  for (const c of columns) {
    if (!c.titleLabel) continue;
    const title = withLabel(c.title, c.deckName, c.titleLabel);
    if (title !== c.title) titles.set(c.slug, title);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const parts = new Map(list.map((c) => [c, venueParts(c.venue)]));
    const count = (key, value) => list.filter((o) => parts.get(o)?.[key] === value).length;
    const tagged = list.map((c) => {
      const p = parts.get(c);
      // 都道府県がグループの中で1つだけならそれを、ほかの記事と同じなら店舗名を付ける
      const tag = p ? (p.pref && count('pref', p.pref) === 1 ? p.pref : p.store) : null;
      return c.titleLabel
        ? { c, tag, card: null, decks: null, label: c.titleLabel, saved: c.titleLabelBy === 'manual' ? 'manual' : 'auto' }
        : { c, tag, card: null, decks: null, label: null, saved: null };
    });
    const placeOf = (t) => withLabel(withPlace(t.c.title, t.c.result, t.tag), t.c.deckName, null);
    const titleOf = (t) => withLabel(withPlace(t.c.title, t.c.result, t.tag), t.c.deckName, t.label);
    // 開催地で区別できない記事（店舗のデータがない・同じ店舗）には、レシピの違いから「（〇〇採用型）」を付ける。
    // 重なる記事すべてに付けるが、保存済みの採用型がある記事はそれを使い、ない記事だけルールで選ぶ
    const needs = tagged.filter((t) => tagged.some((o) => o !== t && placeOf(o) === placeOf(t)));
    const fresh = needs.filter((t) => !t.label && recipeOf(t.c));
    const used = new Set(needs.filter((t) => t.label).map((t) => t.label));
    let other = 0;
    for (const t of fresh) {
      const others = needs.filter((o) => o !== t && recipeOf(o.c)).map((o) => recipeOf(o.c));
      const best = pickLabelCard(recipeOf(t.c), others, usage);
      if (best && !used.has(best.label)) Object.assign(t, best);
      else {
        // この記事にしかないカードがない（定番カードしかない）ときは「別構築」。保存済みの記事と番号が重ならないようにする
        do other += 1;
        while (used.has(other === 1 ? '別構築' : `別構築${other}`));
        Object.assign(t, { card: null, decks: null, label: other === 1 ? '別構築' : `別構築${other}` });
      }
      used.add(t.label);
      newLabels.set(t.c.slug, t.label);
    }
    for (const t of tagged) {
      const title = titleOf(t);
      if (title !== t.c.title) titles.set(t.c.slug, title);
      else titles.delete(t.c.slug);
    }
    const info = { day: columnDay(list[0]), eventType: eventTypeOf(list[0]), deckName: list[0].deckName };
    groups.push({ ...info, columns: tagged });
    const dup = tagged.filter((t) => tagged.some((o) => o !== t && titleOf(o) === titleOf(t)));
    if (dup.length) unresolved.push({ ...info, columns: dup.map((t) => t.c) });
  }
  return { titles, newLabels, groups, unresolved, total: usage.total };
}

/** PR に出す、グループの記事1本の区別のしかた（「千葉」「「ヒーローマント」を選んで（ヒーローマント採用型）」「別構築：この記事にしかないカードがない」） */
export function memberNote(t) {
  if (t.saved) return `${t.label}：保存済み（${t.saved === 'manual' ? '手で書いた名前' : '前にルールで付けた名前'}。付け直さない）`;
  if (t.label) return t.card ? `「${t.card}」を選んで（${t.label}。${t.decks}本のデッキ記事に入っている）` : `${t.label}：この記事にしかないカードがない（定番カードをのぞく）`;
  return t.tag ?? '区別なし';
}
