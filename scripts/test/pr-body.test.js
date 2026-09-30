// scripts/lib/pr-body.js（自動生成の PR 本文の「生成した記事」）のテスト（npm test）

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedItem, highlightMethod } from '../lib/pr-body.js';

test('見どころをどちらの方法で書いたか（AIで作成・従来の方法と理由）', () => {
  assert.equal(highlightMethod({ highlightResult: { ai: true } }), 'AIで作成');
  assert.equal(highlightMethod({ highlightResult: { ai: false, reason: 'ANTHROPIC_API_KEY が設定されていない' } }), '従来の方法・ANTHROPIC_API_KEY が設定されていない');
  assert.equal(highlightMethod({}), '従来の方法');
});

const article = { articleTitle: 'シティリーグ9/27【日】ベスト16デッキまとめ', articleLink: 'https://pokecabook.com/archives/335123' };
const city = (source, extra = {}) => ({
  slug: 'dragapult-ex-deck-0927',
  deckName: 'ドラパルトex',
  inferred: true,
  renamedByRule: false,
  ...extra,
  source: { eventLabel: 'シティリーグ', date: '9/27', rank: '優勝', venue: '青馬堂矢向店（神奈川）', nameSource: null, sourceInferred: false, ...article, venueNo: 5, ...source },
});

test('シティリーグ: 日付・大会・順位・店舗（都道府県）・推定・URL・元記事の何会場目かを並べる', () => {
  assert.equal(
    generatedItem(city({})),
    [
      '- 【9/27 シティリーグ 優勝】青馬堂矢向店（神奈川）<br>',
      '  **ドラパルトex**（⚠ 推定）<br>',
      '  `/columns/dragapult-ex-deck-0927/`<br>',
      '  元記事：[シティリーグ9/27【日】ベスト16デッキまとめ](https://pokecabook.com/archives/335123) の5会場目',
    ].join('\n'),
  );
});

test('取れなかった項目は空欄にせず「取得できず」と書く', () => {
  const lines = generatedItem(city({ date: null, rank: null, venue: null, venueNo: null })).split('\n');
  assert.equal(lines[0], '- 【日付取得できず シティリーグ 順位取得できず】開催店舗・都道府県: 取得できず<br>');
  assert.match(lines[3], /の何会場目か取得できず$/);
  // 会場名に都道府県がない
  assert.match(generatedItem(city({ venue: 'カードショップ某' })), /】カードショップ某（都道府県: 取得できず）<br>/);
  // 同じ会場が2回ある「GIRAFULLなんば店（大阪）-1」は都道府県あり
  assert.match(generatedItem(city({ venue: 'GIRAFULLなんば店（大阪）-1' })), /】GIRAFULLなんば店（大阪）-1<br>/);
});

test('デッキ名の取り方: ●付き小見出し・通称ルール（元の名前の取り方つき）', () => {
  const gym = { eventLabel: 'ジムバトル', venue: undefined, nameSource: 'bullet' };
  assert.match(generatedItem(city(gym, { deckName: 'ケンタロス', inferred: false })), /\*\*ケンタロス\*\*（●付き小見出し）/);
  assert.match(generatedItem(city(gym, { inferred: false })), /】開催店舗・都道府県: 取得できず<br>/);
  const rule = { deckName: 'おまつりおんど', inferred: false, renamedByRule: true, sourceName: 'カミッチュ' };
  assert.match(generatedItem(city({ sourceInferred: true }, rule)), /（通称ルール・元の名前「カミッチュ」は⚠ 推定）/);
  assert.match(generatedItem(city({ nameSource: 'bullet' }, rule)), /（通称ルール・元の名前「カミッチュ」は●付き小見出し）/);
});
