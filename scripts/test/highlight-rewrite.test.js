// 見どころのまとめ書き直し（scripts/lib/highlight-rewrite.js・scripts/ai-highlight-rewrite.js）と、
// API のエラーの理由の出し方（scripts/lib/ai-highlight.js の apiErrorDetail）のテスト（npm test）。API は呼ばない

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { AI_HIGHLIGHT_CONFIG, REWRITE_MAX_CALLS, apiErrorDetail, createAiHighlighter, isFatalApiError } from '../lib/ai-highlight.js';
import { applyRewrites, rewriteHighlights, rewritePrBody, rewriteTargets } from '../lib/highlight-rewrite.js';
import { parseLimit } from '../ai-highlight-rewrite.js';
import { effectsFromPage } from '../rewrite-highlights.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const recipes = JSON.parse(read('src/data/official-decks.json'));
const columns = JSON.parse(read('src/data/deck-columns.json'));
const nameOfId = new Map(JSON.parse(read('src/data/cards.json')).map((c) => [c.id, c.name]));
const namesOf = (c) => [...(recipes[c.deckKey]?.cards ?? []).map((e) => e.name), ...(c.keyCards ?? [])];
const materialsOf = async (c) => ({ recipe: recipes[c.deckKey]?.cards ?? [], profiles: effectsFromPage(read(`src/pages/columns/${c.slug}.astro`), nameOfId) });

const MANUAL = ['dragapult-ex-deck-0927', 'mega-kangaskhan-ex-deck-0927', 'n-zoroark-ex-deck-0927', 'mega-sharpedo-ex-deck-0927'];

/** 決まった応答を順に返す偽のクライアント */
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        const r = typeof replies === 'function' ? replies(params, calls.length) : replies[calls.length - 1];
        if (r instanceof Error) throw r;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: r }], usage: { input_tokens: 1000, output_tokens: 500 } };
      },
    },
  };
}

/** 主役のカード名から書き始め、データにある数字・名前だけを使う文（主役ごとに書き出しの骨組みを変えられる） */
const goodFor = (c, lead = 'は') =>
  `${c.keyCards[0]}${lead}山札やトラッシュのカードを組み合わせて相手のポケモンを追い詰めていくデッキの中心で、ベンチに控えるポケモンとも連携しながら長く戦える。相手の動きに合わせて攻め方を変えられる`;

const creditError = () =>
  Anthropic.APIError.generate(
    400,
    { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } },
    undefined,
    new Headers(),
  );

test('9/27 シティリーグの4本は手で直した印（highlightBy: "manual"）が付いている', () => {
  for (const slug of MANUAL) assert.equal(columns.find((c) => c.slug === slug).highlightBy, 'manual', slug);
  for (const c of columns) assert.ok([undefined, 'ai', 'manual'].includes(c.highlightBy), `${c.slug}: ${c.highlightBy}`);
});

test('対象: manual 以外の公開済みの記事を、公開日が新しい順に選ぶ。「試しに何本だけ」も選べる', () => {
  const today = '2026-09-30';
  const { targets, manual, all } = rewriteTargets(columns, { today });
  // 手で直した印の記事はすべて対象外（9/27 シティリーグの4本を含む。あとで手で直した記事が増えてもよい）
  assert.deepEqual(manual.map((c) => c.slug).sort(), columns.filter((c) => c.pubDate <= today && c.highlightBy === 'manual').map((c) => c.slug).sort());
  for (const slug of MANUAL) assert.ok(manual.some((c) => c.slug === slug), slug);
  assert.ok(targets.every((c) => c.highlightBy !== 'manual'));
  assert.equal(all, targets.length);
  assert.equal(targets.length, columns.filter((c) => c.pubDate <= today).length - manual.length);
  for (let i = 1; i < targets.length; i++) assert.ok(targets[i - 1].pubDate >= targets[i].pubDate);
  const five = rewriteTargets(columns, { today, limit: 5 });
  assert.equal(five.targets.length, 5);
  assert.deepEqual(five.targets, targets.slice(0, 5));
  assert.equal(five.all, all);
  // まだ公開していない日付の記事は選ばない
  assert.equal(rewriteTargets([{ slug: 'x', pubDate: '2026-10-01' }], { today }).targets.length, 0);
});

test('--limit: 空欄・0・all はすべて、数字はその本数。数字でなければエラー', () => {
  assert.equal(parseLimit([]), null);
  assert.equal(parseLimit(['--limit=']), null);
  assert.equal(parseLimit(['--limit=0']), null);
  assert.equal(parseLimit(['--limit=all']), null);
  assert.equal(parseLimit(['--limit=5']), 5);
  assert.equal(parseLimit(['--limit=５']), 5);
  assert.throws(() => parseLimit(['--limit=abc']), /本数/);
});

test('API を呼ぶ回数の上限は、まとめ書き直しだけ250回（チェック役の分を含む。通常の自動生成は20回）', () => {
  assert.equal(REWRITE_MAX_CALLS, 250);
  assert.equal(AI_HIGHLIGHT_CONFIG.maxCallsPerRun, 20);
});

