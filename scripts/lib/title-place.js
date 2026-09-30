// 同じ日・同じ大会の種類・同じ名前のデッキ記事のタイトルを区別する
// scripts/auto-deck-updater.js・scripts/apply-deck-name-rules.js から使う
//
// デッキ名には「（〇〇採用型）」のような付け足しをしないため、同じ日に同じ名前の記事が並ぶとタイトルが重なることがある。
// そのときだけ、タイトルで区別する（一覧のカードや記事の見出しに出るデッキ名はシンプルなまま。URL（slug）も変えない）。
// 1. 開催地: タイトルの【】の中に都道府県を付ける（例: 【9/26 シティリーグ優勝・千葉】メガゲッコウガexデッキレシピ！…）。
//    同じグループに同じ都道府県の記事があれば、代わりに店舗名を付ける
// 2. 店舗のデータ（venue）がない記事（ジムバトルなど）は、レシピの違いからデッキ名のあとに「（〇〇採用型）」を付ける
//    （例: 【9/26 ジムバトル優勝】メガゲッコウガex（ノココッチex採用型）デッキレシピ…）。選び方は recipeLabels を見る
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

/** タイトルの【】のすぐあとのデッキ名に「（{label}）」を付ける（label がなければ外す）。【】のあとがデッキ名でなければ変えない */
export function withLabel(title, deckName, label) {
  const m = title.match(/^(【[^】]*】)(.*)$/);
  if (!m || !m[2].startsWith(deckName)) return title;
  const rest = m[2].slice(deckName.length).replace(/^（[^（）]*(?:採用型|別構築\d*)）/, '');
  return `${m[1]}${deckName}${label ? `（${label}）` : ''}${rest}`;
}

/** カードの種類の優先順（ポケモン → サポート → グッズ・ポケモンのどうぐ・スタジアム）。それ以外（エネルギーなど）は選ばない */
const CATEGORY_RANK = { ポケモン: 0, サポート: 1, グッズ: 2, ポケモンのどうぐ: 2, スタジアム: 2 };
const qtyOfEntry = (e) => e.qty ?? e.count ?? 0;

/**
 * 同じグループのレシピどうしを比べて、タイトルに付ける「（〇〇採用型）」を決める。
 * - その記事にしか入っていないカードから選ぶ（ほかの記事にも入っているカードは、枚数が違っても選ばない）
 * - 種類の順: ポケモン → サポート → グッズ・ポケモンのどうぐ・スタジアム（基本エネルギー・特殊エネルギーは選ばない）
 * - 同じ種類なら枚数の多い順、それも同じならレシピ（元の公式デッキ）で先に出てくる順
 * - その記事にしかないカードが1枚もなければ「別構築」（2本以上あれば「別構築」「別構築2」「別構築3」…の順）
 * recipes は記事の順に並んだレシピ（{ name, qty|count, category } の配列）。
 * 返り値: 記事の順に { card: 選んだカード名（別構築なら null）, label: 「ノココッチex採用型」「別構築2」など }
 */
export function recipeLabels(recipes) {
  let other = 0;
  return recipes.map((recipe, i) => {
    const others = new Set(recipes.filter((_, j) => j !== i).flatMap((r) => r.map((e) => norm(e.name))));
    const totals = new Map();
    recipe.forEach((e, order) => {
      if (!(e.category in CATEGORY_RANK) || others.has(norm(e.name))) return;
      const t = totals.get(e.name) ?? { name: e.name, rank: CATEGORY_RANK[e.category], qty: 0, order };
      t.qty += qtyOfEntry(e);
      totals.set(e.name, t);
    });
    const best = [...totals.values()].sort((a, b) => a.rank - b.rank || b.qty - a.qty || a.order - b.order)[0];
    if (best) return { card: best.name, label: `${best.name}採用型` };
    other += 1;
    return { card: null, label: other === 1 ? '別構築' : `別構築${other}` };
  });
}

/**
 * 同じ日・同じ大会の種類・同じ名前の記事のグループごとに、タイトルを決める（columns は書き換えない）。
 * recipeOf(c) は記事のレシピ（なければ null）。
 * 返り値:
 *   titles     … Map(slug → 新しいタイトル)（今のタイトルと違うものだけ）
 *   groups     … グループの一覧（[{ day, eventType, deckName, columns: [{ c, tag, card, label }] }]。tag は開催地、label は「（〇〇採用型）」の中身、card は選んだカード）
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
  const groups = [];
  const unresolved = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const parts = new Map(list.map((c) => [c, venueParts(c.venue)]));
    const count = (key, value) => list.filter((o) => parts.get(o)?.[key] === value).length;
    const tagged = list.map((c) => {
      const p = parts.get(c);
      // 都道府県がグループの中で1つだけならそれを、ほかの記事と同じなら店舗名を付ける
      const tag = p ? (p.pref && count('pref', p.pref) === 1 ? p.pref : p.store) : null;
      return { c, tag, card: null, label: null };
    });
    const titleOf = (t) => withLabel(withPlace(t.c.title, t.c.result, t.tag), t.c.deckName, t.label);
    const colliding = () => tagged.filter((t) => tagged.some((o) => o !== t && titleOf(o) === titleOf(t)));
    // 開催地で区別できない記事（店舗のデータがない・同じ店舗）には、レシピの違いから「（〇〇採用型）」を付ける
    const rest = colliding().filter((t) => recipeOf(t.c));
    if (rest.length > 1) {
      const labels = recipeLabels(rest.map((t) => recipeOf(t.c)));
      rest.forEach((t, i) => Object.assign(t, labels[i]));
    }
    for (const t of tagged) {
      const title = titleOf(t);
      if (title !== t.c.title) titles.set(t.c.slug, title);
    }
    const info = { day: columnDay(list[0]), eventType: eventTypeOf(list[0]), deckName: list[0].deckName };
    groups.push({ ...info, columns: tagged });
    const dup = colliding();
    if (dup.length) unresolved.push({ ...info, columns: dup.map((t) => t.c) });
  }
  return { titles, groups, unresolved };
}

/** PR に出す、グループの記事1本の区別のしかた（「千葉」「「ヒーローマント」を選んで（ヒーローマント採用型）」「別構築：この記事にしかないカードがない」） */
export function memberNote(t) {
  if (t.label) return t.card ? `「${t.card}」を選んで（${t.label}）` : `${t.label}：この記事にしかないカードがない`;
  return t.tag ?? '区別なし';
}
