// デッキ記事の見どころ（deck-columns.json の highlight）を Claude API で書く。
// scripts/auto-deck-updater.js（新しい記事）・scripts/ai-highlight-test.js（手動の試し書き。ファイルは変えない）・
// scripts/ai-highlight-rewrite.js（公開済みの記事のまとめ書き直し）から使う
//
// 方針（CLAUDE.md「6. 記事・紹介文の品質基準」）:
// - AI に渡すのは、デッキ名・60枚のレシピ・採用カードの公式テキスト（scripts/lib/game-plan.js の recipeProfiles の内容）だけ
// - 書いた文は reviewAiHighlight で点検する（scripts/lib/highlight.js の決まった文・同じ日の記事の書き出しに加え、
//   主役のカードからの書き出し・長さ・誇張・データにない「」の名前や数字）。引っかかったら理由を伝えて1回だけ書き直させる
// - 点検を通った文は、別の呼び出し（チェック役。review）で、見どころに出てくるカードの公式テキストと見比べさせ、
//   「書いていないこと」ではなく「書いてあることが間違っていないか」（公式テキストとの食い違い・対象の取り違え・数字・条件の抜けで文が誤りになる・
//   ルール上できない組み合わせ）だけを見させる。気になった点を1つずつ「誤り / 問題なし」で JSON で答えさせ、「誤り」が1つでもあれば要確認、
//   なければ問題なし、とプログラムで決める（parseReview）。公式テキストがないカードは notes に参考として書かせる
// - 要確認なら、「誤り」の理由を書く役に渡して1回だけ直させ（fix）、もう一度チェックする（checkAndFix）。それでも要確認なら PR で人に知らせる
// - 公式テキストには書かれていないが、ゲームのルールで決まっていること（scripts/lib/game-rules.md）は、書く役とチェック役の両方に渡す
// - それでも通らないとき・API のエラー・キーがないとき・呼び出し回数の上限に達したときは null を返し、
//   呼び出し側は従来の方法（scripts/lib/highlight.js）の見どころを使う。ここで例外を投げて記事の自動生成を止めることはしない
// - 一覧のカードに出す「ひとこと」（deck-columns.json の tagline。TAGLINE_MIN〜TAGLINE_MAX 字）も、見どころのあとに別の呼び出しで書く（writeTagline）。
//   渡すのは見どころと同じデータ＋その記事の見どころ（参考）。答えは JSON の tagline（完成したひとこと1本だけ。字数を数える考えごとを本文に書かせない）。
//   点検は reviewTagline（長さをはみ出したら「今○字なので、あと○字削って」と伝えて2回まで書き直させる。書き直しは毎回1通のメッセージで呼ぶ）、
//   チェック役・直し（checkAndFix(…, { kind: 'tagline' })）は見どころと同じ基準。書けなかったときは null を返し、一覧は見どころを出す

import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { HIGHLIGHT_MAX, bannedPhrases, opening } from './highlight.js';

/**
 * AI の見どころの設定。**モデルを変えるときは model だけを書き換える**（料金の目安は下の PRICES に載っているモデルだけ出る）。
 * - effort: 考える深さ（low / medium / high）。effort に対応していないモデル（claude-haiku-4-5 など）にするときは null にする
 * - maxCallsPerRun: 1回の実行（npm run auto-decks / auto-city それぞれ）で API を呼ぶ回数の上限。不具合で何度も呼ばないための歯止め
 *   （見どころ・ひとことのチェック役・直しの分も数える。1本あたり見どころ最大5回＋ひとこと最大7回）
 * - maxTokens: 1回の応答の上限（考える分を含む）
 */
export const AI_HIGHLIGHT_CONFIG = {
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  maxCallsPerRun: 80,
  maxTokens: 8000,
  timeoutMs: 120_000,
};

/**
 * まとめ書き直し（scripts/ai-highlight-rewrite.js）とチェック役の試し（scripts/ai-highlight-review.js）だけの、1回の実行で API を呼ぶ回数の上限
 * （チェック役の呼び出しも数える。通常の自動生成は maxCallsPerRun のまま）
 */
export const REWRITE_MAX_CALLS = 250;

/** 料金の目安（ドル / 100万トークン。Anthropic の料金表 2026年9月時点）。載っていないモデルは料金を「不明」と出す */
export const PRICES = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

/** 見どころの長さの下限（全角。上限は従来の見どころと同じ HIGHLIGHT_MAX） */
export const AI_HIGHLIGHT_MIN = 80;

/** ひとこと（一覧のカードに出す短い紹介。deck-columns.json の tagline）の長さ（全角）。はみ出したら AI に書き直させる */
export const TAGLINE_MIN = 30;
export const TAGLINE_MAX = 40;

/** ひとことを書く回数の上限（最初の1回＋書き直し2回）と、チェック役の指摘で直すときの回数の上限（直す1回＋長さなどの書き直し1回） */
export const TAGLINE_MAX_ATTEMPTS = 3;
export const TAGLINE_FIX_ATTEMPTS = 2;

/** この長さ（全角）以上の公式テキストの1文がそのまま入っていたら、説明文の貼り付けとみなす */
const PASTE_LENGTH = 25;

/** 誇張（使わせない言い方） */
const EXAGGERATION = /最強|必勝|絶対|無敵|圧倒的|最高|完璧|確実に勝/;

const nfkc = (s) => (s ?? '').normalize('NFKC');

/**
 * ポケカの基本ルールのメモ（scripts/lib/game-rules.md の「## ルール」の下の「- 」で始まる行）。
 * 公式テキストには書かれていないが、ゲームのルールで決まっていること。書く役とチェック役の両方に渡す
 */
export function parseGameRules(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s*ルール$/.test(l.trim()));
  if (start < 0) return [];
  const rules = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('#')) break;
    const m = line.match(/^\s*-\s+(.+?)\s*$/);
    if (m) rules.push(m[1]);
  }
  return rules;
}

export const GAME_RULES = parseGameRules(readFileSync(new URL('./game-rules.md', import.meta.url), 'utf8'));

/** プロンプトに入れるルールのメモの段落 */
const rulesSection = (rules) =>
  rules.length
    ? `\n\nポケカの基本ルール（公式テキストには書かれていないが、ゲームのルールで決まっていること。正しいこととして扱う）:\n${rules.map((r) => `- ${r}`).join('\n')}`
    : '';

