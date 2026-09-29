// scripts/lib/deck-name-rules.js（デッキ名の言い換えルール）のテスト（npm test）
// レシピは src/data/official-decks.json の実際の記事のもの

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyDeckNameRules, matchDeckNameRule } from '../lib/deck-name-rules.js';
import { deckEnglishName } from '../lib/english-name.js';

const recipes = JSON.parse(readFileSync(new URL('../../src/data/official-decks.json', import.meta.url), 'utf8'));
const cards = (slug) => recipes[slug].cards;

test('ヤドキング入りのデッキは、ポケカブックの名前より「ひらめきチャレンジ」を優先する', () => {
  assert.equal(applyDeckNameRules('ヤドキング', cards('slowking-deck')), 'ひらめきチャレンジ');
  assert.equal(applyDeckNameRules('メガガルーラex', cards('seek-inspiration-deck-0929')), 'ひらめきチャレンジ');
});

test('カミッチュ入りでカミツオロチexなしは「おまつりおんど」、カミツオロチex入りは言い換えない', () => {
  assert.equal(applyDeckNameRules('カミッチュ', cards('kamitchixyu-omatsuri-deck-0928')), 'おまつりおんど');
  assert.equal(applyDeckNameRules('カミッチュ（おまつりおんど）', cards('dipplin-festival-lead-deck-0927')), 'おまつりおんど');
  assert.equal(matchDeckNameRule(cards('hydrapple-ex-deck')), null);
  assert.equal(applyDeckNameRules('カミツオロチex', cards('hydrapple-ex-deck')), 'カミツオロチex');
});

test('公式デッキの形式（count）でも判定でき、ヤドキング1枚だけは「迷う」として言い換えない', () => {
  const one = [{ name: 'ヤドキング', count: 1 }, { name: 'メガガルーラex', count: 3 }];
  assert.equal(matchDeckNameRule(one).uncertain, true);
  assert.equal(applyDeckNameRules('メガガルーラex', one), 'メガガルーラex');
  assert.equal(matchDeckNameRule([{ name: 'ヤドキング', count: 2 }]).uncertain, false);
  assert.equal(applyDeckNameRules('ドラパルトex', cards('dragapult-ex-yonoir-deck')), 'ドラパルトex');
});

test('言い換え後のデッキ名の英語表記（URL 用）', () => {
  assert.equal(deckEnglishName('ひらめきチャレンジ'), 'seek-inspiration');
  assert.equal(deckEnglishName('おまつりおんど'), 'dipplin-festival-lead');
});
