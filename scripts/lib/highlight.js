// デッキ記事の見どころ（deck-columns.json の highlight。一覧・トップの特集・X投稿文に使う）を、公式のカードテキストから組み立てる。
// scripts/auto-deck-updater.js（新しい記事）と scripts/rewrite-highlights.js（公開済みの記事の書き直し・点検）から使う
//
// 方針（CLAUDE.md「6. 記事・紹介文の品質基準」）:
// - 主役のポケモンの特性・ワザ（名前・ダメージ・効果）と、主役と組み合わせて使うカードの効果を、公式のカードテキストの文のまま使う。
//   テキストにない効果・ダメージを推測で補わない（ダメージは公式の表記「30＋」「20×」をそのまま使う）
// - 「〇〇を採用した〇〇デッキ」「主力カードの効果と最安値をまとめて確認」のような、名前を入れ替えるだけの定型文は作らない。
//   生成後に BANNED_PHRASES と、同じ日の記事同士の書き出しの似かよい（similarOpenings）を点検し、PR で人に知らせる

import { STAPLES } from './deck-variant.js';

/** 見どころの目安の長さ（全角。一覧のカードは2行で省略表示、X投稿文は文単位で詰める） */
export const HIGHLIGHT_MAX = 170;

/**
 * 紹介文に使ってはいけない決まった文（名前を入れ替えるだけで、どのデッキにも使える文）。
 * 自動生成した見どころ・X投稿文にこれが含まれていたら、PR の「確認すべき点」に書く
 */
export const BANNED_PHRASES = [
  { label: '「主力カードの効果と最安値をまとめて確認」', re: /主力カードの効果と最安値/ },
  { label: '「〜をまとめて確認」', re: /まとめて確認/ },
  { label: '「〇〇を採用した〇〇デッキ」', re: /を採用した[^。]{0,40}デッキ/ },
  { label: '「〇〇・〇〇を採用した」', re: /^[^。]{1,40}・[^。]{1,40}を採用した/ },
];

/** 決まった文に当てはまったもの（ラベルの配列。なければ空） */
export const bannedPhrases = (text) => BANNED_PHRASES.filter((p) => p.re.test(text ?? '')).map((p) => p.label);

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
const ENERGY_TYPES = ['草', '炎', '水', '雷', '超', '闘', '悪', '鋼', '竜'];

/**
 * カードテキストのうち、効果そのものを表す最初の1文（scripts/lib/game-plan.js と同じ考え方）。
 * 使える条件・回数だけの文（「自分の番に1回使える。」「このカードは、〜」）は飛ばす
 */
export function effectSentence(text) {
  return (
    (text ?? '')
      .replace(/\n/g, '')
      .split('。')
      .map((s) => s.trim())
      .filter(Boolean)
      .find((s) => !/(1回|何回でも|自分の番に)[^。]*使える$|^このカードは、|^この番、すでに|^［/.test(s)) ?? ''
  );
}

const sentencesOf = (text) =>
  (text ?? '')
    .replace(/\n/g, '')
    .split('。')
    .map((x) => x.trim())
    .filter(Boolean);

/** ワザの効果: 最初の1文にダメージのことが書かれておらず、次の文に書かれているときは、その文まで（「〜コインを投げる。オモテ1回につき50ダメージ」） */
function attackSentence(text) {
  const first = effectSentence(text);
  if (!first || first.includes('ダメージ')) return first;
  const rest = sentencesOf(text);
  const next = rest[rest.indexOf(first) + 1];
  return next && next.includes('ダメージ') ? `${first}。${next}` : first;
}

/**
 * 特性の使える条件（「自分の場に無タイプの「メガシンカex」がいるなら、1回使える。」）。
 * 「自分の番に1回使える」だけの文は条件にならないので空を返す
 */
function abilityCondition(text) {
  const effect = effectSentence(text);
  const cond = sentencesOf(text).find((x) => x !== effect && /使える$/.test(x));
  return (cond ?? '')
    .replace(/、?(自分の番に)?1回使える$/, '')
    .replace(/^自分の番に、?/, '')
    .trim();
}

/** 特性の文（条件があれば「条件、効果」）。withCondition が false なら「で、効果」の形に使う */
function abilityText(text) {
  const cond = abilityCondition(text);
  const effect = effectSentence(text);
  return cond ? { cond: true, text: `${cond}、${effect}` } : { cond: false, text: asPredicate(effect) };
}