const SYSTEM = `あなたはポケモンカードの大会入賞デッキを紹介するサイトの編集者です。デッキ記事の「見どころ」を1段落で書きます。
使ってよい情報は、ユーザーが渡す「デッキ名」「60枚のレシピ」「採用カードの公式テキスト」だけです。

守ること:
- 書き出しは、指定された主役のカードの名前から始める
- 渡した情報に書かれていないこと（カードの効果・HP・ダメージ・枚数・ほかのデッキとの相性・環境や大会での評判など）は書かない。知っている知識で補わない
- 数字（ダメージ・ダメカンの数・枚数など）は、公式テキストかレシピに書いてある数字だけを使う。足し算などで新しい数字を作らない
- ワザ・特性の名前は「」で囲み、公式テキストの表記のまま書く
- 書くカードは、主役のカードと、それを支えるカード1枚まで。それ以外のカードは書かない
- 公式テキストの文をそのまま貼り付けない。主役のカードが何をするのか、どのカードとどう組み合わせて戦うのかが伝わる、自然な日本語の文に言い換える
- 長さは全角で${AI_HIGHLIGHT_MIN + 20}〜${HIGHLIGHT_MAX - 10}字くらい（${HIGHLIGHT_MAX}字を超えない）。改行しない。文末は「〜する」「〜できる」の形にする
- 「最強」「必勝」「絶対」「無敵」のような誇張はしない
- 「〇〇を採用した〇〇デッキ」「〜をまとめて確認」のような、名前を入れ替えるだけでどのデッキにも使える決まり文句は使わない
- 前置き・見出し・箇条書き・説明は付けず、見どころの文だけを出力する${rulesSection(GAME_RULES)}`;

/** カード1枚分の公式テキスト（プロンプト用） */
function cardBlock(name, profile, category) {
  const head = [category, profile.stage, profile.hp ? `HP${profile.hp}` : null].filter(Boolean).join('・');
  const lines = (profile.effects ?? []).map((e) => {
    const title = e.name ? `${e.kind}「${e.name}」` : e.kind;
    const cost = e.cost ? `［${e.cost}］` : '';
    const damage = e.damage ? ` ${e.damage}` : '';
    return `- ${title}${cost}${damage}${e.text ? `：${e.text.replace(/\n/g, '')}` : ''}`;
  });
  return [`### ${name}${head ? `（${head}）` : ''}`, ...(lines.length ? lines : ['- （テキストなし）'])].join('\n');
}

/**
 * AI に渡す文（デッキ名・60枚のレシピ・採用カードの公式テキストだけ）
 * @param {{ deckName: string, main: string, recipe: {name: string, qty: number, category?: string}[], profiles: Map<string, {stage?: string, hp?: number, effects: object[]}> }} input
 */
export function buildPrompt({ deckName, main, recipe, profiles }) {
  const recipeLines = recipe.map((e) => `- ${e.category ? `${e.category}：` : ''}${e.name} ×${e.qty}`);
  const total = recipe.reduce((s, e) => s + e.qty, 0);
  const categoryOf = (n) => recipe.find((e) => e.name === n)?.category;
  const cards = [...profiles.entries()].map(([n, p]) => cardBlock(n, p, categoryOf(n)));
  return [
    `デッキ名: ${deckName}`,
    `主役のカード: ${main}（見どころはこのカード名から書き始める）`,
    '',
    `## 60枚のレシピ（合計${total}枚）`,
    ...recipeLines,
    '',
    '## 採用カードの公式テキスト（基本エネルギーは省略）',
    ...cards,
  ].join('\n');
}

/** データに書かれている「」の名前・数字（AI の文にこれ以外が出たら、データにないことを書いたとみなす） */
function knownFacts({ deckName, recipe, profiles }) {
  const quotes = new Set();
  const numbers = new Set();
  const addNumbers = (s) => {
    for (const m of nfkc(s).matchAll(/\d+/g)) numbers.add(m[0]);
  };
  for (const e of recipe) {
    quotes.add(nfkc(e.name));
    addNumbers(e.name);
    numbers.add(String(e.qty));
  }
  addNumbers(deckName);
  numbers.add(String(recipe.reduce((s, e) => s + e.qty, 0)));
  for (const [name, p] of profiles) {
    quotes.add(nfkc(name));
    if (p.hp) numbers.add(String(p.hp));
    for (const e of p.effects ?? []) {
      if (e.name) quotes.add(nfkc(e.name));
      for (const q of nfkc(e.text).matchAll(/「([^」]+)」/g)) quotes.add(q[1]);
      addNumbers(e.text);
      addNumbers(e.damage);
    }
  }
  return { quotes, numbers };
}

/**
 * AI が書いた見どころの点検。問題があれば理由（日本語。書き直しの指示と PR に使う）の配列、なければ空
 * @param text AI の文
 * @param input { deckName, main, recipe, profiles, names, others: [{ slug, highlight, names }] }（others は同じ日のほかの記事）
 */
