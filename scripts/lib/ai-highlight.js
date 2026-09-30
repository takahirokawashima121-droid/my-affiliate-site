// デッキ記事の見どころ（deck-columns.json の highlight）を Claude API で書く。
// scripts/auto-deck-updater.js（新しい記事）・scripts/ai-highlight-test.js（手動の試し書き。ファイルは変えない）・
// scripts/ai-highlight-rewrite.js（公開済みの記事のまとめ書き直し）から使う
//
// 方針（CLAUDE.md「6. 記事・紹介文の品質基準」）:
// - AI に渡すのは、デッキ名・60枚のレシピ・採用カードの公式テキスト（scripts/lib/game-plan.js の recipeProfiles の内容）だけ
// - 書いた文は reviewAiHighlight で点検する（scripts/lib/highlight.js の決まった文・同じ日の記事の書き出しに加え、
//   主役のカードからの書き出し・長さ・誇張・データにない「」の名前や数字）。引っかかったら理由を伝えて1回だけ書き直させる
// - それでも通らないとき・API のエラー・キーがないとき・呼び出し回数の上限に達したときは null を返し、
//   呼び出し側は従来の方法（scripts/lib/highlight.js）の見どころを使う。ここで例外を投げて記事の自動生成を止めることはしない

import Anthropic from '@anthropic-ai/sdk';
import { HIGHLIGHT_MAX, bannedPhrases, opening } from './highlight.js';

/**
 * AI の見どころの設定。**モデルを変えるときは model だけを書き換える**（料金の目安は下の PRICES に載っているモデルだけ出る）。
 * - effort: 考える深さ（low / medium / high）。effort に対応していないモデル（claude-haiku-4-5 など）にするときは null にする
 * - maxCallsPerRun: 1回の実行（npm run auto-decks / auto-city それぞれ）で API を呼ぶ回数の上限。不具合で何度も呼ばないための歯止め
 * - maxTokens: 1回の応答の上限（考える分を含む）
 */
export const AI_HIGHLIGHT_CONFIG = {
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  maxCallsPerRun: 10,
  maxTokens: 8000,
  timeoutMs: 120_000,
};

/** まとめ書き直し（scripts/ai-highlight-rewrite.js）だけの、1回の実行で API を呼ぶ回数の上限（通常の自動生成は maxCallsPerRun のまま） */
export const REWRITE_MAX_CALLS = 120;

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

/** この長さ（全角）以上の公式テキストの1文がそのまま入っていたら、説明文の貼り付けとみなす */
const PASTE_LENGTH = 25;

/** 誇張（使わせない言い方） */
const EXAGGERATION = /最強|必勝|絶対|無敵|圧倒的|最高|完璧|確実に勝/;

const nfkc = (s) => (s ?? '').normalize('NFKC');

const SYSTEM = `あなたはポケモンカードの大会入賞デッキを紹介するサイトの編集者です。デッキ記事の「見どころ」を1段落で書きます。
使ってよい情報は、ユーザーが渡す「デッキ名」「60枚のレシピ」「採用カードの公式テキスト」だけです。

守ること:
- 書き出しは、指定された主役のカードの名前から始める
- 渡した情報に書かれていないこと（カードの効果・HP・ダメージ・枚数・ほかのデッキとの相性・環境や大会での評判など）は書かない。知っている知識で補わない
- 数字（ダメージ・ダメカンの数・枚数など）は、公式テキストかレシピに書いてある数字だけを使う。足し算などで新しい数字を作らない
- ワザ・特性の名前は「」で囲み、公式テキストの表記のまま書く
- 公式テキストの文をそのまま貼り付けない。主役のカードが何をするのか、どのカードとどう組み合わせて戦うのかが伝わる、自然な日本語の文に言い換える
- 長さは全角で${AI_HIGHLIGHT_MIN + 20}〜${HIGHLIGHT_MAX - 10}字くらい（${HIGHLIGHT_MAX}字を超えない）。改行しない。文末は「〜する」「〜できる」の形にする
- 「最強」「必勝」「絶対」「無敵」のような誇張はしない
- 「〇〇を採用した〇〇デッキ」「〜をまとめて確認」のような、名前を入れ替えるだけでどのデッキにも使える決まり文句は使わない
- 前置き・見出し・箇条書き・説明は付けず、見どころの文だけを出力する`;

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
  const stats = { model: config.model, enabled: Boolean(api), calls: 0, maxCalls: config.maxCallsPerRun, inputTokens: 0, outputTokens: 0, errors: 0 };

  async function call(messages) {
    if (stats.calls >= config.maxCallsPerRun) throw new LimitError(`1回の実行で API を呼べる上限（${config.maxCallsPerRun}回）に達した`);
    stats.calls++;
    const response = await api.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      ...(config.effort ? { output_config: { effort: config.effort } } : {}),
      system: SYSTEM,
      messages,
    });
    stats.inputTokens += response.usage?.input_tokens ?? 0;
    stats.outputTokens += response.usage?.output_tokens ?? 0;
    return response;
  }

  /**
   * 1記事分の見どころを書く（点検に引っかかったら1回だけ書き直させる）
   * @returns {Promise<{ text: string, attempts: number } | { text: null, reason: string, attempts: number }>}
   */
  async function write(input) {
    if (!api) return { text: null, reason: 'ANTHROPIC_API_KEY が設定されていない', attempts: 0 };
    const messages = [{ role: 'user', content: buildPrompt(input) }];
    let problems = [];
    let attempts = 0;
    try {
      for (attempts = 1; attempts <= 2; attempts++) {
        const response = await call(messages);
        if (response.stop_reason === 'refusal') return { text: null, reason: 'AI が応答を断った（refusal）', attempts };
        if (response.stop_reason === 'max_tokens') return { text: null, reason: `応答が長さの上限（max_tokens ${config.maxTokens}）で切れた`, attempts };
        const text = textOf(response);
        problems = reviewAiHighlight(text, input);
        log(`  AI ${attempts}回目: ${text}${problems.length ? `\n    ⚠ ${problems.join(' / ')}` : '\n    ✓ 点検を通過'}`);
        if (problems.length === 0) return { text, attempts };
        if (attempts === 2) break;
        // 書き直し: 前の応答（考えた内容を含む）をそのまま返し、直す点を伝える
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: `次の点を直して、見どころの文だけをもう一度書いてください。\n${problems.map((p) => `- ${p}`).join('\n')}` });
      }
      return { text: null, reason: `書き直しても点検を通らなかった（${problems.join(' / ')}）`, attempts: 2 };
    } catch (error) {
      if (error instanceof LimitError) return { text: null, reason: error.message, attempts: attempts - 1, limit: true };
      stats.errors++;
      const detail = apiErrorDetail(error, [apiKey]);
      log(`  ⚠ Claude API のエラー: ${detail}`);
      return { text: null, reason: `Claude API のエラー（${detail}）`, attempts, apiError: true, fatal: isFatalApiError(error) };
    }
  }

  return { write, stats };
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
    `- API を呼んだ回数: ${stats.calls}回（上限 ${stats.maxCalls}回）${stats.errors ? `・うちエラー ${stats.errors}回` : ''}`,
    `- 使った量: 入力 ${stats.inputTokens.toLocaleString('en-US')} トークン・出力 ${stats.outputTokens.toLocaleString('en-US')} トークン（出力には AI が考えた分を含む）`,
    `- おおよその料金: ${cost === null ? '不明（料金表 PRICES にないモデル）' : `$${cost.toFixed(4)}`}`,
  ];
}