/** 主語（カード名）のあとに続けて読めるよう、「このポケモンは、」などの言い出しを整える（意味は変えない） */
const asPredicate = (s) =>
  s
    .replace(/^このポケモンは、/, '')
    .replace(/^このポケモンが(バトル場に)?いる(なら|かぎり)、/, (_, where, cond) => `${where ?? '場に'}いる${cond}、`)
    .replace(/^このカードを/, '')
    .replace(/、このポケモンは、/g, '、');

const damageNumber = (atk) => Number(atk.damage?.match(/\d+/)?.[0] ?? 0);
/**
 * ワザの強さの目安。ダメージが増える（「30＋」「20×」）ワザはデッキの組み方で打点を伸ばすのが狙いなので優先し、
 * 効果のあるワザは、ダメージの数字がなくても主力になりうる
 */
const attackScore = (atk) => damageNumber(atk) + (/[×＋+]/.test(atk.damage ?? '') ? 300 : 0) || (atk.text ? 120 : 0);

/** 主役のいちばん強いワザ（同じ目安なら後ろのワザ） */
function mainAttack(effects) {
  return effects.filter((x) => x.kind === 'ワザ').reduce((best, a) => (!best || attackScore(a) >= attackScore(best) ? a : best), undefined);
}

/** 主役のタイプ（ワザのコストでいちばん多い基本タイプ。無色だけなら null） */
function mainType(effects) {
  const counts = new Map();
  for (const a of effects.filter((x) => x.kind === 'ワザ')) for (const ch of a.cost ?? '') if (ENERGY_TYPES.includes(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** 「ワザ「〇〇」（ダメージ）」の（ ）の中身。ダメージがなければ空 */
const dmg = (atk) => (atk.damage ? `（${atk.damage}）` : '');

/**
 * 主役の特性・ワザと、組み合わせるカードから、文の部品を作る。
 * @returns {{ ability?: string, attack?: string, partners: {name: string, sentence: string, reason: string}[] }}
 */
function sentencesFor({ recipe, profiles, keyCards, main }) {
  const effectsOf = (n) => profiles.get(n)?.effects ?? [];
  const mainEffects = effectsOf(main);
  const ability = mainEffects.find((x) => x.kind === '特性' && x.text);
  const atk = mainAttack(mainEffects);
  const out = { partners: [] };

  if (ability) {
    const a = abilityText(ability.text);
    out.ability = a.cond ? `${main}の特性「${ability.name}」は、${a.text}` : `${main}は特性「${ability.name}」で、${a.text}`;
    out.abilityAfter = `特性「${ability.name}」${a.cond ? 'は、' : 'では、'}${a.text}`;
  }
  if (atk) {
    const s = attackSentence(atk.text);
    out.attack = s
      ? `${ability ? '' : `${main}の`}ワザ「${atk.name}」${dmg(atk)}は、${asPredicate(s)}`
      : `${ability ? '' : `${main}の`}ワザ「${atk.name}」は${atk.cost ? `${atk.cost}の` : ''}エネルギーで${atk.damage}ダメージ`;
    out.attackName = atk.name;
    // 書き出しを変える候補（1文で完結させ、X投稿文で文の区切りで詰めても意味が通るようにする）:
    // 「メガリザードンXexは「インフェルノX」（90×）で、自分の場の…」
    out.attackLead = s ? `${main}は「${atk.name}」${dmg(atk)}で、${asPredicate(s)}` : null;
    // もう1つの主力になりうるワザ（ダメージ100以上か、効果のあるワザ）
    const other = mainEffects.filter((x) => x.kind === 'ワザ' && x !== atk && (damageNumber(x) >= 100 || /[×＋+]/.test(x.damage ?? '')));
    if (other.length > 0) {
      const o = other[other.length - 1];
      const os = attackSentence(o.text);
      out.attack2 = `${main}のもう1つのワザ「${o.name}」${dmg(o)}${os ? `は、${asPredicate(os)}` : ''}`;
    }
  }

  // ── 主役と組み合わせるカード（カードテキストで主役とつながるものを優先） ──
  const type = mainType(mainEffects);
  const mainProfile = profiles.get(main);
  const line = new Set([main, ...(mainProfile?.line ?? [])]);
  const inLine = (n) => line.has(n) || (profiles.get(n)?.line ?? []).includes(main) || norm(main).includes(norm(n));
  const keyRank = (n) => (keyCards.includes(n) ? 6 - keyCards.indexOf(n) : 0);
  const names = [...new Set([...keyCards, ...recipe.map((e) => e.name)])].filter((n) => profiles.has(n) && !inLine(n) && !STAPLES.has(n) && !/^基本.+エネルギー$/.test(n));
  const candidates = [];
  for (const n of names) {
    for (const e of effectsOf(n)) {
      const text = e.text ?? '';
      const sentence = e.kind === 'ワザ' ? attackSentence(text) : effectSentence(text);
      let score = 0;
      let reason = '';
      if (ability && text.includes(`「${ability.name}」`)) [score, reason] = [8, '主役の特性に反応'];
      else if (text.includes(main)) [score, reason] = [8, '主役の名前に反応'];
      else if (type && new RegExp(`(基本)?${type}(エネルギー|ポケモン|タイプ)`).test(text) && /つける|手札に加える|ベンチに出す|進化/.test(text)) [score, reason] = [5, `${type}タイプを支える`];
      else if (e.kind === '特性' && /エネルギー[^。]*つける/.test(text)) [score, reason] = [4, 'エネルギー加速'];
      else if (e.kind === 'ワザ' && (damageNumber(e) >= 150 || /[×＋+]/.test(e.damage ?? '')) && (!atk || e.name !== atk.name)) [score, reason] = [3, 'サブアタッカー'];
      else if (e.kind === '特性' && sentence) [score, reason] = [2, '特性'];
      else if (e.kind === 'スタジアム' && sentence) [score, reason] = [2, 'スタジアム'];
      // 主役とのつながりがテキストから読み取れない主力カード（記事の「主力カードの効果」に載るもの）は、書き出しを変える候補にだけ使う
      else if (keyCards.includes(n) && e.kind !== 'ワザ' && e.kind !== 'ルール' && sentence) [score, reason] = [1, '主力カード'];
      if (!score || (!sentence && e.kind !== 'ワザ')) continue;
      let s;
      if (e.kind === '特性') {
        const a = abilityText(text);
        s = `${n}の特性「${e.name}」${a.cond ? 'は、' : 'で、'}${a.text}`;
      }
      else if (e.kind === 'ワザ') s = sentence ? `${n}のワザ「${e.name}」${dmg(e)}は、${asPredicate(sentence)}` : `${n}のワザ「${e.name}」で${e.damage}ダメージ`;
      else if (e.kind === 'スタジアム') s = `${n}が出ていれば、${asPredicate(sentence)}`;
      else if (/エネルギー/.test(e.kind)) s = `${n}は、${asPredicate(sentence)}`;
      else s = `${n}で、${asPredicate(sentence)}`;
      candidates.push({ name: n, sentence: s, reason, weak: score === 1, score: score * 10 + keyRank(n) });
    }
  }
  const seen = new Set();
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.partners.push(c);
  }
  return out;
}

/** 文を「。」でつなぎ、HIGHLIGHT_MAX を超える文は足さない（最初の文だけは必ず入れる） */
function joinWithin(parts) {
  let text = '';
  for (const p of parts.filter(Boolean)) {
    const next = `${text}${p}。`;
    if (text && next.length > HIGHLIGHT_MAX) continue;
    text = next;
  }
  return text.replace(/。$/, '');
}

/**
 * 見どころの候補（書き出しの違う順番を複数）。先頭がいちばん自然な順番。
 * 同じ日の記事と書き出しが似てしまうときは、次の候補を使う（chooseHighlights）
 * @param {{ recipe: {name: string, qty: number}[], profiles: Map<string, {effects: {kind: string, name: string, cost: string, damage: string, text: string}[], line?: string[]}>, keyCards: string[], main?: string }} input
 * @returns {string[]} 空なら、カードテキストが足りず作れなかった（TODO のまま PR で報告する）
 */
export function highlightCandidates({ recipe, profiles, keyCards, main = keyCards[0] }) {
  const s = sentencesFor({ recipe, profiles, keyCards, main });
  const strong = s.partners.filter((p) => !p.weak);
  const [p1, p2] = strong.length > 0 ? strong : s.partners;
  if (!s.ability && !s.attack) return [];
  // 特性がないときは、ワザの文が「〇〇のワザ」で始まる
  const attackFirst = s.attack && !s.ability ? s.attack : s.attack ? `${main}のワザ${s.attack.replace(/^ワザ/, '')}` : null;
  const orders = [
    [s.ability, s.attack, strong[0]?.sentence, s.attack2, strong[1]?.sentence],
    [attackFirst, s.abilityAfter, s.attack2, p1?.sentence],
    s.attackLead ? [s.attackLead, s.abilityAfter, strong[0]?.sentence, s.attack2] : null,
    p1 ? [p1.sentence, s.ability ?? attackFirst, s.ability ? s.attack : s.attack2] : null,
    p2 ? [p2.sentence, attackFirst ?? s.ability, p1?.sentence] : null,
  ].filter(Boolean);
  return [...new Set(orders.map(joinWithin).filter(Boolean))];
}

/**
 * 書き出しを比べるための骨組み: カード名・「」の中・数字を記号に置き換える
 * （「メガヘラクロスexのワザ「やまどつき」（170）は、」と「ソウブレイズexのワザ「しんえんほむら」（30＋）は、」は同じ骨組み）
 */
export function skeleton(text, names = []) {
  let t = text ?? '';
  for (const n of [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)) t = t.split(n).join('○');
  return t
    .replace(/「[^」]*」/g, '「□」')
    .replace(/[0-9０-９]+[＋+×]?/g, '9')
    .replace(/[A-Za-zＡ-Ｚａ-ｚ]+/g, '')
    .replace(/○+/g, '○');
}

/** 書き出しの長さの上限（骨組みの文字数） */
export const OPENING_LENGTH = 12;
/**
 * 書き出し: 骨組みの最初の「、」「。」まで（最大 OPENING_LENGTH 文字）。これが同じなら「書き出しがそっくり」とみなす
 * （「○は特性「□」で、」「○のワザ「□」（9）は、」など、名前を入れ替えただけの書き出し）
 */
export function opening(text, names) {
  const sk = skeleton(text, names);
  const cut = sk.search(/[、。]/);
  return cut >= 0 && cut < OPENING_LENGTH ? sk.slice(0, cut + 1) : sk.slice(0, OPENING_LENGTH);
}

/**
 * 同じ日の記事同士で書き出しがそっくりな組を返す。
 * @param items [{ slug, highlight, names }]（names はそのデッキのカード名。骨組みを作るのに使う）
 */
export function similarOpenings(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = opening(items[i].highlight, items[i].names);
      if (a.length >= 6 && a === opening(items[j].highlight, items[j].names)) pairs.push([items[i], items[j], a]);
    }
  return pairs;
}

/**
 * 同じ日に作る記事の見どころを、書き出しが重ならないように選ぶ。
 * @param decks [{ slug, candidates: string[], names: string[] }]
 * @param existing 同じ日にすでにある記事 [{ slug, highlight, names }]（書き出しの比較だけに使い、書き換えない）
 * @returns Map<slug, string>（候補が空のデッキは入らない）
 */
export function chooseHighlights(decks, existing = []) {
  const used = existing.map((e) => opening(e.highlight, e.names));
  const chosen = new Map();
  for (const d of decks) {
    if (d.candidates.length === 0) continue;
    const pick = d.candidates.find((c) => !used.includes(opening(c, d.names))) ?? d.candidates[0];
    used.push(opening(pick, d.names));
    chosen.set(d.slug, pick);
  }
  return chosen;
}

/**
 * 見どころの点検（決まった文・同じ日の書き出しの似かよい）。PR 本文の「確認すべき点」に使う
 * @param items [{ slug, pubDate, highlight, names, xText? }]
 * @returns {{ banned: {slug: string, where: string, labels: string[]}[], similar: [object, object, string][] }}
 */
export function auditHighlights(items) {
  const banned = [];
  for (const it of items) {
    const h = bannedPhrases(it.highlight);
    if (h.length) banned.push({ slug: it.slug, where: '見どころ', labels: h });
    const x = bannedPhrases(it.xText);
    if (x.length) banned.push({ slug: it.slug, where: 'X投稿文', labels: x });
  }
  const byDate = new Map();
  for (const it of items) byDate.set(it.pubDate, [...(byDate.get(it.pubDate) ?? []), it]);
  const similar = [...byDate.values()].flatMap((group) => similarOpenings(group));
  return { banned, similar };
}
