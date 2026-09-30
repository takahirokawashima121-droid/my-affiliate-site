// 見どころのまとめ書き直し（scripts/lib/highlight-rewrite.js・scripts/ai-highlight-rewrite.js）と、
// API のエラーの理由の出し方（scripts/lib/ai-highlight.js の apiErrorDetail）のテスト（npm test）。API は呼ばない

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { AI_HIGHLIGHT_CONFIG, REWRITE_MAX_CALLS, apiErrorDetail, createAiHighlighter, isFatalApiError } from '../lib/ai-highlight.js';
import {
  applyRewrites,
  applyTaglines,
  fixFlaggedHighlights,
  fixFlaggedPrBody,
  rewriteHighlights,
  rewritePrBody,
  rewriteTargets,
  taglinePrBody,
  taglineTargets,
  withTagline,
  writeTaglines,
} from '../lib/highlight-rewrite.js';
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

test('API を呼ぶ回数の上限は、まとめ書き直しだけ250回（チェック役・直しの分を含む。通常の自動生成は80回。見どころ＋ひとことで1本あたり最大10回）', () => {
  assert.equal(REWRITE_MAX_CALLS, 250);
  assert.equal(AI_HIGHLIGHT_CONFIG.maxCallsPerRun, 80);
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

/** チェック役に渡した文（prompt）の公式テキストから、「誤り」の根拠として引用する一文（最初の効果の文。なければカード名） */
function quoteFrom(prompt) {
  const cards = prompt.slice(prompt.indexOf('## 見どころに出てくるカードの公式テキスト'));
  return cards.match(/^- .*?：([^。\n]+)/m)?.[1] ?? cards.match(/^### (\S+?)(?:（|$)/m)[1];
}
/** 「誤り」の理由（PR・ログに出る形。引用つき） */
const quotedFor = (reason, prompt) => `${reason}（公式テキスト「${quoteFrom(prompt)}」）`;

/** チェック役の答え（JSON の文）。reasons があれば「誤り」の点（prompt の公式テキストから引用）、なければ「問題なし」の点だけ */
const answer = (reasons = [], prompt = '') =>
  JSON.stringify({
    checks: reasons.length
      ? reasons.map((r) => ({ point: '', judgment: '誤り', reason: r, quote: quoteFrom(prompt) }))
      : [{ point: '気になった点', judgment: '問題なし', reason: '合っている', quote: '' }],
    notes: [],
  });

test('チェック役: 書き直せた文だけをチェックし、要確認なら1回だけ直させる。直せなかった記事は PR の本文のいちばん上にまとめる', async () => {
  const [a, b, c] = columns.filter((x) => x.pubDate === '2026-09-29');
  const client = fakeClient((params) => {
    const prompt = params.messages[0].content;
    if (params.output_config?.format) {
      // チェック役: a は問題なし・b はずっと要確認（直しても）・c のチェックは壊れた答え
      if (prompt.startsWith(`## 見どころ\n${a.keyCards[0]}`)) return answer();
      if (prompt.startsWith(`## 見どころ\n${b.keyCards[0]}`)) return answer(['条件が抜けている'], prompt);
      return 'よくわかりません';
    }
    if (prompt.includes(`主役のカード: ${a.keyCards[0]}`)) return goodFor(a);
    if (prompt.includes(`主役のカード: ${b.keyCards[0]}`)) return params.messages.length === 3 ? goodFor(b, 'を中心に') : goodFor(b, 'を軸にして');
    return goodFor(c, 'が主役で');
  });
  const ai = createAiHighlighter({ client });
  const results = await rewriteHighlights({ columns, targets: [a, b, c], namesOf, materialsOf, ai });
  assert.deepEqual(results.map((r) => r.review?.status), ['ok', 'warn', 'error']);
  // b は直させたが、直した文もまた要確認 → 直した文を使い、人に知らせる
  assert.equal(results[1].fix.outcome, 'unfixed');
  assert.equal(results[1].after, goodFor(b, 'を中心に'));
  assert.equal(results[0].fix, undefined);
  assert.equal(ai.stats.reviewCalls, 4);
  assert.equal(ai.stats.fixCalls, 1);

  const body = rewritePrBody({ results, manual: [], stats: ai.stats, audit: { banned: [], similar: [] }, limit: null, all: 3 });
  const lines = body.split('\n');
  assert.equal(lines[0], '> [!WARNING]');
  const top = body.slice(0, body.indexOf('## 🤖'));
  assert.match(top, new RegExp(`${b.slug}.*⚠ 要確認：条件が抜けている（公式テキスト「[^|]*」）・🙋 直せずに人に知らせた`));
  assert.match(top, new RegExp(`${c.slug}.*⚠ チェックできず`));
  assert.ok(!top.includes(a.slug));
  assert.match(body, /チェック役: ✅ 1本・⚠ 2本/);
  assert.match(body, /要確認になって AI に直させた: 🔧 自分で直せた 0本・🙋 直せずに人に知らせた 1本/);
  assert.match(body, new RegExp(`${a.slug}.*\\| ✅ チェック済み \\|`));
  assert.match(body, /うちチェック役 4回・直し 1回/);
});

test('チェック役: 要確認から自分で直せた記事は ✅ で、「自分で直せた」と最初の指摘が PR に出る', async () => {
  const [a] = columns.filter((x) => x.pubDate === '2026-09-29');
  const fixedText = goodFor(a, 'を中心に');
  const client = fakeClient((params) => {
    const prompt = params.messages[0].content;
    if (params.output_config?.format) return prompt.includes(fixedText) ? answer() : answer(['対象が違う'], prompt);
    return params.messages.length === 3 ? fixedText : goodFor(a);
  });
  const ai = createAiHighlighter({ client });
  const [r] = await rewriteHighlights({ columns, targets: [a], namesOf, materialsOf, ai });
  assert.equal(r.after, fixedText);
  assert.equal(r.review.status, 'ok');
  assert.equal(r.fix.outcome, 'fixed');
  const body = rewritePrBody({ results: [r], manual: [], stats: ai.stats, audit: { banned: [], similar: [] }, limit: null, all: 1 });
  assert.ok(!body.startsWith('> [!WARNING]'));
  assert.match(body, /✅ チェック済み<br>🔧 自分で直せた（最初の指摘：対象が違う（公式テキスト「[^|]*」））/);
});

// ---- 要確認の記事だけ直すモード ----

test('要確認の記事だけ直す: 問題なしは変えず、要確認は直して問題なしなら反映、直せなければ変えない。manual はチェックだけ', async () => {
  const today = '2026-09-30';
  const { targets, manual } = rewriteTargets(columns, { today });
  const [ok, fixable, stubborn] = targets;
  const zoroark = manual.find((c) => c.slug === 'n-zoroark-ex-deck-0927');
  const others = manual.filter((c) => c !== zoroark);
  const FIXED = goodFor(fixable, 'を中心に');
  const client = fakeClient((params) => {
    const prompt = params.messages[0].content;
    if (params.output_config?.format) {
      if (prompt.includes(FIXED)) return answer();
      if (prompt.includes(fixable.highlight)) return answer(['「」の条件が抜けている'], prompt);
      if (prompt.includes(stubborn.highlight) || prompt.includes('を軸にして')) return answer(['対象が違う'], prompt);
      if (prompt.includes(zoroark.highlight)) return answer(['借りたワザのエネルギー'], prompt);
      return answer();
    }
    // 直す呼び出し（前の文と「誤り」の理由を渡している）
    assert.equal(params.messages.length, 3);
    if (prompt.includes(`主役のカード: ${fixable.keyCards[0]}`)) return FIXED;
    return goodFor(stubborn, 'を軸にして');
  });
  const ai = createAiHighlighter({ client, config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: REWRITE_MAX_CALLS } });
  const results = await fixFlaggedHighlights({ columns, targets: [ok, fixable, stubborn], manual: [zoroark, ...others.slice(0, 1)], namesOf, materialsOf, ai });
  const by = (slug) => results.find((r) => r.slug === slug);
  assert.equal(by(ok.slug).after, null);
  assert.equal(by(ok.slug).review.status, 'ok');
  assert.equal(by(ok.slug).fix, undefined);
  assert.equal(by(fixable.slug).after, FIXED);
  assert.equal(by(fixable.slug).fix.outcome, 'fixed');
  assert.equal(by(stubborn.slug).after, null);
  assert.equal(by(stubborn.slug).fix.outcome, 'unfixed');
  assert.equal(by(stubborn.slug).fix.after, goodFor(stubborn, 'を軸にして'));
  // manual の記事は直さない（直す呼び出しをしない）
  assert.equal(by(zoroark.slug).manual, true);
  assert.equal(by(zoroark.slug).review.status, 'warn');
  assert.equal(by(zoroark.slug).after, null);
  assert.equal(ai.stats.fixCalls, 2);

  // 反映は直せた記事だけ
  const copy = structuredClone(columns);
  assert.equal(applyRewrites(copy, results), 1);
  assert.equal(copy.find((c) => c.slug === fixable.slug).highlight, FIXED);
  assert.equal(copy.find((c) => c.slug === fixable.slug).highlightBy, 'ai');
  assert.equal(copy.find((c) => c.slug === stubborn.slug).highlight, stubborn.highlight);
  assert.equal(copy.find((c) => c.slug === zoroark.slug).highlight, zoroark.highlight);

  // PR: 記事ごとに変更前・変更後・理由の表。直せなかった記事と manual の要確認はいちばん上
  const body = fixFlaggedPrBody({ results, stats: ai.stats, audit: { banned: [], similar: [] }, limit: 3, all: targets.length });
  const top = body.slice(0, body.indexOf('## 🔧'));
  assert.match(top, /^> \[!WARNING\]/);
  assert.match(top, new RegExp(`${stubborn.slug}.*🙋 直せずに人に知らせた・⚠ 要確認：対象が違う（公式テキスト「[^|]*」）`));
  assert.match(top, new RegExp(`${zoroark.slug}.*手で直した記事（直していません）・⚠ 要確認：借りたワザのエネルギー（公式テキスト「[^|]*」）`));
  assert.ok(!top.includes(fixable.slug));
  assert.ok(!top.includes(ok.slug));
  assert.match(body, /\| 記事 \| 結果 \| 変更前 \| 変更後 \| 理由（チェック役の「誤り」） \|/);
  assert.match(body, new RegExp(`${fixable.slug}.*\\| 🔧 自分で直せた \\| .* \\| ${FIXED} \\| 「」の条件が抜けている（公式テキスト「[^|]*」） \\|`));
  assert.match(body, new RegExp(`${stubborn.slug}.*\\| 🙋 直せずに人に知らせた \\| .* \\| （変えていない）<br>直した案：.*\\| 対象が違う（公式テキスト「[^|]*」）<br>直した案への指摘：対象が違う（公式テキスト「[^|]*」） \\|`));
  assert.match(body, new RegExp(`${zoroark.slug}.*\\| 🙋 手で直した記事のため直さず知らせた \\|`));
  assert.ok(!body.includes(`/columns/${ok.slug}/`));
  assert.match(body, /✅ 問題なし（変えていない）: 2本/);
  assert.match(body, /🔧 自分で直せた: \*\*1本\*\*/);
  assert.match(body, /試しに3本だけ/);
});

test('要確認の記事だけ直す: 残高不足のエラーでは、残りの記事は呼ばずにやめる', async () => {
  const targets = columns.filter((c) => c.pubDate === '2026-09-29').slice(0, 3);
  const client = fakeClient(() => creditError());
  const ai = createAiHighlighter({ client });
  const results = await fixFlaggedHighlights({ columns, targets, manual: [], namesOf, materialsOf, ai });
  assert.equal(client.calls.length, 1);
  assert.match(results[1].review.reasons[0], /キー・権限・残高の問題.*呼ばなかった/);
  const body = fixFlaggedPrBody({ results, stats: ai.stats, audit: { banned: [], similar: [] }, limit: null, all: 3 });
  assert.match(body, /チェックできなかった記事（3本/);
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

// ── 「ひとことだけ作る」モード（一覧のカードに出す tagline だけを書く。見どころは変えない） ──

/** 主役のカード名を入れた、30〜40字のひとこと（データにない数字・名前は使わない） */
const taglineFor = (c) => `${c.keyCards[0]}を軸に、ベンチと連携しながら相手のポケモンを追い詰めていく`;
const reviewOk = JSON.stringify({ checks: [], notes: [] });

test('ひとことだけ作る: 対象は公開済みの記事（見どころが manual の記事も含む）。taglineBy: "manual" の記事は対象外', () => {
  const today = '2026-09-30';
  const copy = structuredClone(columns);
  copy.find((c) => c.slug === 'tauros-deck-0928').taglineBy = 'manual';
  const { targets, manual, all } = taglineTargets(copy, { today });
  assert.ok(targets.some((c) => c.slug === 'n-zoroark-ex-deck' && c.highlightBy === 'manual'));
  assert.ok(manual.some((c) => c.slug === 'tauros-deck-0928'));
  assert.ok(manual.every((c) => c.taglineBy === 'manual'));
  assert.ok(!targets.some((c) => c.slug === 'tauros-deck-0928'));
  assert.equal(all, copy.filter((c) => c.pubDate <= today).length - manual.length);
  for (let i = 1; i < targets.length; i++) assert.ok(targets[i - 1].pubDate >= targets[i].pubDate);
  assert.equal(taglineTargets(copy, { today, limit: 2 }).targets.length, 2);
});

test('ひとことがまだない記事だけ作る: ひとこと（tagline）がある記事は対象にしない（書けたひとことは変えない）', () => {
  const today = '2026-09-30';
  const copy = structuredClone(columns);
  const has = copy.find((c) => c.pubDate <= today && c.taglineBy !== 'manual' && c.tagline);
  const none = copy.find((c) => c.pubDate <= today && c.taglineBy !== 'manual' && c !== has);
  delete none.tagline;
  delete none.taglineBy;
  const { targets, all, existing } = taglineTargets(copy, { today, missingOnly: true });
  assert.ok(targets.length > 0);
  assert.ok(targets.every((c) => !c.tagline && c.taglineBy !== 'manual'));
  assert.ok(targets.some((c) => c.slug === none.slug));
  assert.ok(!targets.some((c) => c.slug === has.slug));
  assert.equal(all + existing, taglineTargets(copy, { today }).all);
  // missingOnly なしでは、ひとことがある記事も対象（existing は 0）
  assert.ok(taglineTargets(copy, { today }).targets.some((c) => c.slug === has.slug));
  assert.equal(taglineTargets(copy, { today }).existing, 0);
  // PR: ひとことがまだない記事だけを対象にしたこと・変えなかった本数を出す
  const body = taglinePrBody({ results: [], manual: [], stats: { model: 'm', calls: 0, reviewCalls: 0, fixCalls: 0, maxCalls: 250, inputTokens: 0, outputTokens: 0 }, limit: null, all, missingOnly: true, existing });
  assert.ok(body.includes(`**ひとことがまだない記事だけ**を対象にしました（ひとことがある ${existing}本は変えていません）`));
  assert.match(body, /--tagline-only --tagline-missing/);
});

test('ひとことだけ作る: 見どころ（highlight・highlightBy）は変えず、tagline と taglineBy: "ai" だけを入れる', async () => {
  const manualHighlight = columns.find((c) => c.slug === 'tauros-deck-0928');
  const other = columns.find((c) => c.slug === 'bomb-talonflame-deck-0928');
  for (const c of [manualHighlight, other]) {
    const len = [...taglineFor(c)].length;
    assert.ok(len >= 30 && len <= 40, `${taglineFor(c)}（${len}字）`);
  }
  const long = (c) => `${taglineFor(c)}デッキで、じっくり戦っていく`;
  const client = fakeClient((params) => {
    if (/校閲者/.test(params.system)) return reviewOk;
    const prompt = params.messages[0].content;
    const target = prompt.includes(`主役のカード: ${manualHighlight.keyCards[0]}`) ? manualHighlight : other;
    // 1本目は最初にはみ出し、短く書き直させる
    if (target === manualHighlight && !prompt.includes('## 前に書いたひとこと')) return long(target);
    return taglineFor(target);
  });
  const ai = createAiHighlighter({ client, config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: REWRITE_MAX_CALLS } });
  const results = await writeTaglines({ columns, targets: [manualHighlight, other], namesOf, materialsOf, ai });
  assert.deepEqual(
    results.map((r) => [r.slug, r.after, r.attempts, r.review.status]),
    [
      [manualHighlight.slug, taglineFor(manualHighlight), 2, 'ok'],
      [other.slug, taglineFor(other), 1, 'ok'],
    ],
  );
  // 見どころは参考として渡す（手で直した見どころもそのまま）
  assert.ok(client.calls[0].messages[0].content.includes(manualHighlight.highlight));

  const copy = structuredClone(columns);
  const before = structuredClone(copy);
  assert.equal(applyTaglines(copy, results), 2);
  const t = copy.find((c) => c.slug === manualHighlight.slug);
  assert.equal(t.tagline, taglineFor(manualHighlight));
  assert.equal(t.taglineBy, 'ai');
  assert.equal(t.highlight, manualHighlight.highlight);
  assert.equal(t.highlightBy, 'manual');
  // tagline・taglineBy は highlightBy のすぐ後ろ。ほかの欄（レシピのキー・keyCards など）は変えない
  const keys = Object.keys(t);
  assert.deepEqual(keys.slice(keys.indexOf('highlight'), keys.indexOf('highlight') + 4), ['highlight', 'highlightBy', 'tagline', 'taglineBy']);
  for (const [i, c] of copy.entries()) {
    const { tagline, taglineBy, ...rest } = c;
    const { tagline: _t, taglineBy: _b, ...restBefore } = before[i];
    assert.deepEqual(rest, restBefore, c.slug);
  }

  // taglineBy: 'manual' の記事は上書きしない
  const manualTagline = structuredClone(columns);
  const m = manualTagline.find((c) => c.slug === other.slug);
  Object.assign(m, { tagline: '手で書いたひとこと', taglineBy: 'manual' });
  applyTaglines(manualTagline, results);
  assert.equal(manualTagline.find((c) => c.slug === other.slug).tagline, '手で書いたひとこと');

  // PR: 見どころは変えていないこと・字数・今の見どころ（参考）を出す
  const body = taglinePrBody({ results, manual: [], stats: ai.stats, limit: 2, all: 40 });
  assert.match(body, /## 💬 公開済みデッキ記事の一覧のカードに出す「ひとこと」を Claude API で作成/);
  assert.match(body, /\*\*見どころ（`highlight`・`highlightBy`）は変えていません\*\*/);
  assert.match(body, /\| 記事 \| ひとこと（字数） \| 今の見どころ（参考・変えていない） \| チェック \|/);
  assert.ok(body.includes(`${taglineFor(manualHighlight)}（${[...taglineFor(manualHighlight)].length}字）`));
  assert.match(body, /試しに2本だけ/);
  assert.ok(!body.includes('[!WARNING]'));
});

test('ひとことだけ作る: チェック役が要確認のまま・書けなかった記事は PR で知らせる', async () => {
  const [a, b] = columns.filter((c) => c.pubDate === '2026-09-29' && new Set(['bomb-talonflame-deck-0928', 'tauros-deck-0928']).has(c.slug));
  const quoteOf = async (c) => {
    const { profiles } = await materialsOf(c);
    return (profiles.get(c.keyCards[0])?.effects ?? []).map((e) => e.text).find((x) => x && x.length >= 10)?.split('。')[0];
  };
  const quote = await quoteOf(a);
  assert.ok(quote);
  const client = fakeClient((params) => {
    const prompt = params.messages[0].content;
    if (/校閲者/.test(params.system)) {
      return prompt.includes(a.keyCards[0]) ? JSON.stringify({ checks: [{ point: '効果', judgment: '誤り', reason: '対象が違う', quote }], notes: [] }) : reviewOk;
    }
    // b は何度書いても短すぎる
    return prompt.includes(`主役のカード: ${b.keyCards[0]}`) ? `${b.keyCards[0]}で攻める` : taglineFor(a);
  });
  const ai = createAiHighlighter({ client, config: { ...AI_HIGHLIGHT_CONFIG, maxCallsPerRun: REWRITE_MAX_CALLS } });
  const results = await writeTaglines({ columns, targets: [a, b], namesOf, materialsOf, ai });
  const ra = results.find((r) => r.slug === a.slug);
  const rb = results.find((r) => r.slug === b.slug);
  assert.equal(ra.fix.outcome, 'unfixed');
  assert.equal(ra.review.status, 'warn');
  assert.equal(rb.after, null);
  assert.match(rb.reason, /短すぎます/);
  const body = taglinePrBody({ results, manual: [], stats: ai.stats, limit: null, all: 2 });
  const top = body.slice(0, body.indexOf('## 💬'));
  assert.match(top, /^> \[!WARNING\]/);
  assert.match(top, new RegExp(`${a.slug}.*⚠ 要確認：効果：対象が違う.*🙋 直せずに人に知らせた`));
  assert.match(body, new RegExp(`### 書けなかった記事（1本）\\n- \`/columns/${b.slug}/\`.*短すぎます`));
});

test('withTagline: highlightBy がない記事は highlight のすぐ後ろに置き、ほかの欄の順番は変えない', () => {
  const c = { slug: 's', highlight: 'h', keyCards: ['x'] };
  assert.deepEqual(Object.keys(withTagline(c, 't')), ['slug', 'highlight', 'tagline', 'taglineBy', 'keyCards']);
  const again = withTagline({ ...withTagline(c, 't'), highlightBy: 'ai' }, 't2');
  assert.equal(again.tagline, 't2');
});
