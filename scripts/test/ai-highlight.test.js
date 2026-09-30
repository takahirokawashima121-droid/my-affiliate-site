// scripts/lib/ai-highlight.js（見どころを Claude API で書く・点検・書き直し・従来の方法への切り替え）のテスト（npm test）
// API は呼ばない（messages.create を持つ偽のクライアントで応答を決める）。カードテキストは実際の記事ページから読む

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  AI_HIGHLIGHT_CONFIG,
  GAME_RULES,
  TAGLINE_MAX,
  TAGLINE_MIN,
  buildPrompt,
  buildReviewPrompt,
  buildTaglinePrompt,
  cleanTagline,
  createAiHighlighter,
  estimateCost,
  fixLabel,
  mentionedCards,
  parseGameRules,
  parseReview,
  quoteFound,
  reviewAiHighlight,
  reviewLabel,
  reviewTagline,
  taglineOf,
  taglineLength,
  unverifiableNames,
  usageLines,
} from '../lib/ai-highlight.js';
import { effectsFromPage } from '../rewrite-highlights.js';
import { testCaseMark, testCaseResult } from '../ai-highlight-review.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const recipes = JSON.parse(read('src/data/official-decks.json'));
const columns = JSON.parse(read('src/data/deck-columns.json'));
const nameOfId = new Map(JSON.parse(read('src/data/cards.json')).map((c) => [c.id, c.name]));

const SLUG = 'mega-sharpedo-ex-deck-0927';
function input(slug = SLUG, others = []) {
  const column = columns.find((c) => c.slug === slug);
  const recipe = recipes[column.deckKey].cards;
  const profiles = effectsFromPage(read(`src/pages/columns/${slug}.astro`), nameOfId);
  return { deckName: column.deckName, main: column.keyCards[0], recipe, profiles, names: [...recipe.map((e) => e.name), ...column.keyCards], others };
}

/** 点検を通る見どころ（カードテキストにある名前・数字だけ。言い換えた文） */
const GOOD =
  'メガサメハダーexは、自分にダメカンがのっていれば「ハングリージョー」で150ダメージを上乗せできるアタッカー。モモワロウexの特性「しはいのくさり」でベンチの悪ポケモンと入れ替えながら相手をどくにし、くさりもちでワザのダメージをさらに40増やせる';

/** 決まった応答を順に返す偽のクライアント（受け取った引数を記録する） */
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(structuredClone(params));
        const r = replies[calls.length - 1];
        if (r instanceof Error) throw r;
        return { stop_reason: r.stop_reason ?? 'end_turn', content: r.text === undefined && r.stop_reason ? [] : [{ type: 'text', text: r.text ?? '' }], usage: { input_tokens: 1000, output_tokens: 500 } };
      },
    },
  };
}

test('AI に渡すのはデッキ名・60枚のレシピ・採用カードの公式テキストだけで、主役のカードから書き始めるよう伝える', () => {
  const prompt = buildPrompt(input());
  assert.match(prompt, /^デッキ名: メガサメハダーex/);
  assert.match(prompt, /主役のカード: メガサメハダーex（見どころはこのカード名から書き始める）/);
  assert.match(prompt, /合計60枚/);
  assert.match(prompt, /メガサメハダーex ×3/);
  assert.match(prompt, /ワザ「ハングリージョー」/);
  assert.match(prompt, /特性「しはいのくさり」/);
  // 今の見どころ・ほかの記事の情報は渡さない
  const column = columns.find((c) => c.slug === SLUG);
  assert.ok(!prompt.includes(column.highlight.slice(0, 20)));
  assert.ok(!prompt.includes(column.title));
});

test('点検: カードテキストにある名前・数字だけで、主役から書き始めた文は通る', () => {
  assert.deepEqual(reviewAiHighlight(GOOD, input()), []);
});

test('点検: データにない数字（足し算した打点）・名前、誇張、主役以外からの書き出し、決まった文、長さを見つける', () => {
  const data = input();
  const has = (text, re) => assert.ok(reviewAiHighlight(text, data).some((p) => re.test(p)), `${text}\n→ ${reviewAiHighlight(text, data).join(' / ')}`);
  has(GOOD.replace('150ダメージを上乗せ', '120＋150の270ダメージに'), /数字「270」/);
  has(GOOD.replace('「しはいのくさり」', '「ダークパワー」'), /「ダークパワー」は渡したカードテキストにない/);
  has(`${GOOD.slice(0, 60)}最強のアタッカー。`, /誇張/);
  has(`モモワロウexと${GOOD}`, /主役のカード「メガサメハダーex」の名前から書き始めて/);
  has(`メガサメハダーex・モモワロウexを採用した悪デッキ。${GOOD.slice(20)}`, /決まり文句/);
  has('メガサメハダーexで殴る', /短すぎます/);
  has(`${GOOD}。${GOOD}`, /長すぎます/);
  has(`見どころ：${GOOD}`, /前置き/);
});

test('点検: 公式テキストの長い文をそのまま貼った文は言い換えさせる', () => {
  const data = input();
  const sentence = [...data.profiles.values()].flatMap((p) => p.effects.flatMap((e) => e.text.split('。'))).find((s) => s.length >= 30);
  const problems = reviewAiHighlight(`メガサメハダーexのデッキ。${sentence}。`.padEnd(100, '。'), data);
  assert.ok(problems.some((p) => /そのまま使っています/.test(p)), problems.join(' / '));
});

test('点検: 同じ日の記事と書き出しの骨組みがそっくりなら書き直させる', () => {
  const others = [{ slug: 'other-deck', highlight: 'ドラパルトexの特性「テスト」は、相手のベンチにダメカンをのせる', names: ['ドラパルトex'] }];
  const text = 'メガサメハダーexの特性「バッドアッパー」は、' + GOOD.slice(30);
  const problems = reviewAiHighlight(text, input(SLUG, others));
  assert.ok(problems.some((p) => /other-deck/.test(p)), problems.join(' / '));
});

