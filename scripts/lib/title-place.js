// 同じ日・同じ名前のデッキ記事のタイトルを、開催地で区別する
// scripts/auto-deck-updater.js・scripts/apply-deck-name-rules.js から使う
//
// デッキ名には「（〇〇採用型）」のような付け足しをしないため、同じ日に同じ名前の記事が並ぶとタイトルが重なることがある。
// そのときだけ、タイトルの【】の中に都道府県を付ける（例: 【9/26 シティリーグ優勝・千葉】メガゲッコウガexデッキレシピ！…）。
// 同じグループに同じ都道府県の記事があれば、代わりに店舗名を付ける。店舗のデータ（venue）がない記事（ジムバトルなど）は区別できないので、
// タイトルが重なったままのものを返し、PR で人に知らせる。URL（slug）は変えない

import { columnDay } from './deck-variant.js';

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');

/** 「シーガル　仙台駅前店（宮城）」→ { store: 'シーガル 仙台駅前店', pref: '宮城' }（都道府県がなければ pref: null） */
export function venueParts(venue) {
  if (!venue) return null;
  const m = venue.match(/^(.*?)[（(]([^（）()]+)[）)]\s*$/);
  const clean = (s) => s.replace(/[\s　]+/g, ' ').trim();
  return m ? { store: clean(m[1]), pref: clean(m[2]) } : { store: clean(venue), pref: null };
}

/** タイトルの先頭の【】を「【{result}・{tag}】」にする（tag がなければ「【{result}】」）。先頭が【{result} でなければ変えない */
export function withPlace(title, result, tag) {
  if (!title.startsWith(`【${result}`)) return title;
  return title.replace(/^【[^】]*】/, `【${result}${tag ? `・${tag}` : ''}】`);
}

/**
 * 同じ日・同じ名前の記事のグループごとに、タイトルに付ける開催地を決める（columns は書き換えない）。
 * 返り値:
 *   titles   … Map(slug → 新しいタイトル)（今のタイトルと違うものだけ）
 *   groups   … 同じ日・同じ名前の記事のグループ（[{ day, deckName, columns: [{ c, tag }] }]）
 *   unresolved … 店舗のデータがなく、タイトルが重なったままの記事のグループ（[{ day, deckName, columns }]）
 */
export function placeTitles(columns) {
  const byKey = new Map();
  for (const c of columns) {
    const day = columnDay(c);
    if (!day) continue;
    const key = `${day}#${norm(c.deckName)}`;
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
      if (!p) return { c, tag: null };
      // 都道府県がグループの中で1つだけならそれを、ほかの記事と同じなら店舗名を付ける
      const tag = p.pref && count('pref', p.pref) === 1 ? p.pref : p.store;
      return { c, tag };
    });
    const next = new Map(tagged.map(({ c, tag }) => [c, withPlace(c.title, c.result, tag)]));
    for (const [c, title] of next) if (title !== c.title) titles.set(c.slug, title);
    groups.push({ day: columnDay(list[0]), deckName: list[0].deckName, columns: tagged });
    // 付けたあとでもタイトルが重なる記事（店舗のデータがない・同じ店舗）は、人に知らせる
    const dup = list.filter((c) => list.some((o) => o !== c && next.get(o) === next.get(c)));
    if (dup.length) unresolved.push({ day: columnDay(list[0]), deckName: list[0].deckName, columns: dup });
  }
  return { titles, groups, unresolved };
}
