// src/utils/shareText.ts（X 告知用の投稿文）のテスト（npm test）
// 公開済みのすべてのデッキ記事（src/data/deck-columns.json）で、投稿文が X の上限に収まり、途中で「…」で切れないことを確かめる

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TAGLINE_MAX } from '../lib/ai-highlight.js';
import { BLURB_MAX, PARENT_POST_LIMIT, X_POST_LIMIT, X_URL_LENGTH, buildXPosts, xWeightedLength } from '../../src/utils/shareText.ts';

const columns = JSON.parse(readFileSync(new URL('../../src/data/deck-columns.json', import.meta.url), 'utf8'));
const SITE = 'https://www.pokeca-factory.com/';
// 価格の行がいちばん長くなる場合でも収まるか見るため、大きめの金額にする
const ESTIMATE = 1234567;
const posts = (c, extra = {}) =>
  buildXPosts({ deckName: c.deckName, result: c.result, highlight: c.highlight, tagline: c.tagline, estimate: ESTIMATE, url: `${SITE}columns/${c.slug}/`, ...extra });
/** 「・」の行（価格の行ではないほう）の中身 */
const blurbLine = (parent) => parent.split('\n').find((l) => l.startsWith('・') && !l.startsWith('・60枚の最安パーツ概算')).slice(1);

test('X の重み付き文字数: 日本語は1字を2、半角は1、URL は長さによらず23', () => {
  assert.equal(xWeightedLength('ポケカ'), 6);
  assert.equal(xWeightedLength('ex 123'), 6);
  assert.equal(xWeightedLength(`${SITE}columns/very-long-slug-deck-0929/`), X_URL_LENGTH);
});

test('「・」の行を縮める長さは、ひとことの上限と同じ', () => {
  assert.equal(BLURB_MAX, TAGLINE_MAX);
});

test('ひとことがある記事は、「・」の行にひとことをそのまま使う', () => {
  const c = { deckName: 'テスト', result: '9/29 シティリーグ優勝', highlight: '見どころの1文目。見どころの2文目。', tagline: 'ひとことの文' };
  assert.equal(blurbLine(posts(c).parent), 'ひとことの文');
});

test('ひとことがない記事は、見どころを「。」の文の切れ目で止める', () => {
  const c = { deckName: 'テスト', result: '9/29 シティリーグ優勝', highlight: `${'あ'.repeat(25)}。${'い'.repeat(25)}。${'う'.repeat(25)}。` };
  // 2文目まで入り、3文目は入らない
  assert.equal(blurbLine(posts(c).parent), `${'あ'.repeat(25)}。${'い'.repeat(25)}。`);
});

test('ひとことがなく1文目も入りきらないときだけ、ひとことと同じ長さ以内の文の切れ目で止め、「…」は付けない', () => {
  const highlight = `メガテストexの「テストワザ」は、相手のバトルポケモンに${'ダメージ'.repeat(10)}を与え、さらに${'ベンチ'.repeat(20)}にも当てる。2文目。`;
  const line = blurbLine(posts({ deckName: 'テスト', result: '9/29 シティリーグ優勝', highlight }).parent);
  assert.ok([...line].length <= BLURB_MAX, line);
  assert.ok(highlight.startsWith(line));
  assert.doesNotMatch(line, /…|、$|は$/);
  assert.equal(line, 'メガテストexの「テストワザ」');
  // 「」」がなければ「、」の手前で止め、文末の「は」を外す
  const noQuote = blurbLine(posts({ deckName: 'テスト', result: '9/29 シティリーグ優勝', highlight: `メガテストexは、${'ダメージ'.repeat(40)}。` }).parent);
  assert.equal(noQuote, 'メガテストex');
});

test('すべての記事で、投稿文が X の上限に収まり、途中で「…」で切れない（ひとことあり）', () => {
  assert.ok(columns.length > 0);
  for (const c of columns) {
    const { parent, reply } = posts(c);
    assert.ok(xWeightedLength(parent) <= PARENT_POST_LIMIT, `${c.slug}: 1ポスト目が ${xWeightedLength(parent)}`);
    assert.ok(xWeightedLength(parent) <= X_POST_LIMIT);
    assert.ok(xWeightedLength(reply) <= X_POST_LIMIT, `${c.slug}: 2ポスト目が ${xWeightedLength(reply)}`);
    assert.doesNotMatch(parent, /…/, c.slug);
    if (c.tagline) assert.equal(blurbLine(parent), c.tagline.trim(), c.slug);
  }
});

test('すべての記事で、ひとことがなくても X の上限に収まり、見どころを途中で「…」で切らない', () => {
  for (const c of columns) {
    const { parent } = posts(c, { tagline: undefined });
    assert.ok(xWeightedLength(parent) <= PARENT_POST_LIMIT, `${c.slug}: 1ポスト目が ${xWeightedLength(parent)}`);
    assert.doesNotMatch(parent, /…/, c.slug);
    const line = blurbLine(parent);
    // 見どころの書き出しのまま（途中を抜いたり言葉を足したりしない）で、「。」で終わるか、ひとことと同じ長さ以内に縮めたもの
    assert.ok(c.highlight.startsWith(line), `${c.slug}: ${line}`);
    assert.doesNotMatch(line, /、$|は$/, c.slug);
    assert.ok(line.endsWith('。') || [...line].length <= BLURB_MAX, `${c.slug}: ${line}`);
  }
});

test('ハッシュタグ・価格の行・リンクは今のまま', () => {
  const gym = buildXPosts({ deckName: 'テスト', result: '9/28 ジムバトル優勝', highlight: 'あ。', tagline: 'ひとこと', estimate: 12345, url: `${SITE}columns/x/` });
  assert.equal(gym.parent, '🏆【テスト】がジムバトル優勝！（9/28）\n・ひとこと\n・60枚の最安パーツ概算 約12,345円\n#ポケカ #ジムバトル優勝 #ポケトリー');
  assert.equal(gym.reply, `確定レシピ・最安パーツ内訳・回し方は「ポケカファクトリー（ポケトリー）」でチェック👇\n${SITE}columns/x/`);
  const city = buildXPosts({ deckName: 'テスト', result: '9/29 シティリーグ優勝', highlight: 'あ。', estimate: 0, url: '' });
  assert.equal(city.parent, '🏆【テスト】9/29 シティリーグ優勝のレシピを解説！\n・あ。\n#ポケカ #ポケカ環境 #ポケトリー');
});