test('1回目で点検を通れば、その文を使う（API は1回だけ・設定のモデルで呼ぶ）', async () => {
  const client = fakeClient([{ text: GOOD }]);
  const ai = createAiHighlighter({ client });
  const r = await ai.write(input());
  assert.equal(r.text, GOOD);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].model, AI_HIGHLIGHT_CONFIG.model);
  assert.equal(AI_HIGHLIGHT_CONFIG.model, 'claude-sonnet-5-5');
  assert.deepEqual(ai.stats, { ...ai.stats, calls: 1, inputTokens: 1000, outputTokens: 500 });
});

test('点検に引っかかったら理由を伝えて1回だけ書き直させる', async () => {
  const client = fakeClient([{ text: `最強の${GOOD}` }, { text: GOOD }]);
  const r = await createAiHighlighter({ client }).write(input());
  assert.equal(r.text, GOOD);
  assert.equal(r.attempts, 2);
  const second = client.calls[1].messages;
  assert.equal(second.length, 3);
  assert.equal(second[1].role, 'assistant');
  assert.match(second[2].content, /主役のカード「メガサメハダーex」の名前から書き始めて/);
});

test('書き直しても通らなければ null を返し（3回目は呼ばない）、従来の方法に任せる', async () => {
  const client = fakeClient([{ text: '短い' }, { text: '短い' }, { text: GOOD }]);
  const r = await createAiHighlighter({ client }).write(input());
  assert.equal(r.text, null);
  assert.match(r.reason, /書き直しても点検を通らなかった/);
  assert.equal(client.calls.length, 2);
});

test('キーがない・API のエラー・応答を断った・長さの上限で切れたときは例外を投げず null を返す', async () => {
  const none = createAiHighlighter({ apiKey: '' });
  assert.deepEqual(await none.write(input()), { text: null, reason: 'ANTHROPIC_API_KEY が設定されていない', attempts: 0 });
  assert.equal(none.stats.enabled, false);
  assert.match(usageLines(none.stats).join('\n'), /Claude API は使っていません/);

  const broken = createAiHighlighter({ client: fakeClient([new Error('network down')]) });
  const r1 = await broken.write(input());
  assert.equal(r1.text, null);
  assert.match(r1.reason, /Claude API のエラー/);
  assert.equal(broken.stats.errors, 1);

  const refused = await createAiHighlighter({ client: fakeClient([{ stop_reason: 'refusal' }]) }).write(input());
  assert.match(refused.reason, /refusal/);
  const cut = await createAiHighlighter({ client: fakeClient([{ stop_reason: 'max_tokens', text: 'メガサメ' }]) }).write(input());
  assert.match(cut.reason, /max_tokens/);
});

test('1回の実行で API を呼ぶ回数には上限がある', async () => {
  const client = fakeClient(Array.from({ length: 20 }, () => ({ text: '短い' })));
  const ai = createAiHighlighter({ client, config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: 3 } });
  await ai.write(input()); // 2回
  const r = await ai.write(input()); // 1回呼んだあと上限
  assert.match(r.reason, /上限（3回）/);
  const r2 = await ai.write(input());
  assert.match(r2.reason, /上限（3回）/);
  assert.equal(client.calls.length, 3);
});

test('料金の目安はモデルの料金表から計算し、表にないモデルは不明とする', () => {
  assert.equal(estimateCost('claude-sonnet-5-5', 1_000_000, 100_000), 3);
  assert.equal(estimateCost('unknown-model', 1000, 1000), null);
  const lines = usageLines({ enabled: true, model: 'claude-sonnet-5-5', calls: 2, maxCalls: 10, inputTokens: 3000, outputTokens: 1000, errors: 0 }).join('\n');
  assert.match(lines, /API を呼んだ回数: 2回（上限 10回。うちチェック役 0回）/);
  assert.match(lines, /\$0\.0160/);
});

// ---- チェック役（review） ----

const reviewCases = JSON.parse(read('scripts/test/fixtures/ai-highlight-review-cases.json'));
/** 「誤り」の根拠として引用する公式テキスト（メガサメハダーex のワザの名前。チェック役に渡す公式テキストにある） */
const QUOTE = 'ハングリージョー';
/** PR・ログに出る「誤り」の理由（引用つき） */
const quoted = (reason, quote = QUOTE) => `${reason}（公式テキスト「${quote}」）`;

/** チェック役の答え（JSON の文）。要確認なら reasons を「誤り」の点（quote を引用）として、問題なしなら「問題なし」の点を1つだけ返す */
const verdict = (v, reasons = [], notes = [], quote = QUOTE) => ({
  text: JSON.stringify({
    checks:
      v === '要確認'
        ? reasons.map((r) => ({ point: '', judgment: '誤り', reason: r, quote }))
        : [{ point: '気になった点', judgment: '問題なし', reason: '公式テキストと合っている', quote: '' }],
    notes,
  }),
});
function reviewInput(slug, text) {
  const data = input(slug);
  return { text: text ?? columns.find((c) => c.slug === slug).highlight, main: data.main, recipe: data.recipe, profiles: data.profiles };
}

test('見どころを書かせる指示: 主役のカードと、それを支えるカード1枚まで', async () => {
  const client = fakeClient([{ text: GOOD }]);
  await createAiHighlighter({ client }).write(input());
  assert.match(client.calls[0].system, /主役のカードと、それを支えるカード1枚まで。それ以外のカードは書かない/);
});