test('書き直し: 点検に通れば新しい文、通らなければ今の見どころのまま。書き直した文どうしでも書き出しを比べる', async () => {
  const day = columns.filter((c) => c.pubDate === '2026-09-29');
  const [a, b, c] = day;
  // a・b は同じ骨組みの書き出しで返す。b は a の新しい文と似ているので書き直しを求められ、2回目は違う書き出しにする。c はずっと短い
  const client = fakeClient((params, n) => {
    const prompt = params.messages[0].content;
    if (prompt.includes(`主役のカード: ${a.keyCards[0]}`)) return goodFor(a);
    if (prompt.includes(`主役のカード: ${b.keyCards[0]}`)) return params.messages.length === 1 ? goodFor(b) : goodFor(b, 'を軸にして');
    return '短い';
  });
  const ai = createAiHighlighter({ client });
  const results = await rewriteHighlights({ columns, targets: [a, b, c], namesOf, materialsOf, ai });
  assert.equal(results[0].after, goodFor(a));
  // b の1回目は、a の「新しい文」と書き出しがそっくりなので書き直しを求められた
  const bCalls = client.calls.filter((p) => p.messages[0].content.includes(`主役のカード: ${b.keyCards[0]}`));
  assert.equal(bCalls.length, 2);
  assert.match(bCalls[1].messages[2].content, new RegExp(`同じ日の記事（${a.slug}）と書き出しの形がそっくり`));
  assert.equal(results[1].after, goodFor(b, 'を軸にして'));
  assert.equal(results[1].attempts, 2);
  assert.equal(results[2].after, null);
  assert.match(results[2].reason, /書き直しても点検を通らなかった/);

  // 反映: 書き直した記事だけ highlight を変え、highlightBy: 'ai' を highlight のすぐ後ろに付ける。点検に通らなかった記事は今のまま
  const copy = structuredClone(columns);
  assert.equal(applyRewrites(copy, results), 2);
  const after = (slug) => copy.find((x) => x.slug === slug);
  assert.equal(after(a.slug).highlight, goodFor(a));
  assert.equal(after(a.slug).highlightBy, 'ai');
  const keys = Object.keys(after(a.slug));
  assert.equal(keys[keys.indexOf('highlight') + 1], 'highlightBy');
  assert.equal(after(c.slug).highlight, c.highlight);
  assert.equal(after(c.slug).highlightBy, c.highlightBy);
});

test('manual の記事は、結果があっても上書きしない', () => {
  const copy = structuredClone(columns);
  const slug = MANUAL[0];
  const before = copy.find((c) => c.slug === slug).highlight;
  assert.equal(applyRewrites(copy, [{ slug, before, after: 'AI の文' }]), 1);
  assert.equal(copy.find((c) => c.slug === slug).highlight, before);
  assert.equal(copy.find((c) => c.slug === slug).highlightBy, 'manual');
});

test('残高不足などのエラーでは、API が返した理由を出し、残りの記事は呼ばずにやめる（キーの文字は出さない）', async () => {
  const key = 'sk-ant-api03-SECRETSECRETSECRET';
  const client = fakeClient(() => creditError());
  const ai = createAiHighlighter({ client, apiKey: key });
  const targets = columns.filter((c) => c.pubDate === '2026-09-29').slice(0, 3);
  const results = await rewriteHighlights({ columns, targets, namesOf, materialsOf, ai });
  assert.equal(client.calls.length, 1);
  assert.match(results[0].reason, /Your credit balance is too low/);
  assert.match(results[0].reason, /400 BadRequestError invalid_request_error/);
  assert.match(results[1].reason, /キー・権限・残高の問題.*呼ばなかった/);
  const body = rewritePrBody({ results, manual: [], stats: ai.stats, audit: { banned: [], similar: [] }, limit: null, all: 3 });
  assert.match(body, /Your credit balance is too low/);
  assert.ok(!body.includes('SECRET'));
});

test('ふつうのエラーは3回続いたらやめる', async () => {
  const client = fakeClient(() => Anthropic.APIError.generate(500, { type: 'error', error: { type: 'api_error', message: 'Internal server error' } }, undefined, new Headers()));
  const ai = createAiHighlighter({ client });
  const targets = columns.filter((c) => c.pubDate === '2026-09-27').slice(0, 5);
  const results = await rewriteHighlights({ columns, targets, namesOf, materialsOf, ai });
  assert.equal(client.calls.length, 3);
  assert.match(results[3].reason, /API のエラーが3回続いた/);
});