export function reviewAiHighlight(text, input) {
  const problems = [];
  const t = text ?? '';
  if (!t) return ['文が空でした'];
  if (/\n|^\s*[#\-*・]|^見どころ/.test(t)) problems.push('前置き・見出し・箇条書き・改行を付けず、1段落の見どころの文だけにしてください');
  if (t.length > HIGHLIGHT_MAX) problems.push(`長すぎます（${t.length}字）。${HIGHLIGHT_MAX}字以内にしてください`);
  if (t.length < AI_HIGHLIGHT_MIN) problems.push(`短すぎます（${t.length}字）。${AI_HIGHLIGHT_MIN}字以上にしてください`);
  if (!nfkc(t).startsWith(nfkc(input.main))) problems.push(`主役のカード「${input.main}」の名前から書き始めてください`);
  for (const label of bannedPhrases(t)) problems.push(`決まり文句${label}は使わないでください`);
  const exaggeration = t.match(EXAGGERATION);
  if (exaggeration) problems.push(`「${exaggeration[0]}」のような誇張は使わないでください`);
  const facts = knownFacts(input);
  const unknownQuotes = [...new Set([...nfkc(t).matchAll(/「([^」]+)」/g)].map((m) => m[1]).filter((q) => !facts.quotes.has(q)))];
  if (unknownQuotes.length) problems.push(`「${unknownQuotes.join('」「')}」は渡したカードテキストにない名前です。公式テキストの表記のまま書いてください`);
  const unknownNumbers = [...new Set([...nfkc(t).matchAll(/\d+/g)].map((m) => m[0]).filter((n) => !facts.numbers.has(n)))];
  if (unknownNumbers.length) problems.push(`数字「${unknownNumbers.join('」「')}」は渡したデータに書かれていません。書かれている数字だけを使ってください`);
  // カードの説明文の貼り付け（公式テキストの長い1文がそのまま入っている）
  const pasted = [...input.profiles.values()]
    .flatMap((p) => (p.effects ?? []).flatMap((e) => nfkc(e.text).replace(/\n/g, '').split('。')))
    .find((s) => s.length >= PASTE_LENGTH && nfkc(t).includes(s));
  if (pasted) problems.push(`公式テキストの文（「${pasted.slice(0, 20)}…」）をそのまま使っています。何をするデッキかが伝わるように言い換えてください`);
  // 同じ日の記事と書き出しがそっくりか（scripts/lib/highlight.js の similarOpenings と同じ基準）
  const head = opening(t, input.names);
  const same = (input.others ?? []).find((o) => o.highlight && head.length >= 6 && opening(o.highlight, o.names) === head);
  if (same) problems.push(`同じ日の記事（${same.slug}）と書き出しの形がそっくりです（骨組み「${head}…」）。書き出しの言い回しを変えてください`);
  return problems;
}

/** ひとことを書く役への指示 */
const TAGLINE_SYSTEM = `あなたはポケモンカードの大会入賞デッキを紹介するサイトの編集者です。デッキ記事の一覧のカードに出す「ひとこと」（そのデッキの勝ち筋をひと目で伝える短い紹介）を1本書きます。
使ってよい情報は、ユーザーが渡す「デッキ名」「60枚のレシピ」「採用カードの公式テキスト」と、参考の「この記事の見どころ」だけです。

守ること:
- **長さは${TAGLINE_MIN}字以上・${TAGLINE_MAX}字以内。${TAGLINE_MAX}字を1字でも超えると使えない**ので、35字くらいを目安に短く書く（英字の「ex」や数字も1字ずつ数える。かぎかっこ「」も1字ずつ数える）。改行しない。文末に「。」を付けない
- 字数は考えるときに数えて確かめ、答えには書かない。答えの JSON の tagline には、完成したひとこと1本だけを入れる（字数の数え方・下書き・候補・説明・前置きは入れない）
- 主役のカードの名前を必ず入れ、そのデッキ固有の勝ち筋（キーになる特性・ワザ・組み合わせ）を1つだけ書く
- 渡した情報に書かれていないこと（カードの効果・ダメージ・枚数・環境や大会での評判など）は書かない。知っている知識で補わない
- 数字は、公式テキストかレシピに書いてある数字だけを使う。足し算などで新しい数字を作らない
- ワザ・特性の名前は「」で囲み、公式テキストの表記のまま書く
- 書くカードは、主役のカードと、それを支えるカード1枚まで
- 見どころの文をそのまま縮めて貼らず、一覧で読んで何をするデッキかが伝わる言い方にする
- 「最強」「必勝」「絶対」「無敵」のような誇張はしない
- 「〇〇を採用した〇〇デッキ」のような、名前を入れ替えるだけでどのデッキにも使える決まり文句は使わない
- ひとこと全体をかぎかっこでくくらない${rulesSection(GAME_RULES)}`;

/** ひとことの答えの形（structured outputs。答えに考えごとや字数の数え方が混ざらないよう、完成したひとこと1本だけを返させる） */
const TAGLINE_SCHEMA = {
  type: 'object',
  properties: { tagline: { type: 'string' } },
  required: ['tagline'],
  additionalProperties: false,
};

/**
 * ひとことの答え（JSON の文）から、ひとことを取り出す。JSON でなければ答えの文のまま返す（点検で改行・長さに引っかかる）
 * @param raw AI の答えの本文
 */
export function taglineOf(raw) {
  const text = String(raw ?? '').trim();
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (json && typeof json.tagline === 'string') return json.tagline;
  } catch {
    // JSON でない答え（そのまま点検にかける）
  }
  return text;
}

/**
 * ひとことを書く役に渡す文（見どころと同じデータ＋その記事の見どころ）
 * @param input buildPrompt と同じもの＋ highlight（その記事の見どころ。参考）
 */
export function buildTaglinePrompt(input) {
  return [
    buildPrompt(input).replace('（見どころはこのカード名から書き始める）', '（ひとことに必ず名前を入れる）'),
    '',
    '## この記事の見どころ（参考）',
    input.highlight || '（なし）',
    '',
    `上のデータだけを使って、一覧のカードに出す「ひとこと」を1本書いてください。長さは${TAGLINE_MIN}字以上・${TAGLINE_MAX}字以内（${TAGLINE_MAX}字を超えると使えません。35字くらいが目安）。答えの tagline には完成したひとこと1本だけを入れてください。`,
  ].join('\n');
}

/** ひとことの長さ（文字数。絵文字などのサロゲートペアも1字） */
export const taglineLength = (text) => [...(text ?? '')].length;

/** AI の答えのひとことを整える（前後の空白・全体を囲むかぎかっこ・文末の「。」を外す） */
export function cleanTagline(text) {
  let t = String(text ?? '').trim();
  if (/^[「『].*[」』]$/.test(t) && !/[「『]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
  return t.replace(/[。．.]+$/, '');
}

/**
 * AI が書いたひとことの点検。問題があれば理由の配列、なければ空（長さをはみ出したら書き直させる）
 * @param text AI の文（cleanTagline をかけたもの）
 * @param input { deckName, main, recipe, profiles, names, others: [{ slug, tagline, names }] }（others は同じ日のほかの記事）
 */
export function reviewTagline(text, input) {
  const problems = [];
  const t = text ?? '';
  if (!t) return ['文が空でした'];
  if (/\n/.test(t)) problems.push('改行を付けず、ひとことの文だけにしてください');
  const len = taglineLength(t);
  if (len > TAGLINE_MAX) problems.push(`長すぎます（今${len}字）。あと${len - TAGLINE_MAX}字以上削って、${TAGLINE_MAX}字以内（35字くらい）にしてください`);
  if (len < TAGLINE_MIN) problems.push(`短すぎます（今${len}字）。あと${TAGLINE_MIN - len}字以上足して、${TAGLINE_MIN}字以上にしてください`);
  if (!nfkc(t).includes(nfkc(input.main))) problems.push(`主役のカード「${input.main}」の名前を入れてください`);
  for (const label of bannedPhrases(t)) problems.push(`決まり文句${label}は使わないでください`);
  const exaggeration = t.match(EXAGGERATION);
  if (exaggeration) problems.push(`「${exaggeration[0]}」のような誇張は使わないでください`);
  const facts = knownFacts(input);
  const unknownQuotes = [...new Set([...nfkc(t).matchAll(/「([^」]+)」/g)].map((m) => m[1]).filter((q) => !facts.quotes.has(q)))];
  if (unknownQuotes.length) problems.push(`「${unknownQuotes.join('」「')}」は渡したカードテキストにない名前です。公式テキストの表記のまま書いてください`);
  const unknownNumbers = [...new Set([...nfkc(t).matchAll(/\d+/g)].map((m) => m[0]).filter((n) => !facts.numbers.has(n)))];
  if (unknownNumbers.length) problems.push(`数字「${unknownNumbers.join('」「')}」は渡したデータに書かれていません。書かれている数字だけを使ってください`);
  const same = (input.others ?? []).find((o) => o.tagline && nfkc(o.tagline) === nfkc(t));
  if (same) problems.push(`同じ日の記事（${same.slug}）とひとことが同じです。このデッキ固有の勝ち筋が伝わる文にしてください`);
  return problems;
}

/** チェック役への指示 */
const REVIEW_SYSTEM = `あなたはポケモンカードのデッキ紹介記事の校閲者です。「見どころ」は短い紹介文なので、効果のすべては書きません。見るのは「書いていないこと」ではなく「書いてあることが間違っていないか」だけです。ユーザーが渡す見どころを、そこに出てくるカードの公式テキストと見比べ、次のどれかに当たるときだけ「要確認」にします。
1. 書いてある内容が、公式テキストと食い違っている（例: 「山札にもどす」カードを「回収する」と書いている）
2. どのカードの効果か、効果の対象を取り違えている（例: 別のカードの特性として書いている・エネルギーをつける先が違う）
3. 書いてある数字が、公式テキストの数字と違う
4. 対象を限定する条件が抜けて、書いてある文が間違いになっている（例: 「ルールを持たないポケモンなら」を「ポケモンなら」と書く・「バトルポケモンが特性〇〇を持つなら」を「バトル場にいれば」と書く）
5. カードの組み合わせとして、ルール上できないことを書いている（例: ふしぎなアメで1進化を飛ばしたのに、その1進化の特性を使えるように書いている）

次のものは「要確認」にしない（書いていないだけ・意味が変わらないものは問題なし）:
- 数字・枚数・ダメージを書いていない
- 「自分の番に1回」などの回数の制限を書いていない
- 使ったあとのデメリットや代償（「きぜつする」「山札にもどす」「次の番ワザが使えない」など）を書いていない
- 「最初の番は使えない」など、ゲームの基本ルールを書いていない
- スタジアムが「おたがいに」効くことを書いていない
- 意味が変わらない言い換え・要約・公式テキストから素直に言えること（例: 「6個なら」→「6個のっていれば」、「きぜつさせる」→「HPに関係なくきぜつさせる」）
- 公式テキストが渡されていないカード・特性・ワザ（正しいか確かめられないだけなので、「要確認」にせず、notes に「〇〇は公式テキストがなく確認できず」と参考として書く）

- 文の上手さ・言い回し・長さ・カードの選び方は評価しない
- 書いてあることの正誤は、渡した公式テキストと、下の「ポケカの基本ルール」だけを根拠にする（知っている知識でカードの効果を補わない）。5. では、進化などのゲームの基本ルールも使ってよい
- 「ポケカの基本ルール」に合っている書き方は、公式テキストに書かれていなくても「誤り」にしない

答え方:
- 気になった点を1つずつ checks に書く。point に見どころのどの部分か、judgment に「誤り」（1〜5 に当たる）か「問題なし」（当たらない・上の「要確認にしない」もの）、reason に理由（「誤り」なら、どのカードの・どの部分が・公式テキストではどうなっているかを短く）
- 「誤り」にするときは、quote に根拠になる公式テキストの一文を、渡した公式テキストから一字一句そのまま引用する（言い換え・要約・自分の知識は不可）。引用できる一文がないなら「誤り」にしない。「問題なし」のときは quote は空でよい
- 理由を書いてみて「誤りではない」「問題なし」と思ったら、judgment は「問題なし」にする
- 気になった点がなければ checks は空にする
- 「要確認」かどうかはプログラムが checks から決める（「誤り」が1つでもあれば要確認）。確かめて問題がなかった点は、必ず「問題なし」にする
- 公式テキストが渡されていないカードのことは checks に入れず、notes に書く

「見どころ」の代わりに「ひとこと」（一覧のカードに出す${TAGLINE_MIN}〜${TAGLINE_MAX}字の短い紹介）が渡されたときも、同じ基準・同じ答え方で見る（とても短いので、省略は 4. に当たるとき以外すべて問題なし）${rulesSection(GAME_RULES)}`;

/** チェック役の答えの形（structured outputs） */
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          judgment: { type: 'string', enum: ['誤り', '問題なし'] },
          reason: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['point', 'judgment', 'reason', 'quote'],
        additionalProperties: false,
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['checks', 'notes'],
  additionalProperties: false,
};

/** 見どころに名前が出てくるカード（profiles のうち。出てこなければ主役のカード） */
export function mentionedCards(text, profiles, main) {
  const t = nfkc(text);
  const names = [...profiles.keys()].filter((n) => t.includes(nfkc(n)));
  return names.length ? names : [main].filter((n) => profiles.has(n));
}

/**
 * チェック役に渡す文（見どころ・ひとことと、そこに出てくるカードの公式テキストだけ）
 * @param {{ text: string, main: string, recipe?: object[], profiles: Map<string, object>, label?: '見どころ' | 'ひとこと' }} input
 */
export function buildReviewPrompt(input) {
  const cards = reviewCards(input);
  const missing = unverifiableNames(input.text, cards.join('\n'));
  const { text, label = '見どころ' } = input;
  return [
    `## ${label}`,
    text,
    '',
    `## ${label}に出てくるカードの公式テキスト`,
    ...(cards.length ? cards : ['（該当するカードなし）']),
    ...(missing.length ? ['', '## 公式テキストが渡されていない名前（確認できず。要確認にはせず notes に書く）', ...missing.map((n) => `- ${n}`)] : []),
  ].join('\n');
}

/** チェック役に渡すカードの公式テキスト（見どころに出てくるカードの分。1枚1つの文字列） */
function reviewCards({ text, main, recipe = [], profiles }) {
  const categoryOf = (n) => recipe.find((e) => e.name === n)?.category;
  return mentionedCards(text, profiles, main).map((n) => cardBlock(n, profiles.get(n), categoryOf(n)));
}

/** チェック役に渡した公式テキスト（「誤り」の引用がこの中にあるかを確かめる） */
export const reviewCardText = (input) => reviewCards(input).join('\n');

/** 引用の比べ方: 全角半角・空白・かぎかっこ・句読点の違いは見ない */
const quoteKey = (s) => nfkc(s).replace(/[\s「」『』。、，．,.]/g, '');

/** 引用がこの長さ（比べ方をそろえた文字数）より短いときは、根拠の一文とみなさない */
const QUOTE_MIN = 4;

/**
 * 「誤り」の引用が、渡した公式テキストにあるか。「…」で省略した引用は、区切ったそれぞれが公式テキストにあればよい
 * @returns {boolean}
 */
export function quoteFound(quote, cardText) {
  const parts = nfkc(quote)
    .split(/…|\.\.\.|‥/)
    .map(quoteKey)
    .filter(Boolean);
  const all = parts.join('');
  const known = quoteKey(cardText);
  return all.length >= QUOTE_MIN && parts.every((p) => known.includes(p));
}

/** 「誤り」なのに理由に「誤りではない」「問題なし」と書いてあるもの（誤りとして数えない） */
const NOT_WRONG = /誤りではな|誤りでな|誤りとは言えな|問題な[しい]|問題はな/;

/** 見どころの「」の名前のうち、渡す公式テキストのどこにも出てこないもの */
export function unverifiableNames(text, cardText) {
  const known = nfkc(cardText);
  const names = [...nfkc(text).matchAll(/「([^「」]+)」/g)].map((m) => m[1]);
  return [...new Set(names)].filter((n) => !known.includes(n));
}

/**
 * チェック役の答え（JSON の文）を読む。形が違えば例外
 * 判定はプログラムで決める: checks に「誤り」が1つでもあれば要確認（ok: false）、なければ問題なし。
 * reasons は「誤り」の点だけ（「問題なし」の点は PR・ログに出さない）。「どの部分：理由（公式テキスト「引用」）」の形。
 * 次の「誤り」は、誤りとして数えない（ignored に理由をつけて返す。ログにだけ出す）:
 * - 根拠の公式テキストの引用（quote）がない
 * - 引用が、チェック役に渡した公式テキスト（cardText）に見つからない（cardText を渡したときだけ確かめる）
 * - 理由に「誤りではない」「問題なし」などと書いてある
 * notes（公式テキストが渡されていないカードなど、確認できなかったことの参考）は、あるときだけ返す。notes は「要確認」の理由にしない
 * @param raw チェック役の答え（JSON の文）
 * @param {{ cardText?: string }} [options] cardText はチェック役に渡した公式テキスト（reviewCardText）
 * @returns {{ ok: boolean, reasons: string[], notes?: string[], ignored?: string[] }}
 */
export function parseReview(raw, { cardText } = {}) {
  const json = JSON.parse(String(raw ?? '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  const checks = json?.checks;
  if (!Array.isArray(checks) || !checks.every((c) => c && ['誤り', '問題なし'].includes(c.judgment))) {
    throw new Error(`チェック役の答えの形が違う: ${String(raw).slice(0, 100)}`);
  }
  const clean = (s) => String(s ?? '').trim();
  const reasons = [];
  const ignored = [];
  for (const c of checks.filter((x) => x.judgment === '誤り')) {
    const label = [clean(c.point), clean(c.reason)].filter(Boolean).join('：') || '理由の記載なし';
    const quote = clean(c.quote);
    if (!quote) ignored.push(`${label}（根拠の公式テキストの引用がない）`);
    else if (cardText !== undefined && !quoteFound(quote, cardText)) ignored.push(`${label}（引用「${quote}」が公式テキストに見つからない）`);
    else if (NOT_WRONG.test(clean(c.reason))) ignored.push(`${label}（理由に「誤りではない」「問題なし」と書いてある）`);
    else reasons.push(`${label}（公式テキスト「${quote}」）`);
  }
  const notes = (Array.isArray(json.notes) ? json.notes : []).map(clean).filter(Boolean);
  const extra = { ...(notes.length ? { notes } : {}), ...(ignored.length ? { ignored } : {}) };
  return reasons.length ? { ok: false, reasons, ...extra } : { ok: true, reasons: [], ...extra };
}

/** チェック役の結果の表示（PR・ログ用）。review は { status: 'ok' | 'warn' | 'error', reasons: string[], notes?: string[] } */
export function reviewLabel(review) {
  if (!review) return '';
  if (review.status === 'ok') return `✅ チェック済み${review.notes?.length ? `（参考・確認できず：${review.notes.join(' / ')}）` : ''}`;
  if (review.status === 'warn') return `⚠ 要確認：${review.reasons.join(' / ')}`;
  return `⚠ チェックできず${review.reasons?.length ? `（${review.reasons.join(' / ')}）` : ''}`;
}

/**
 * 要確認のあとに自分で直したかの表示（PR・ログ用）。fix は checkAndFix の結果の fix
 * - fixed: 「誤り」の理由を渡して直させ、もう一度チェックして問題なしになった
 * - unfixed: 直せなかった（直した文もまた要確認・チェックできず・直す呼び出しが失敗）ので、人に知らせる
 */
export function fixLabel(fix) {
  if (!fix) return '';
  if (fix.outcome === 'fixed') return `🔧 自分で直せた（最初の指摘：${fix.firstReview.reasons.join(' / ')}）`;
  return `🙋 直せずに人に知らせた${fix.reason ? `（${fix.reason}）` : ''}`;
}

/** 応答の本文（text ブロックをつなげ、前後の空白を除く） */
const textOf = (response) =>
  response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

/** 使った量から料金の目安（ドル）。料金表にないモデルは null */
export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICES[model];
  return p ? (inputTokens * p.input + outputTokens * p.output) / 1e6 : null;
}

/**
 * AI で見どころを書く道具を作る（1回の実行で1つ作り、呼び出し回数と使った量を数える）
 * @param {{ apiKey?: string, client?: object, config?: typeof AI_HIGHLIGHT_CONFIG, log?: (msg: string) => void }} [options]
 *   client はテスト用（messages.create を持つもの）。省略時は ANTHROPIC_API_KEY で Anthropic の SDK を使う
 */
export function createAiHighlighter({ apiKey = process.env.ANTHROPIC_API_KEY, client, config = AI_HIGHLIGHT_CONFIG, log = () => {} } = {}) {
  const api = client ?? (apiKey ? new Anthropic({ apiKey, timeout: config.timeoutMs, maxRetries: 2 }) : null);
  // reviewCalls: calls のうちチェック役の分
  // fixCalls: calls のうち、チェック役の「誤り」を直させた分
  const stats = { model: config.model, enabled: Boolean(api), calls: 0, reviewCalls: 0, fixCalls: 0, maxCalls: config.maxCallsPerRun, inputTokens: 0, outputTokens: 0, errors: 0 };

  async function call(messages, { system = SYSTEM, format } = {}) {
    if (stats.calls >= config.maxCallsPerRun) throw new LimitError(`1回の実行で API を呼べる上限（${config.maxCallsPerRun}回）に達した`);
    stats.calls++;
    const outputConfig = { ...(config.effort ? { effort: config.effort } : {}), ...(format ? { format } : {}) };
    const response = await api.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      system,
      messages,
    });
    stats.inputTokens += response.usage?.input_tokens ?? 0;
    stats.outputTokens += response.usage?.output_tokens ?? 0;
    return response;
  }

  /**
   * 書く役の種類ごとの設定（見どころ / ひとこと）
   * - system・prompt: 指示と渡す文
   * - clean: AI の答えの整え方
   * - check: 点検（問題の配列）
   * - label: ログ・チェック役に渡す名前
   * - maxAttempts: 書く回数の上限（最初の1回＋書き直し）
   * - format: 答えの形（structured outputs）。read で答えの本文から文を取り出す
   * - fresh: 書き直し・直しのたびに、1通のメッセージで呼び直す（前の答えと直す点は、渡す文の後ろに書く）。
   *   前の応答（字数を数える考えごとが本文に混ざったもの）を会話に戻すと、断られたり空の答えになったりしたため（ひとこと）
   * - retryRefusal: 断られた（refusal）・空の答えも、点検の問題として書き直させる
   */
  const KINDS = {
    highlight: { system: SYSTEM, prompt: buildPrompt, clean: (t) => t, check: reviewAiHighlight, label: '見どころ', maxAttempts: 2 },
    tagline: {
      system: TAGLINE_SYSTEM,
      prompt: buildTaglinePrompt,
      clean: cleanTagline,
      check: reviewTagline,
      label: 'ひとこと',
      maxAttempts: TAGLINE_MAX_ATTEMPTS,
      format: { type: 'json_schema', schema: TAGLINE_SCHEMA },
      read: taglineOf,
      fresh: true,
      retryRefusal: true,
    },
  };

  /** fresh の種類で、前の答えと直す点を、渡す文の後ろに書く */
  const retryBlock = (spec, previous, heading, request, problems) =>
    ['', `## ${heading}`, previous || '（空でした）', '', request, ...problems.map((p) => `- ${p}`)].join('\n');

  /** 答えの本文（format があれば JSON から取り出す）。空のときは、なぜ空かを調べるためにログに応答の形を出す */
  function answerOf(spec, response) {
    const raw = textOf(response);
    const text = spec.clean(spec.read ? spec.read(raw) : raw);
    if (!text) log(`    （空の答え: stop_reason ${response.stop_reason}・応答のブロック ${response.content.map((b) => b.type).join(', ') || 'なし'}）`);
    return text;
  }

  /** 断られた（refusal）ときの理由の文（分かれば種類も） */
  const refusalReason = (response) => `AI が応答を断った（refusal${response.stop_details?.category ? `・${response.stop_details.category}` : ''}）`;

  /** 点検に引っかかったら書き直させる（見どころは1回・ひとことは2回まで。write・writeTagline の共通部分） */
  async function writeKind(kind, input) {
    const spec = KINDS[kind];
    if (!api) return { text: null, reason: 'ANTHROPIC_API_KEY が設定されていない', attempts: 0 };
    if (spec.fresh) return writeFresh(kind, input);
    const messages = [{ role: 'user', content: spec.prompt(input) }];
    let problems = [];
    let attempts = 0;
    try {
      for (attempts = 1; attempts <= spec.maxAttempts; attempts++) {
        const response = await call(messages, { system: spec.system });
        if (response.stop_reason === 'refusal') return { text: null, reason: 'AI が応答を断った（refusal）', attempts };
        if (response.stop_reason === 'max_tokens') return { text: null, reason: `応答が長さの上限（max_tokens ${config.maxTokens}）で切れた`, attempts };
        const text = spec.clean(textOf(response));
        problems = spec.check(text, input);
        const tag = kind === 'highlight' ? 'AI' : `AI（${spec.label}）`;
        log(`  ${tag} ${attempts}回目: ${text}${problems.length ? `\n    ⚠ ${problems.join(' / ')}` : '\n    ✓ 点検を通過'}`);
        if (problems.length === 0) return { text, attempts };
        if (attempts === spec.maxAttempts) break;
        // 書き直し: 前の応答（考えた内容を含む）をそのまま返し、直す点を伝える（長さをはみ出したときも、ここで短く書き直させる）
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: `次の点を直して、${spec.label}の文だけをもう一度書いてください。\n${problems.map((p) => `- ${p}`).join('\n')}` });
      }
      return { text: null, reason: `書き直しても点検を通らなかった（${problems.join(' / ')}）`, attempts: spec.maxAttempts };
    } catch (error) {
      return apiFailure(error, attempts, '  ⚠ Claude API のエラー');
    }
  }

  /** API の呼び出しの失敗（上限・エラー）を、書けなかった結果にする */
  function apiFailure(error, attempts, logLabel) {
    if (error instanceof LimitError) return { text: null, reason: error.message, attempts: attempts - 1, limit: true };
    stats.errors++;
    const detail = apiErrorDetail(error, [apiKey]);
    log(`${logLabel}: ${detail}`);
    return { text: null, reason: `Claude API のエラー（${detail}）`, attempts, apiError: true, fatal: isFatalApiError(error) };
  }

  /**
   * fresh の種類（ひとこと）を書く・直す。毎回1通のメッセージで呼び、点検に引っかかったら（断られた・空の答えも）
   * 前の答えと直す点（「今○字なので、あと○字削って」など）を渡して、maxAttempts 回まで書かせる
   * @param first 最初の呼び出しで渡す文の後ろに足すもの（直すとき: 直す前の文とチェック役の指摘）。なければ新しく書く
   * @param maxAttempts 書く回数の上限
   * @param onCall 呼んだあとに数えるもの（直しの回数など）
   */
  async function attemptFresh(kind, input, { first = null, maxAttempts, logLabel, onCall = () => {} }) {
    const spec = KINDS[kind];
    const prompt = spec.prompt(input);
    let extra = first ? retryBlock(spec, first.text, first.heading, first.request, first.reasons) : '';
    let problems = [];
    let attempts = 0;
    try {
      for (attempts = 1; attempts <= maxAttempts; attempts++) {
        const response = await call([{ role: 'user', content: prompt + extra }], { system: spec.system, format: spec.format });
        onCall();
        if (response.stop_reason === 'max_tokens') return { text: null, reason: `応答が長さの上限（max_tokens ${config.maxTokens}）で切れた`, attempts };
        const refused = response.stop_reason === 'refusal';
        const text = refused ? '' : answerOf(spec, response);
        problems = refused ? [refusalReason(response)] : spec.check(text, input);
        log(`${logLabel(attempts)}: ${text}${problems.length ? `\n    ⚠ ${problems.join(' / ')}` : '\n    ✓ 点検を通過'}`);
        if (problems.length === 0) return { text, attempts };
        if (refused && !spec.retryRefusal) return { text: null, reason: problems[0], attempts };
        extra = refused
          ? '' // 断られたときは、前の答えを渡さずに書き直させる
          : retryBlock(spec, text, `前に書いた${spec.label}`, `次の点を直して、${spec.label}をもう一度書いてください（ほかの守ることもそのまま守る）。`, problems);
      }
      return { text: null, reason: `${maxAttempts - 1}回書き直しても点検を通らなかった（${problems.join(' / ')}）`, attempts: maxAttempts, problems };
    } catch (error) {
      return apiFailure(error, attempts, `${logLabel(attempts)}で Claude API のエラー`);
    }
  }

  const writeFresh = (kind, input) =>
    attemptFresh(kind, input, { maxAttempts: KINDS[kind].maxAttempts, logLabel: (n) => `  AI（${KINDS[kind].label}） ${n}回目` });

  /**
   * 1記事分の見どころを書く（点検に引っかかったら1回だけ書き直させる）
   * @returns {Promise<{ text: string, attempts: number } | { text: null, reason: string, attempts: number }>}
   */
  const write = (input) => writeKind('highlight', input);

  /**
   * 1記事分のひとこと（一覧のカードに出す TAGLINE_MIN〜TAGLINE_MAX 字）を書く。
   * 点検（reviewTagline。長さのはみ出しを含む）に引っかかったら、理由（「今○字なので、あと○字削って」など）を伝えて2回まで書き直させる。
   * 答えは JSON の tagline（完成したひとこと1本だけ）で受け取る。断られた・空の答えも書き直させる
   * @param input write と同じもの＋ highlight（その記事の見どころ。参考）。others は [{ slug, tagline, names }]
   * @returns {Promise<{ text: string, attempts: number } | { text: null, reason: string, attempts: number }>}
   */
  const writeTagline = (input) => writeKind('tagline', input);

  /**
   * チェック役: 見どころ（またはひとこと）を、そこに出てくるカードの公式テキストと見比べる（1回だけ呼ぶ。例外は投げない）
   * @param {{ text: string, main: string, recipe?: object[], profiles: Map<string, object>, label?: '見どころ' | 'ひとこと' }} input
   * @returns {Promise<{ status: 'ok' | 'warn' | 'error', reasons: string[], notes?: string[], limit?: boolean, apiError?: boolean, fatal?: boolean }>}
   */
  async function review(input) {
    if (!api) return { status: 'error', reasons: ['ANTHROPIC_API_KEY が設定されていない'] };
    try {
      const response = await call([{ role: 'user', content: buildReviewPrompt(input) }], {
        system: REVIEW_SYSTEM,
        format: { type: 'json_schema', schema: REVIEW_SCHEMA },
      });
      stats.reviewCalls++;
      if (response.stop_reason === 'refusal') return { status: 'error', reasons: ['AI が応答を断った（refusal）'] };
      if (response.stop_reason === 'max_tokens') return { status: 'error', reasons: [`応答が長さの上限（max_tokens ${config.maxTokens}）で切れた`] };
      const { ok, reasons, notes, ignored } = parseReview(textOf(response), { cardText: reviewCardText(input) });
      const result = { status: ok ? 'ok' : 'warn', reasons, ...(notes ? { notes } : {}) };
      log(`    チェック役: ${reviewLabel(result)}`);
      // 誤りとして数えなかった「誤り」（引用がない・引用が公式テキストにない・理由が「問題なし」）はログにだけ出す
      if (ignored) log(`    （誤りとして数えなかった点: ${ignored.join(' / ')}）`);
      return result;
    } catch (error) {
      if (error instanceof LimitError) return { status: 'error', reasons: [error.message], limit: true };
      if (!(error instanceof Anthropic.APIError)) {
        log(`    ⚠ チェック役の答えを読めませんでした: ${error?.message ?? error}`);
        return { status: 'error', reasons: ['チェック役の答えを読めなかった'] };
      }
      stats.errors++;
      const detail = apiErrorDetail(error, [apiKey]);
      log(`    ⚠ チェック役で Claude API のエラー: ${detail}`);
      return { status: 'error', reasons: [`Claude API のエラー（${detail}）`], apiError: true, fatal: isFatalApiError(error) };
    }
  }

  /**
   * チェック役の「誤り」の理由を渡して、見どころ（またはひとこと）を1回だけ直させる（点検も通す。例外は投げない）
   * @param input write（ひとことなら writeTagline）と同じもの
   * @param text 要確認になった文
   * @param reasons チェック役の「誤り」の理由
   * @param {{ kind?: 'highlight' | 'tagline' }} [options]
   * @returns {Promise<{ text: string } | { text: null, reason: string, limit?: boolean, apiError?: boolean, fatal?: boolean }>}
   */
  async function fix(input, text, reasons, { kind = 'highlight' } = {}) {
    const spec = KINDS[kind];
    if (!api) return { text: null, reason: 'ANTHROPIC_API_KEY が設定されていない' };
    if (spec.fresh) {
      // ひとこと: 直す前の文と「誤り」の理由を渡して直させる。直した文が長さなどの点検に引っかかったら、もう1回だけ書き直させる
      const r = await attemptFresh(kind, input, {
        first: {
          text,
          heading: `直す前の${spec.label}`,
          request: `この${spec.label}を公式テキストと見比べたチェック役が、次の点を「誤り」と指摘しました。公式テキストに合うように誤りを直し、${spec.label}をもう一度書いてください（ほかの守ることもそのまま守る）。`,
          reasons,
        },
        maxAttempts: TAGLINE_FIX_ATTEMPTS,
        logLabel: (n) => `    直した文${n > 1 ? `（${n}回目）` : ''}`,
        onCall: () => stats.fixCalls++,
      });
      if (r.text) return { text: r.text };
      if (!r.problems) {
        const { attempts, ...rest } = r;
        return rest;
      }
      return { text: null, reason: `直した文が点検を通らなかった（${r.problems.join(' / ')}）` };
    }
    const messages = [
      { role: 'user', content: spec.prompt(input) },
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: `この${spec.label}を公式テキストと見比べたチェック役が、次の点を「誤り」と指摘しました。公式テキストに合うように誤りを直し、${spec.label}の文だけをもう一度書いてください（ほかの守ることもそのまま守る）。\n${reasons.map((r) => `- ${r}`).join('\n')}`,
      },
    ];
    try {
      const response = await call(messages, { system: spec.system });
      stats.fixCalls++;
      if (response.stop_reason === 'refusal') return { text: null, reason: 'AI が応答を断った（refusal）' };
      if (response.stop_reason === 'max_tokens') return { text: null, reason: `応答が長さの上限（max_tokens ${config.maxTokens}）で切れた` };
      const fixed = spec.clean(textOf(response));
      const problems = spec.check(fixed, input);
      log(`    直した文: ${fixed}${problems.length ? `\n    ⚠ ${problems.join(' / ')}` : ''}`);
      if (problems.length) return { text: null, reason: `直した文が点検を通らなかった（${problems.join(' / ')}）` };
      return { text: fixed };
    } catch (error) {
      if (error instanceof LimitError) return { text: null, reason: error.message, limit: true };
      stats.errors++;
      const detail = apiErrorDetail(error, [apiKey]);
      log(`    ⚠ 直すときに Claude API のエラー: ${detail}`);
      return { text: null, reason: `Claude API のエラー（${detail}）`, apiError: true, fatal: isFatalApiError(error) };
    }
  }

  /**
   * チェックして、要確認なら自分で直す（書く→チェック→直す→チェック。直すのは1回まで。例外は投げない）
   * 1. チェック役にかける。問題なし・チェックできずなら、そのまま返す（fix: null）
   * 2. 要確認なら、「誤り」の理由を渡して直させ（fix）、直した文をもう一度チェックする
   * 3. 問題なしになれば直した文を返す（fix.outcome: 'fixed'）。それでも要確認・チェックできず・直せなかったときは fix.outcome: 'unfixed'
   *    （直した文があればその文と2回目のチェックの結果、なければ元の文と1回目の結果を返す。人に知らせる）
   * @param input write と同じもの（deckName, main, recipe, profiles, names, others。ひとことなら highlight も）
   * @param text チェックする見どころ（またはひとこと）
   * @param {{ kind?: 'highlight' | 'tagline' }} [options] kind: 'tagline' ならひとことをチェック・直す（基準は見どころと同じ）
   * @returns {Promise<{ text: string, review: object, fix: null | { outcome: 'fixed' | 'unfixed', before: string, after?: string, firstReview: object, reason?: string }, limit?: boolean, apiError?: boolean, fatal?: boolean }>}
   */
  async function checkAndFix(input, text, { kind = 'highlight' } = {}) {
    const reviewOf = (t) => review({ text: t, main: input.main, recipe: input.recipe, profiles: input.profiles, label: KINDS[kind].label });
    const flags = (...results) => {
      const out = {};
      for (const key of ['limit', 'apiError', 'fatal']) if (results.some((r) => r?.[key])) out[key] = true;
      return out;
    };
    const first = await reviewOf(text);
    if (first.status !== 'warn') return { text, review: first, fix: null, ...flags(first) };
    log('    → 要確認のため、「誤り」の理由を渡して直させます');
    const fixed = await fix(input, text, first.reasons, { kind });
    if (!fixed.text) return { text, review: first, fix: { outcome: 'unfixed', before: text, firstReview: first, reason: fixed.reason }, ...flags(fixed) };
    const second = await reviewOf(fixed.text);
    const outcome = second.status === 'ok' ? 'fixed' : 'unfixed';
    log(`    → ${outcome === 'fixed' ? '自分で直せた' : '直せなかった（人に知らせる）'}`);
    return {
      text: fixed.text,
      review: second,
      fix: { outcome, before: text, after: fixed.text, firstReview: first, ...(second.status === 'error' ? { reason: '直した文をチェックできなかった' } : {}) },
      ...flags(second),
    };
  }

  return { write, writeTagline, review, fix, checkAndFix, stats };
}