test('チェック役に渡すのは、見どころと、そこに出てくるカードの公式テキストだけ', () => {
  const k = reviewCases.cases.find((c) => c.slug === 'n-zoroark-ex-deck');
  const data = reviewInput(k.slug, k.highlight);
  const prompt = buildReviewPrompt(data);
  assert.ok(prompt.startsWith(`## 見どころ\n${k.highlight}\n`));
  assert.match(prompt, /### Nのゾロアークex/);
  assert.match(prompt, /### Nのゼクロム/);
  assert.match(prompt, /ワザ「ナイトジョーカー」/);
  // 見どころに出てこない主力カード（くさりもち）のテキストは渡さない
  assert.ok(data.profiles.has('くさりもち'));
  assert.ok(!prompt.includes('### くさりもち'));
  assert.deepEqual(mentionedCards('どのカード名も出てこない文', input().profiles, 'メガサメハダーex'), ['メガサメハダーex']);
});

test('チェック役: 「要確認」と理由・「問題なし」を JSON で受け取り、上限の回数に数える', async () => {
  const client = fakeClient([verdict('要確認', ['「Nのポイントアップ」でつける先は Nのゾロアークex'], [], 'ナイトジョーカー'), verdict('問題なし')]);
  const ai = createAiHighlighter({ client });
  const warn = await ai.review(reviewInput('n-zoroark-ex-deck'));
  assert.deepEqual(warn, { status: 'warn', reasons: [quoted('「Nのポイントアップ」でつける先は Nのゾロアークex', 'ナイトジョーカー')] });
  assert.deepEqual(await ai.review(reviewInput(SLUG)), { status: 'ok', reasons: [] });
  // 答えの形（structured outputs）と、見どころを書くのとは別の指示
  assert.equal(client.calls[0].output_config.format.type, 'json_schema');
  assert.deepEqual(client.calls[0].output_config.format.schema.properties.checks.items.properties.judgment.enum, ['誤り', '問題なし']);
  assert.equal(client.calls[0].output_config.effort, AI_HIGHLIGHT_CONFIG.effort);
  assert.match(client.calls[0].system, /対象を限定する条件/);
  assert.equal(client.calls[0].model, AI_HIGHLIGHT_CONFIG.model);
  assert.equal(ai.stats.calls, 2);
  assert.equal(ai.stats.reviewCalls, 2);
  assert.equal(reviewLabel(warn), '⚠ 要確認：「Nのポイントアップ」でつける先は Nのゾロアークex（公式テキスト「ナイトジョーカー」）');
  assert.equal(reviewLabel({ status: 'ok', reasons: [] }), '✅ チェック済み');
});

test('チェック役: 答えを読めない・API のエラー・上限・キーなしは「チェックできず」（例外は投げない）', async () => {
  const bad = await createAiHighlighter({ client: fakeClient([{ text: 'たぶん大丈夫です' }]) }).review(reviewInput(SLUG));
  assert.equal(bad.status, 'error');
  assert.match(reviewLabel(bad), /^⚠ チェックできず/);
  const err = await createAiHighlighter({ client: fakeClient([new Error('boom')]) }).review(reviewInput(SLUG));
  assert.equal(err.status, 'error');
  const noKey = await createAiHighlighter({ apiKey: '' }).review(reviewInput(SLUG));
  assert.equal(noKey.status, 'error');
  // 見どころを書いた分とチェック役の分を合わせて上限を数える
  const client = fakeClient([{ text: GOOD }, verdict('問題なし')]);
  const ai = createAiHighlighter({ client, config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: 1 } });
  assert.equal((await ai.write(input())).text, GOOD);
  const limited = await ai.review(reviewInput(SLUG, GOOD));
  assert.equal(limited.status, 'error');
  assert.equal(limited.limit, true);
  assert.equal(client.calls.length, 1);
});

test('チェック役の指示: 書いていないことではなく、書いてあることの誤りだけを要確認にする', async () => {
  const client = fakeClient([verdict('問題なし')]);
  await createAiHighlighter({ client }).review(reviewInput(SLUG));
  const { system } = client.calls[0];
  for (const re of [/書いてあることが間違っていないか/, /山札にもどす.*回収する/, /ルールを持たないポケモンなら/, /ふしぎなアメ/, /回数の制限を書いていない/, /デメリットや代償/, /最初の番は使えない/, /おたがいに/, /6個のっていれば/, /確認できず/]) {
    assert.match(system, re);
  }
  assert.deepEqual(client.calls[0].output_config.format.schema.required, ['checks', 'notes']);
});

test('チェック役に渡す文: 公式テキストが渡されていない「」の名前は「確認できず」として並べる', () => {
  const k = reviewCases.cases.find((c) => c.slug === 'mabusoruex-deck-0928');
  const prompt = buildReviewPrompt(reviewInput(k.slug, k.highlight));
  assert.match(prompt, /## 公式テキストが渡されていない名前（確認できず/);
  assert.match(prompt, /- アドレナブレイン\n- バッドアッパー/);
  // 公式テキストにある名前（ワザ「デスピリオド」）は並べない
  assert.ok(!/- デスピリオド/.test(prompt));
  assert.deepEqual(unverifiableNames('「ひらめきチャレンジ」と「ないもの」', '- ワザ「ひらめきチャレンジ」'), ['ないもの']);
  // すべて確かめられるときは、その見出しを出さない
  const y = reviewCases.cases.find((c) => c.slug === 'slowking-deck');
  assert.ok(!buildReviewPrompt(reviewInput(y.slug, y.highlight)).includes('公式テキストが渡されていない'));
});

test('チェック役: notes（確認できず）は参考として出すだけで、「問題なし」のまま', async () => {
  const ai = createAiHighlighter({ client: fakeClient([verdict('問題なし', [], ['バッドアッパーは公式テキストがなく確認できず'])]) });
  const ok = await ai.review(reviewInput(SLUG));
  assert.deepEqual(ok, { status: 'ok', reasons: [], notes: ['バッドアッパーは公式テキストがなく確認できず'] });
  assert.equal(reviewLabel(ok), '✅ チェック済み（参考・確認できず：バッドアッパーは公式テキストがなく確認できず）');
});

test('チェック役: 答えの JSON の読み方（判定は「誤り」が1つでもあるかでプログラムが決める）', () => {
  const answer = (checks, notes = []) => JSON.stringify({ checks, notes });
  const wrong = (point, reason, quote = '220ダメージ') => ({ point, judgment: '誤り', reason, quote });
  const fine = (point, reason) => ({ point, judgment: '問題なし', reason, quote: '' });
  assert.deepEqual(parseReview(answer([wrong(' 「250ダメージ」 ', ' 公式テキストでは 220 ')])), { ok: false, reasons: ['「250ダメージ」：公式テキストでは 220（公式テキスト「220ダメージ」）'] });
  assert.deepEqual(parseReview('```json\n{"checks":[],"notes":[]}\n```'), { ok: true, reasons: [] });
  assert.deepEqual(parseReview(answer([wrong('', '')])), { ok: false, reasons: ['理由の記載なし（公式テキスト「220ダメージ」）'] });
  // 「理由には問題なしと書いてあるのに要確認」は起きない: 「問題なし」の点しかなければ問題なし
  assert.deepEqual(parseReview(answer([fine('「選んだワザのエネルギーは要らない」', 'ルールのとおりで正しい'), fine('「とりひき」', '回数の制限の省略')])), { ok: true, reasons: [] });
  // PR・ログに出す理由は「誤り」の点だけ
  assert.deepEqual(parseReview(answer([fine('A', '合っている'), wrong('B', '対象が違う'), fine('C', '省略')])), { ok: false, reasons: ['B：対象が違う（公式テキスト「220ダメージ」）'] });
  assert.throws(() => parseReview(answer([{ point: 'x', judgment: 'たぶん', reason: '', quote: '' }])));
  // 前の形（verdict / reasons）は受け付けない
  assert.throws(() => parseReview('{"verdict":"要確認","reasons":["x"]}'));
  assert.deepEqual(parseReview(answer([], [' 確認できず ', ''])), { ok: true, reasons: [], notes: ['確認できず'] });
});

test('チェック役: 引用がない・引用が公式テキストにない・理由が「誤りではない」の「誤り」は、誤りとして数えない', () => {
  const answer = (...checks) => JSON.stringify({ checks, notes: [] });
  const wrong = (point, reason, quote) => ({ point, judgment: '誤り', reason, quote });
  const cardText = '### Nのゾロアークex（ポケモン・たね・HP280）\n- ワザ「ナイトジョーカー」［無無］：自分のベンチの「Nのポケモン」が持つワザを1つ選び、このワザとして使う。';
  const noQuote = parseReview(answer(wrong('A', '対象が違う', '')), { cardText });
  assert.deepEqual(noQuote.reasons, []);
  assert.equal(noQuote.ok, true);
  assert.deepEqual(noQuote.ignored, ['A：対象が違う（根拠の公式テキストの引用がない）']);
  const notFound = parseReview(answer(wrong('B', 'エネルギーが要る', '借りたワザのエネルギーも必要とする')), { cardText });
  assert.equal(notFound.ok, true);
  assert.match(notFound.ignored[0], /引用「借りたワザのエネルギーも必要とする」が公式テキストに見つからない/);
  const notWrong = parseReview(answer(wrong('C', 'ルールのとおりなので誤りではない', 'このワザとして使う')), { cardText });
  assert.equal(notWrong.ok, true);
  assert.match(notWrong.ignored[0], /理由に「誤りではない」「問題なし」と書いてある/);
  assert.equal(parseReview(answer(wrong('C', '結果は問題なし', 'このワザとして使う')), { cardText }).ok, true);
  // 引用が公式テキストにあれば誤り（全角半角・空白・かぎかっこ・句読点の違い・「…」の省略は見ない）
  const found = parseReview(answer(wrong('D', 'ベンチではなくバトル場と書いている', '自分のベンチの「Nのポケモン」が持つワザを1つ選び…このワザとして使う。')), { cardText });
  assert.equal(found.ok, false);
  assert.deepEqual(found.reasons, ['D：ベンチではなくバトル場と書いている（公式テキスト「自分のベンチの「Nのポケモン」が持つワザを1つ選び…このワザとして使う。」）']);
  assert.equal(found.ignored, undefined);
  // 数えなかった「誤り」と数えた「誤り」がまじっても、数えた分だけで決める
  const mixed = parseReview(answer(wrong('E', '違う', ''), wrong('F', '数字が違う', 'ナイトジョーカー')), { cardText });
  assert.deepEqual(mixed.reasons, ['F：数字が違う（公式テキスト「ナイトジョーカー」）']);
  assert.equal(mixed.ignored.length, 1);
  // 短すぎる引用（語だけ）は根拠にしない
  assert.equal(quoteFound('ワザ', cardText), false);
  assert.equal(quoteFound('ベンチの Ｎのポケモン が持つワザ', cardText), true);
});

test('チェック役: 引用が渡した公式テキストにない「誤り」は要確認にしない（ログにだけ出す）', async () => {
  const logs = [];
  const client = fakeClient([verdict('要確認', ['借りたワザのエネルギーが要る'], [], '借りたワザのエネルギーも必要')]);
  const r = await createAiHighlighter({ client, log: (m) => logs.push(m) }).review(reviewInput(SLUG, GOOD));
  assert.deepEqual(r, { status: 'ok', reasons: [] });
  assert.ok(logs.some((m) => /誤りとして数えなかった点: .*公式テキストに見つからない/.test(m)));
  // 答えの形: 「誤り」の根拠の引用（quote）を必ず答えさせる
  assert.deepEqual(client.calls[0].output_config.format.schema.properties.checks.items.required, ['point', 'judgment', 'reason', 'quote']);
  assert.match(client.calls[0].system, /一字一句そのまま引用/);
});

// ---- ポケカの基本ルールのメモ（scripts/lib/game-rules.md） ----

test('ルールのメモ: 「## ルール」の下の「- 」の行だけを読み、書く役とチェック役の両方に渡す', async () => {
  assert.ok(GAME_RULES.length >= 1);
  assert.match(GAME_RULES[0], /このワザ自体のエネルギーだけで使える。借りたワザのエネルギーは要らない/);
  // 説明の行は渡さない
  assert.ok(!GAME_RULES.some((r) => r.includes('足し方')));
  assert.deepEqual(parseGameRules('# 見出し\n- 説明の行\n\n## ルール\n\n- ルール1\n  - ルール2 \n説明\n## 次の見出し\n- 入らない'), ['ルール1', 'ルール2']);
  assert.deepEqual(parseGameRules('- 見出しがない'), []);
  const client = fakeClient([{ text: GOOD }, verdict('問題なし')]);
  const ai = createAiHighlighter({ client });
  await ai.write(input());
  await ai.review(reviewInput(SLUG, GOOD));
  for (const call of client.calls) {
    assert.match(call.system, /ポケカの基本ルール/);
    assert.ok(call.system.includes(GAME_RULES[0]));
  }
});

// ---- 要確認なら、AI に自分で直させる（checkAndFix） ----

const FIXED = GOOD.replace('150ダメージを上乗せできる', '150ダメージを追加できる');

test('要確認なら「誤り」の理由を渡して直させ、もう一度チェックする。問題なしになれば「自分で直せた」', async () => {
  const client = fakeClient([verdict('要確認', ['「ハングリージョー」の条件が違う']), { text: FIXED }, verdict('問題なし')]);
  const ai = createAiHighlighter({ client });
  const r = await ai.checkAndFix(input(), GOOD);
  assert.equal(r.text, FIXED);
  assert.equal(r.review.status, 'ok');
  assert.equal(r.fix.outcome, 'fixed');
  assert.equal(r.fix.before, GOOD);
  assert.deepEqual(r.fix.firstReview.reasons, [quoted('「ハングリージョー」の条件が違う')]);
  // 直す呼び出し: 書く役の指示・元のデータ・前の文・「誤り」の理由を渡す
  const fixCall = client.calls[1];
  assert.equal(fixCall.output_config.format, undefined);
  assert.match(fixCall.system, /主役のカードと、それを支えるカード1枚まで/);
  assert.equal(fixCall.messages[0].content, buildPrompt(input()));
  assert.equal(fixCall.messages[1].content, GOOD);
  assert.match(fixCall.messages[2].content, /「誤り」と指摘しました[\s\S]*- 「ハングリージョー」の条件が違う（公式テキスト「ハングリージョー」）/);
  // 2回目のチェックは直した文
  assert.ok(client.calls[2].messages[0].content.startsWith(`## 見どころ\n${FIXED}`));
  assert.equal(ai.stats.calls, 3);
  assert.equal(ai.stats.reviewCalls, 2);
  assert.equal(ai.stats.fixCalls, 1);
  assert.equal(fixLabel(r.fix), '🔧 自分で直せた（最初の指摘：「ハングリージョー」の条件が違う（公式テキスト「ハングリージョー」））');
  assert.match(usageLines(ai.stats).join('\n'), /うちチェック役 2回・直し 1回/);
});

test('直してもまだ要確認なら「直せずに人に知らせた」（直すのは1回まで）', async () => {
  const client = fakeClient([verdict('要確認', ['誤り1']), { text: FIXED }, verdict('要確認', ['誤り2'])]);
  const ai = createAiHighlighter({ client });
  const r = await ai.checkAndFix(input(), GOOD);
  assert.equal(client.calls.length, 3);
  assert.equal(r.text, FIXED);
  assert.deepEqual(r.review, { status: 'warn', reasons: [quoted('誤り2')] });
  assert.equal(r.fix.outcome, 'unfixed');
  assert.equal(r.fix.after, FIXED);
  assert.equal(fixLabel(r.fix), '🙋 直せずに人に知らせた');
  assert.equal(reviewLabel(r.review), `⚠ 要確認：${quoted('誤り2')}`);
});

test('直した文が点検に通らない・直す呼び出しが上限のときは、元の文のまま「直せずに人に知らせた」', async () => {
  const bad = await createAiHighlighter({ client: fakeClient([verdict('要確認', ['誤り1']), { text: '短い' }]) }).checkAndFix(input(), GOOD);
  assert.equal(bad.text, GOOD);
  assert.equal(bad.review.status, 'warn');
  assert.equal(bad.fix.outcome, 'unfixed');
  assert.match(bad.fix.reason, /直した文が点検を通らなかった/);
  assert.match(fixLabel(bad.fix), /^🙋 直せずに人に知らせた（直した文が点検を通らなかった/);
  const client = fakeClient([verdict('要確認', ['誤り1'])]);
  const limited = await createAiHighlighter({ client, config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: 1 } }).checkAndFix(input(), GOOD);
  assert.equal(limited.text, GOOD);
  assert.equal(limited.fix.outcome, 'unfixed');
  assert.equal(limited.limit, true);
  assert.equal(client.calls.length, 1);
});

test('問題なし・チェックできずなら直さない', async () => {
  const client = fakeClient([verdict('問題なし'), { text: 'たぶん大丈夫です' }]);
  const ai = createAiHighlighter({ client });
  const ok = await ai.checkAndFix(input(), GOOD);
  assert.deepEqual(ok, { text: GOOD, review: { status: 'ok', reasons: [] }, fix: null });
  const error = await ai.checkAndFix(input(), GOOD);
  assert.equal(error.review.status, 'error');
  assert.equal(error.fix, null);
  assert.equal(client.calls.length, 2);
  assert.equal(fixLabel(null), '');
});

test('テスト用の9本: 手で直す前の文（mustFlag）と、今サイトに出ている文（mustNotFlag）', () => {
  assert.equal(reviewCases.cases.length, 9);
  for (const k of reviewCases.cases) {
    const column = columns.find((c) => c.slug === k.slug);
    assert.ok(column, k.slug);
    if (k.mustNotFlag) {
      // 要確認にしてはいけない文は、今サイトに出ている見どころ
      assert.equal(k.highlight, column.highlight, k.slug);
      assert.ok(!k.mustFlag);
      continue;
    }
    // 今の記事は手で直した文（manual）で、テスト用は直す前の文
    assert.equal(column.highlight, k.fixed);
    assert.equal(column.highlightBy, 'manual');
    assert.notEqual(k.highlight, k.fixed);
    assert.ok(k.problem);
  }
  // 合格の基準: 手で直す前の文が間違っていた2本を「要確認」に、今サイトに出ている3本を「問題なし」にすべきとする
  assert.deepEqual(
    reviewCases.cases.filter((k) => k.mustFlag).map((k) => k.slug).sort(),
    ['dipplin-festival-lead-deck-0927', 'seek-inspiration-deck-0929'],
  );
  assert.deepEqual(
    reviewCases.cases.filter((k) => k.mustNotFlag).map((k) => k.slug).sort(),
    ['mabusoruex-deck-0928', 'mega-lopunny-ex-deck-0927', 'n-zoroark-ex-deck', 'n-zoroark-ex-deck-0927', 'slowking-deck'],
  );
  // n-zoroark-ex-deck-0927: 「選んだワザのエネルギーは要らない」はルールのとおりで正しい（scripts/lib/game-rules.md）
  const zoroark = reviewCases.cases.find((k) => k.slug === 'n-zoroark-ex-deck-0927').highlight;
  assert.match(zoroark, /選んだワザのエネルギーは要らない/);
  assert.match(zoroark, /エネルギーが足りなければ、NのポイントアップでトラッシュからベンチのNのゾロアークexに補う/);
  // mega-lopunny-ex-deck-0927: 「はしゃぐ」でミミロルがベンチと入れ替わり、ベンチのメガミミロップexが前に出るので正しい
  assert.match(reviewCases.cases.find((k) => k.slug === 'mega-lopunny-ex-deck-0927').highlight, /ミミロルの「はしゃぐ」やポケモンいれかえで前に出て攻める/);
});

test('テスト用の9本の合否: mustFlag の2本を「要確認」に、mustNotFlag の5本を「問題なし」にできれば合格（mustFlag: false は数えない）', () => {
  const must = { mustFlag: true };
  const free = { mustFlag: false };
  const clean = { mustNotFlag: true };
  const ok = { status: 'ok', reasons: [] };
  const warn = { status: 'warn', reasons: ['x'] };
  const error = { status: 'error', reasons: ['x'] };
  assert.deepEqual(testCaseResult([{ testCase: must, review: warn }, { testCase: must, review: warn }, { testCase: free, review: ok }, { testCase: free, review: ok }]), { pass: true, flagged: 2, required: 2, passed: 0, clean: 0 });
  assert.equal(testCaseResult([{ testCase: must, review: warn }, { testCase: must, review: ok }, { testCase: free, review: warn }]).pass, false);
  assert.equal(testCaseResult([{ testCase: must, review: warn }, { testCase: must, review: error }]).pass, false);
  assert.deepEqual(
    testCaseResult([{ testCase: must, review: warn }, { testCase: must, review: warn }, { testCase: clean, review: ok }, { testCase: clean, review: ok }, { testCase: free, review: warn }]),
    { pass: true, flagged: 2, required: 2, passed: 2, clean: 2 },
  );
  // 要確認にしてはいけない文を要確認にした・チェックできなかったときは不合格
  assert.equal(testCaseResult([{ testCase: must, review: warn }, { testCase: must, review: warn }, { testCase: clean, review: warn }]).pass, false);
  assert.equal(testCaseResult([{ testCase: must, review: warn }, { testCase: must, review: warn }, { testCase: clean, review: error }]).pass, false);
  assert.equal(testCaseMark(clean, ok), '◯ 問題なしにできた');
  assert.equal(testCaseMark(clean, warn), '✕ 厳しすぎ（要確認）');
  assert.equal(testCaseMark(free, ok), '・ 問題なし（直す前の文も間違いではない）');
  assert.equal(testCaseMark(must, ok), '✕ 見逃した（問題なし）');
  assert.equal(testCaseMark(must, warn), '◯ 要確認にできた');
});

// ── ひとこと（一覧のカードに出す 30〜40字。deck-columns.json の tagline） ──

/** 点検を通るひとこと（38字。カードテキストにある名前だけ） */
const TAGLINE = 'メガサメハダーexは「ハングリージョー」でダメカンがのるほど大きく攻められる';
const taglineInput = (others = []) => ({ ...input(SLUG, others), highlight: GOOD });
const reviewJson = (checks = []) => JSON.stringify({ checks, notes: [] });

test('ひとこと: 長さは30〜40字', () => {
  assert.equal(TAGLINE_MIN, 30);
  assert.equal(TAGLINE_MAX, 40);
  assert.equal(taglineLength(TAGLINE), 38);
});

test('ひとことを書く役に渡すのは、見どころと同じデータと、その記事の見どころ（参考）だけ', () => {
  const prompt = buildTaglinePrompt(taglineInput());
  assert.match(prompt, /^デッキ名: メガサメハダーex/);
  assert.match(prompt, /主役のカード: メガサメハダーex（ひとことに必ず名前を入れる）/);
  assert.match(prompt, /ワザ「ハングリージョー」/);
  assert.ok(prompt.includes(`## この記事の見どころ（参考）\n${GOOD}`));
  assert.match(prompt, /30字以上・40字以内（40字を超えると使えません/);
  assert.match(prompt, /tagline には完成したひとこと1本だけ/);
  const column = columns.find((c) => c.slug === SLUG);
  assert.ok(!prompt.includes(column.title));
});

test('ひとことの点検: 30〜40字・主役の名前・データにない数字や名前・誇張・決まった文・同じ日の記事と同じ文', () => {
  const data = taglineInput();
  assert.deepEqual(reviewTagline(TAGLINE, data), []);
  const has = (text, re, d = data) => assert.ok(reviewTagline(text, d).some((p) => re.test(p)), `${text}\n→ ${reviewTagline(text, d).join(' / ')}`);
  // 長さをはみ出したら「今○字なので、あと○字」と具体的な数を伝える
  assert.deepEqual(reviewTagline(`${TAGLINE}、モモワロウexと組む`, data), ['長すぎます（今49字）。あと9字以上削って、40字以内（35字くらい）にしてください']);
  assert.deepEqual(reviewTagline('メガサメハダーexで攻める', data), ['短すぎます（今13字）。あと17字以上足して、30字以上にしてください']);
  has('モモワロウexの「しはいのくさり」で相手をどくにしながらベンチと入れ替えて戦う', /主役のカード「メガサメハダーex」の名前を入れて/);
  has(TAGLINE.replace('大きく', '270も'), /数字「270」/);
  has(TAGLINE.replace('「ハングリージョー」', '「ダークパワー」'), /「ダークパワー」は渡したカードテキストにない/);
  has(TAGLINE.replace('大きく', '最強の打点で'), /誇張/);
  has(TAGLINE, /同じ日の記事（other-deck）とひとことが同じ/, taglineInput([{ slug: 'other-deck', tagline: TAGLINE, names: [] }]));
});

test('ひとことの整え方: 文末の「。」と、全体を囲むかぎかっこを外す', () => {
  assert.equal(cleanTagline(`  ${TAGLINE}。\n`), TAGLINE);
  assert.equal(cleanTagline(`「${TAGLINE.replace(/「|」/g, '')}」`), TAGLINE.replace(/「|」/g, ''));
  // 中にかぎかっこがあるときは外さない
  assert.equal(cleanTagline(TAGLINE), TAGLINE);
});

test('ひとこと: 30〜40字をはみ出したら「今○字なので、あと○字削って」と伝えて書き直させる（書き直しは2回まで）', async () => {
  const long = `${TAGLINE}デッキで、モモワロウexと組んで戦う`;
  const longer = `${TAGLINE}、モモワロウexと組む`;
  const client = fakeClient([{ text: JSON.stringify({ tagline: long }) }, { text: JSON.stringify({ tagline: longer }) }, { text: JSON.stringify({ tagline: `${TAGLINE}。` }) }]);
  const ai = createAiHighlighter({ client });
  const r = await ai.writeTagline(taglineInput());
  assert.equal(r.text, TAGLINE);
  assert.equal(r.attempts, 3);
  assert.equal(client.calls.length, 3);
  // ひとことの指示で呼ぶ（見どころの指示ではない）。40字以内を強く伝え、答えは JSON の tagline（完成したひとこと1本だけ）
  assert.match(client.calls[0].system, /ひとこと/);
  assert.match(client.calls[0].system, /40字を1字でも超えると使えない/);
  assert.match(client.calls[0].system, /字数は考えるときに数えて確かめ、答えには書かない/);
  assert.deepEqual(client.calls[0].output_config.format.schema.required, ['tagline']);
  // 書き直しは毎回1通のメッセージ（考えごとの混ざった前の応答を会話に戻さない）。前の答えと、何字削るかを渡す
  for (const [i, prev] of [[1, long], [2, longer]]) {
    assert.equal(client.calls[i].messages.length, 1);
    const content = client.calls[i].messages[0].content;
    assert.ok(content.startsWith(client.calls[0].messages[0].content));
    assert.ok(content.includes(`## 前に書いたひとこと\n${prev}\n`));
    assert.match(content, /次の点を直して、ひとことをもう一度書いてください/);
    assert.match(content, new RegExp(`長すぎます（今${taglineLength(prev)}字）。あと${taglineLength(prev) - 40}字以上削って`));
  }

  // 2回書き直してもはみ出したら null（4回目は呼ばない。一覧は見どころを出す）
  const client2 = fakeClient([{ text: long }, { text: long }, { text: long }, { text: TAGLINE }]);
  const r2 = await createAiHighlighter({ client: client2 }).writeTagline(taglineInput());
  assert.equal(r2.text, null);
  assert.match(r2.reason, /2回書き直しても点検を通らなかった（長すぎます/);
  assert.equal(client2.calls.length, 3);
});

test('ひとこと: 答えは JSON の tagline だけを使う。本文に字数の数え方などが混ざった答え・断られた答え・空の答えは書き直させる', async () => {
  assert.equal(taglineOf(JSON.stringify({ tagline: TAGLINE })), TAGLINE);
  assert.equal(taglineOf('```json\n{"tagline": "a"}\n```'), 'a');
  // JSON でなければ答えのまま（点検で改行・長さに引っかかる）
  const thinking = `${TAGLINE}\n\n字数確認：「ハングリージョー」(10)…42。長いので調整します。\n\n**${TAGLINE}**`;
  assert.equal(taglineOf(thinking), thinking);
  assert.ok(reviewTagline(cleanTagline(taglineOf(thinking)), taglineInput()).some((p) => /改行/.test(p)));

  // 1回目: 考えごとが混ざった → 2回目: 断られた → 3回目: 書けた
  const client = fakeClient([{ text: thinking }, { stop_reason: 'refusal', text: '' }, { text: JSON.stringify({ tagline: TAGLINE }) }]);
  const r = await createAiHighlighter({ client }).writeTagline(taglineInput());
  assert.equal(r.text, TAGLINE);
  assert.equal(r.attempts, 3);
  // 断られたあとは、前の答えを渡さずに書き直させる
  assert.equal(client.calls[2].messages[0].content, client.calls[0].messages[0].content);

  // 空の答えも書き直させる（3回とも空なら null）
  const client2 = fakeClient([{ text: '' }, { text: JSON.stringify({ tagline: '' }) }, { stop_reason: 'refusal' }]);
  const r2 = await createAiHighlighter({ client: client2 }).writeTagline(taglineInput());
  assert.equal(r2.text, null);
  assert.match(r2.reason, /2回書き直しても点検を通らなかった（AI が応答を断った（refusal））/);
  assert.ok(client2.calls[1].messages[0].content.includes('## 前に書いたひとこと\n（空でした）\n'));
  assert.match(client2.calls[1].messages[0].content, /- 文が空でした/);

  // 見どころは今までどおり（断られたら書き直さない）
  const client3 = fakeClient([{ stop_reason: 'refusal' }]);
  const r3 = await createAiHighlighter({ client: client3 }).write(input());
  assert.equal(r3.text, null);
  assert.match(r3.reason, /AI が応答を断った/);
  assert.equal(client3.calls.length, 1);
});

test('ひとこと: チェック役は見どころと同じ基準。誤りなら1回だけ直させ、それでもだめなら「直せずに人に知らせた」', async () => {
  const data = taglineInput();
  const quote = [...data.profiles.get('メガサメハダーex').effects].find((e) => e.name === 'ハングリージョー').text.split('。')[0];
  const wrong = { point: 'ハングリージョー', judgment: '誤り', reason: '条件が違う', quote };
  const FIXED = 'メガサメハダーexは自分にダメカンがあれば「ハングリージョー」で攻め込める';
  assert.deepEqual(reviewTagline(FIXED, data), []);

  // 誤り → 直す → 問題なし
  const client = fakeClient([{ text: reviewJson([wrong]) }, { text: FIXED }, { text: reviewJson() }]);
  const ai = createAiHighlighter({ client });
  const checked = await ai.checkAndFix(data, TAGLINE, { kind: 'tagline' });
  assert.equal(checked.text, FIXED);
  assert.equal(checked.fix.outcome, 'fixed');
  assert.equal(checked.review.status, 'ok');
  // チェック役には「ひとこと」として渡す（指示は見どころと同じチェック役のもの）
  assert.match(client.calls[0].messages[0].content, /^## ひとこと\n/);
  assert.match(client.calls[0].messages[0].content, /## ひとことに出てくるカードの公式テキスト/);
  assert.match(client.calls[0].system, /校閲者/);
  assert.match(client.calls[0].system, /「ひとこと」/);
  // 直すときはひとことの指示で、直す前の文と「誤り」の理由を1通のメッセージで渡す
  assert.match(client.calls[1].system, /ひとこと/);
  assert.equal(client.calls[1].messages.length, 1);
  assert.ok(client.calls[1].messages[0].content.includes(`## 直す前のひとこと
${TAGLINE}
`));
  assert.match(client.calls[1].messages[0].content, /このひとことを公式テキストと見比べたチェック役/);
  assert.match(client.calls[1].messages[0].content, /条件が違う/);
  assert.equal(ai.stats.reviewCalls, 2);
  assert.equal(ai.stats.fixCalls, 1);

  // 直してもまだ誤り → 直した文を使い、人に知らせる（直すのは1回まで）
  const client2 = fakeClient([{ text: reviewJson([wrong]) }, { text: FIXED }, { text: reviewJson([wrong]) }]);
  const again = await createAiHighlighter({ client: client2 }).checkAndFix(data, TAGLINE, { kind: 'tagline' });
  assert.equal(again.fix.outcome, 'unfixed');
  assert.equal(again.review.status, 'warn');
  assert.equal(client2.calls.length, 3);
  assert.match(fixLabel(again.fix), /🙋 直せずに人に知らせた/);

  // 直した文が40字をはみ出したら、あと何字削るかを伝えてもう1回だけ書き直させる
  const tooLong = `${FIXED}、モモワロウexと組んで戦う`;
  const client4 = fakeClient([{ text: reviewJson([wrong]) }, { text: tooLong }, { text: FIXED }, { text: reviewJson() }]);
  const ai4 = createAiHighlighter({ client: client4 });
  const shortened = await ai4.checkAndFix(data, TAGLINE, { kind: 'tagline' });
  assert.equal(shortened.text, FIXED);
  assert.equal(shortened.fix.outcome, 'fixed');
  assert.ok(client4.calls[2].messages[0].content.includes(`## 前に書いたひとこと\n${tooLong}\n`));
  assert.ok(client4.calls[2].messages[0].content.includes(`長すぎます（今${taglineLength(tooLong)}字）。あと${taglineLength(tooLong) - 40}字以上削って`));
  assert.equal(ai4.stats.fixCalls, 2);

  // それでもはみ出したら使わない（元の文のまま人に知らせる）
  const client3 = fakeClient([{ text: reviewJson([wrong]) }, { text: tooLong }, { text: tooLong }]);
  const long = await createAiHighlighter({ client: client3 }).checkAndFix(data, TAGLINE, { kind: 'tagline' });
  assert.equal(long.text, TAGLINE);
  assert.equal(long.fix.outcome, 'unfixed');
  assert.match(long.fix.reason, /^直した文が点検を通らなかった（長すぎます/);
  assert.equal(client3.calls.length, 3);
});