test('API のエラーの説明: 理由の文を出し、キーの文字は伏せる', () => {
  const key = 'sk-ant-api03-abcdefghijklmnop';
  const err = Anthropic.APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${key}` } }, undefined, new Headers());
  const detail = apiErrorDetail(err, [key]);
  assert.match(detail, /^401 AuthenticationError authentication_error: invalid x-api-key/);
  assert.ok(!detail.includes('abcdefghijklmnop'));
  assert.equal(isFatalApiError(err), true);
  assert.equal(isFatalApiError(creditError()), true);
  assert.equal(isFatalApiError(new Error('network down')), false);
  assert.equal(apiErrorDetail(new Error('network down')), 'Error: network down');
});

test('PR の本文: 変更前・変更後の表、書き直せなかった記事と理由、使った量と料金', () => {
  const results = [
    { slug: 'a-deck', deckName: 'Aデッキ', pubDate: '2026-09-29', before: '前の|文', after: '新しい文', attempts: 1 },
    { slug: 'b-deck', deckName: 'Bデッキ', pubDate: '2026-09-29', before: '前', after: null, reason: '書き直しても点検を通らなかった（短すぎます）', attempts: 2 },
  ];
  const stats = { enabled: true, model: 'claude-sonnet-5-5', calls: 3, maxCalls: 120, inputTokens: 3000, outputTokens: 1500, errors: 0 };
  const body = rewritePrBody({ results, manual: [{ slug: 'm-deck' }], stats, audit: { banned: [], similar: [] }, limit: 2, all: 40 });
  assert.match(body, /\| 記事 \| 変更前 \| 変更後 \| チェック \|/);
  assert.match(body, /\| `\/columns\/a-deck\/`<br>Aデッキ（2026-09-29） \| 前の\\\|文 \| 新しい文 \| — \|/);
  assert.match(body, /- `\/columns\/b-deck\/`（Bデッキ）: 書き直しても点検を通らなかった（短すぎます）/);
  assert.match(body, /試しに2本だけ/);
  assert.match(body, /API を呼んだ回数: 3回（上限 120回。うちチェック役 0回）/);
  assert.match(body, /おおよその料金: \$0\.0210/);
  assert.match(body, /対象外: 1本（`m-deck`）/);
});

test('チェック役: 書き直せた文だけをチェックし、⚠ の記事は PR の本文のいちばん上にまとめる', async () => {
  const [a, b, c] = columns.filter((x) => x.pubDate === '2026-09-29');
  const verdictFor = { [a.keyCards[0]]: { verdict: '問題なし', reasons: [] }, [b.keyCards[0]]: { verdict: '要確認', reasons: ['条件が抜けている'] } };
  const client = fakeClient((params) => {
    const prompt = params.messages[0].content;
    if (params.output_config?.format) {
      // チェック役: a は問題なし・b は要確認・c のチェックは壊れた答え
      const hit = Object.entries(verdictFor).find(([main]) => prompt.startsWith(`## 見どころ\n${main}`));
      return hit ? JSON.stringify(hit[1]) : 'よくわかりません';
    }
    if (prompt.includes(`主役のカード: ${a.keyCards[0]}`)) return goodFor(a);
    if (prompt.includes(`主役のカード: ${b.keyCards[0]}`)) return goodFor(b, 'を軸にして');
    return goodFor(c, 'が主役で');
  });
  const ai = createAiHighlighter({ client });
  const results = await rewriteHighlights({ columns, targets: [a, b, c], namesOf, materialsOf, ai });
  assert.deepEqual(results.map((r) => r.review?.status), ['ok', 'warn', 'error']);
  // ⚠ でも文は使う
  assert.equal(results[1].after, goodFor(b, 'を軸にして'));
  assert.equal(ai.stats.reviewCalls, 3);

  const body = rewritePrBody({ results, manual: [], stats: ai.stats, audit: { banned: [], similar: [] }, limit: null, all: 3 });
  const lines = body.split('\n');
  assert.equal(lines[0], '> [!WARNING]');
  const top = body.slice(0, body.indexOf('## 🤖'));
  assert.match(top, new RegExp(`${b.slug}.*⚠ 要確認：条件が抜けている`));
  assert.match(top, new RegExp(`${c.slug}.*⚠ チェックできず`));
  assert.ok(!top.includes(a.slug));
  assert.match(body, /チェック役: ✅ 1本・⚠ 2本/);
  assert.match(body, new RegExp(`${a.slug}.*\| ✅ チェック済み \|`));
  assert.match(body, /うちチェック役 3回/);
});

test('チェック役: 上限に達したら「チェックできず」とし、残りの記事は呼ばない', async () => {
  const [a, b] = columns.filter((x) => x.pubDate === '2026-09-29');
  const client = fakeClient((params) => (params.output_config?.format ? JSON.stringify({ verdict: '問題なし', reasons: [] }) : goodFor(a)));
  const ai = createAiHighlighter({ client, config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: 1 } });
  const results = await rewriteHighlights({ columns, targets: [a, b], namesOf, materialsOf, ai });
  assert.equal(results[0].after, goodFor(a));
  assert.equal(results[0].review.status, 'error');
  assert.match(results[1].reason, /上限に達した.*呼ばなかった/);
  assert.equal(client.calls.length, 1);
});