class LimitError extends Error {}

/** API のキーらしい文字（sk-ant-…）と、渡したキーの文字を伏せる */
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.split(secret).join('[キーは伏せました]');
  return out.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[キーは伏せました]');
}

/**
 * API のエラーの説明（ログ・PR 用）。HTTP の状態・エラーの種類に加えて、API が返した理由の文（残高不足など）を出す。キーの文字は出さない。
 * 例: 400 BadRequestError invalid_request_error: Your credit balance is too low to access the Anthropic API. …
 */
export function apiErrorDetail(error, secrets = []) {
  const isApi = error instanceof Anthropic.APIError;
  const head = isApi ? [error.status ?? '接続', error.constructor.name, error.type].filter(Boolean).join(' ') : (error?.name ?? 'Error');
  // API が返した本文の error.message（なければ SDK の文）。長すぎるときは切る
  const message = String((isApi ? (error.error?.error?.message ?? error.error?.message ?? error.message) : error?.message) ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const text = message.length > 300 ? `${message.slice(0, 300)}…` : message;
  return redactSecrets(text ? `${head}: ${text}` : head, secrets);
}

/** 続けて呼んでも同じ結果になるエラー（キーが違う・権限がない・残高不足）。まとめ書き直しはここで呼び出しをやめる */
export function isFatalApiError(error) {
  if (!(error instanceof Anthropic.APIError)) return false;
  const message = String(error.error?.error?.message ?? error.message ?? '');
  return error.status === 401 || error.status === 403 || /credit balance|billing/i.test(message);
}

/** 使った量と料金の目安（PR 本文・ログ用の Markdown の行） */
export function usageLines(stats) {
  if (!stats.enabled) return ['- ANTHROPIC_API_KEY が設定されていないため、Claude API は使っていません（見どころはすべて従来の方法）'];
  const cost = estimateCost(stats.model, stats.inputTokens, stats.outputTokens);
  return [
    `- モデル: \`${stats.model}\`（\`scripts/lib/ai-highlight.js\` の \`AI_HIGHLIGHT_CONFIG\`）`,
    `- API を呼んだ回数: ${stats.calls}回（上限 ${stats.maxCalls}回。うちチェック役 ${stats.reviewCalls ?? 0}回${stats.fixCalls ? `・直し ${stats.fixCalls}回` : ''}）${stats.errors ? `・うちエラー ${stats.errors}回` : ''}`,
    `- 使った量: 入力 ${stats.inputTokens.toLocaleString('en-US')} トークン・出力 ${stats.outputTokens.toLocaleString('en-US')} トークン（出力には AI が考えた分を含む）`,
    `- おおよその料金: ${cost === null ? '不明（料金表 PRICES にないモデル）' : `$${cost.toFixed(4)}`}`,
  ];
}
