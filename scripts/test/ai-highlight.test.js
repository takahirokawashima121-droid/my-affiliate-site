// scripts/lib/ai-highlight.js（見どころを Claude API で書く・点検・書き直し・従来の方法への切り替え）のテスト（npm test）
// API は呼ばない（messages.create を持つ偽のクライアントで応答を決める）。カードテキストは実際の記事ページから読む

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AI_HIGHLIGHT_CONFIG, buildPrompt, createAiHighlighter, estimateCost, reviewAiHighlight, usageLines } from '../lib/ai-highlight.js';
import { effectsFromPage } from '../rewrite-highlights.js';

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
        return { stop_reason: r.stop_reason ?? 'end_turn', content: [{ type: 'text', text: r.text ?? '' }], usage: { input_tokens: 1000, output_tokens: 500 } };
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
  assert.match(lines, /API を呼んだ回数: 2回（上限 10回）/);
  assert.match(lines, /\$0\.0160/);
});
