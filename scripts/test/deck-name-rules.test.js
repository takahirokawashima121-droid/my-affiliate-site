// scripts/lib/deck-name-rules.js（デッキ名の通称ルール）のテスト（npm test）
// レシピは src/data/official-decks.json の実際の記事のもの

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyDeckNameRules, matchDeckNameRule, needsAbilities, ruleMainCard } from '../lib/deck-name-rules.js';
import { baseDeckName, columnDay } from '../lib/deck-variant.js';
import { deckEnglishName } from '../lib/english-name.js';

const recipes = JSON.parse(readFileSync(new URL('../../src/data/official-decks.json', import.meta.url), 'utf8'));
const cards = (slug) => recipes[slug].cards;

test('ヤドキング入りのデッキは、ポケカブックの名前より「ひらめきチャレンジ」を優先する', () => {
  assert.equal(applyDeckNameRules('ヤドキング', cards('slowking-deck')), 'ひらめきチャレンジ');
  assert.equal(applyDeckNameRules('メガガルーラex', cards('seek-inspiration-deck-0929')), 'ひらめきチャレンジ');
});

test('カミッチュ入りでカミツオロチexなしは「おまつりおんど」、カミツオロチex入りは通称にしない', () => {
  assert.equal(applyDeckNameRules('カミッチュ', cards('kamitchixyu-omatsuri-deck-0928')), 'おまつりおんど');
  assert.equal(applyDeckNameRules('カミッチュ（おまつりおんど）', cards('dipplin-festival-lead-deck-0927')), 'おまつりおんど');
  assert.equal(matchDeckNameRule(cards('hydrapple-ex-deck')), null);
  assert.equal(applyDeckNameRules('カミツオロチex', cards('hydrapple-ex-deck')), 'カミツオロチex');
});

test('公式デッキの形式（count）でも判定でき、ヤドキング1枚だけは「迷う」として通称にしない', () => {
  const one = [{ name: 'ヤドキング', count: 1 }, { name: 'メガガルーラex', count: 3 }];
  assert.equal(matchDeckNameRule(one).uncertain, true);
  assert.equal(applyDeckNameRules('メガガルーラex', one), 'メガガルーラex');
  assert.equal(matchDeckNameRule([{ name: 'ヤドキング', count: 2 }]).uncertain, false);
  assert.equal(applyDeckNameRules('ドラパルトex', cards('dragapult-ex-blaziken-deck')), 'ドラパルトex');
});

test('ドラパルトexのデッキに特性「カースドボム」のカードが入っていれば「ボムドラパ」（サマヨール・ヨノワールのどちらでも）', () => {
  assert.equal(applyDeckNameRules('ドラパルトex', cards('dragapult-ex-yonoir-deck')), 'ボムドラパ');
  assert.equal(applyDeckNameRules('ドラパルトex', cards('dragapult-ex-deck-0927-moltres')), 'ボムドラパ');
  const base = [{ name: 'ドラパルトex', count: 3 }, { name: 'ドロンチ', count: 4 }];
  assert.equal(applyDeckNameRules('ドラパルトex', [...base, { name: 'サマヨール', count: 1 }]), 'ボムドラパ');
  assert.equal(applyDeckNameRules('ドラパルトex', [...base, { name: 'ヨノワール', count: 1 }]), 'ボムドラパ');
  // 特性の一覧を渡せば、新しいカードでも特性の名前で判定する
  assert.equal(applyDeckNameRules('ドラパルトex', [...base, { name: '新しいカード', count: 1 }], { 新しいカード: ['カースドボム'] }), 'ボムドラパ');
  // ドラパルトexがなければ当てはまらない
  assert.equal(matchDeckNameRule([{ name: 'メガディアンシーex', count: 3 }, { name: 'ヨノワール', count: 1 }]), null);
  assert.equal(ruleMainCard(matchDeckNameRule(cards('dragapult-ex-yonoir-deck')).rule), 'ドラパルトex');
  assert.equal(needsAbilities(base), true);
  assert.equal(needsAbilities([{ name: 'メガディアンシーex', count: 3 }]), false);
});

test('ドラパルトexのデッキにノココッチが入っていれば「ノココッチドラパ」', () => {
  assert.equal(applyDeckNameRules('ドラパルトex', cards('dragapult-ex-nokokotchi-deck')), 'ノココッチドラパ');
  assert.equal(applyDeckNameRules('ドラパルトex', cards('doraparutoex-deck-0928-nokotchi')), 'ノココッチドラパ');
});

test('違う名前の2つ以上のルールに当てはまるデッキは、どちらの名前にもせず conflict にする', () => {
  const both = [{ name: 'ドラパルトex', count: 3 }, { name: 'ヨノワール', count: 1 }, { name: 'ノココッチ', count: 1 }];
  const hit = matchDeckNameRule(both);
  assert.equal(hit.conflict, true);
  assert.equal(hit.uncertain, true);
  assert.deepEqual(hit.rules.map((r) => r.name), ['ボムドラパ', 'ノココッチドラパ']);
  assert.equal(applyDeckNameRules('ドラパルトex', both), 'ドラパルトex');
});

test('デッキ名の付け足し（「（〇〇採用型）」「（〇〇2枚型）」）を外す・記事の大会の日', () => {
  assert.equal(baseDeckName('カミツオロチex（ハンディサーキュレーター採用型）'), 'カミツオロチex');
  assert.equal(baseDeckName('ドラパルトex（ノコッチ2枚型）'), 'ドラパルトex');
  assert.equal(baseDeckName('カミッチュ（おまつりおんど）'), 'カミッチュ（おまつりおんど）');
  assert.equal(columnDay({ eventDate: '2026-09-27', result: '9/27 シティリーグ優勝' }), '9/27');
  assert.equal(columnDay({ result: '9/26 ジムバトル優勝' }), '9/26');
  assert.equal(columnDay({ result: '環境Tier1・大会優勝構築' }), null);
});

test('通称の英語表記（URL 用）', () => {
  assert.equal(deckEnglishName('ひらめきチャレンジ'), 'seek-inspiration');
  assert.equal(deckEnglishName('おまつりおんど'), 'dipplin-festival-lead');
  assert.equal(deckEnglishName('ボムドラパ'), 'bomb-dragapult');
  assert.equal(deckEnglishName('ノココッチドラパ'), 'dudunsparce-dragapult');
});
