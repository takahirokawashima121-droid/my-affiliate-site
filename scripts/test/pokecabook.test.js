// scripts/lib/pokecabook.js の読み取りのテスト（npm test）
// fixtures/ の HTML は、ポケカブックの実際のまとめ記事（2026-09-29 取得）から本文・画像を除き、
// タグ・class の構造、見出し（日付・会場・デッキ名）、デッキコードのリンクだけを残したもの（scripts/debug/skeleton-html.js で作成）

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gymFreshItems, parseCityArticle, parseGymArticle } from '../lib/pokecabook.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('ジムバトル: 9/28 の4デッキを、●が CSS で付く h4 の小見出しの名前で読める（archives/27265）', () => {
  const decks = parseGymArticle(fixture('pokecabook-27265-gym.html'));
  assert.deepEqual(
    decks.slice(0, 4).map((d) => [d.archetype, d.nameSource, d.date, d.rank]),
    [
      ['スッカラカン', 'bullet', '9/28', '優勝'],
      ['イイネイヌ', 'bullet', '9/28', '優勝'],
      ['ボムファイアロー', 'bullet', '9/28', '優勝'],
      ['ケンタロス', 'bullet', '9/28', '優勝'],
    ],
  );
  // 記事内のすべてのデッキに小見出しの名前が付き、日付の見出しがデッキ名になっていない
  assert.ok(decks.length >= 4);
  for (const d of decks) {
    assert.equal(d.nameSource, 'bullet', d.deckId);
    assert.doesNotMatch(d.archetype, /ジムバトル|\d{1,2}\/\d{1,2}/);
  }
});

test('シティリーグ: 名前が画像にしかない記事は、会場ごとの優勝・準優勝を archetype なしで読む（archives/335123）', () => {
  const decks = parseCityArticle(fixture('pokecabook-335123-city.html'), 'シティリーグ9/27【日】ベスト16デッキまとめ');
  assert.ok(decks.length > 0);
  assert.deepEqual(decks.slice(0, 2).map((d) => [d.venue, d.rank, d.date, d.archetype, d.nameSource]), [
    ['宝島　多治見店（岐阜）', '優勝', '9/27', null, null],
    ['宝島　多治見店（岐阜）', '準優勝', '9/27', null, null],
  ]);
  assert.ok(decks.every((d) => ['優勝', '準優勝'].includes(d.rank) && d.archetype === null));
  // venueNo は記事の中で何会場目か（会場の見出しを上から数える。結果の画像がない6会場目のオレタン松山店も数える）
  assert.deepEqual(decks.slice(0, 3).map((d) => [d.venue, d.rank, d.venueNo]), [
    ['宝島　多治見店（岐阜）', '優勝', 1],
    ['宝島　多治見店（岐阜）', '準優勝', 1],
    ['ドラグーン周南（山口）', '優勝', 2],
  ]);
  // PR #17 の4本（2026-09-30 生成）はどれも会場の「優勝」のリンクから読んだデッキ
  const byId = new Map(decks.map((d) => [d.deckId, d]));
  assert.deepEqual(
    ['vwwbVf-nPrGK4-wFFkkw', 'Yxxc44-XqeDBA-K4G8Dc', 'cDGG88-iDJiq0-DxKx8D', 'HgNng9-ow8ILU-gPn6nN'].map((id) => [byId.get(id).venue, byId.get(id).rank, byId.get(id).venueNo]),
    [
      ['バトロコ　柏駅前（千葉）', '優勝', 5],
      ['ドラゴンスター神戸三宮店（兵庫）', '優勝', 7],
      ['三洋堂書店　新開橋店（愛知）', '優勝', 9],
      ['トレカショップVOW（滋賀）', '優勝', 10],
    ],
  );
});

test('小見出しの形式: 文字の●あり・なし・<span>●</span> のどれでもデッキ名を読む', () => {
  const link = (id) => `<figure><figcaption><a href="https://www.pokemon-card.com/deck/result.html/deckID/${id}/">9/28【月】ジムバトル優勝</a></figcaption></figure>`;
  const html = `<div class="entry-content">
    <h3>前書きの見出し</h3>
    <h2>9/28【月】ジムバトル優勝</h2>
    <h4>●スッカラカン</h4>${link('aaa-111')}
    <h4><span>●</span>イイネイヌ</h4>${link('bbb-222')}
    <h4>ボムファイアローデッキ</h4>${link('ccc-333')}
    ${link('ddd-444')}
    <h4>大会結果</h4>${link('eee-555')}
  </div>`;
  assert.deepEqual(
    parseGymArticle(html).map((d) => [d.deckId, d.archetype, d.nameSource]),
    [
      ['aaa-111', 'スッカラカン', 'bullet'],
      ['bbb-222', 'イイネイヌ', 'bullet'],
      ['ccc-333', 'ボムファイアロー', 'bullet'],
      // 小見出しのないデッキに、前のデッキの名前を使わない
      ['ddd-444', null, null],
      ['eee-555', null, null],
    ],
  );
  // 何会場目か（ジムバトルはデッキ1つが1会場）。リンクの文字に成績がなければ順位は null（「優勝」と決めつけない）
  const noRank = `<div class="entry-content"><h2>9/28【月】ジムバトル優勝</h2><h4>ケンタロス</h4><a href="https://www.pokemon-card.com/deck/result.html/deckID/fff-666/">デッキコード</a></div>`;
  assert.deepEqual(parseGymArticle(noRank).map((d) => [d.rank, d.venueNo, d.date]), [[null, 1, '9/28']]);
  assert.deepEqual(parseGymArticle(html).map((d) => d.venueNo), [1, 2, 3, 4, 5]);


});

test('ジムバトル: 同じタイトルのまま追記される処理済みの記事も見直す（gymFreshItems）', () => {
  const week = { title: '【9/28(月)～10/4(日)】ジムバトル優勝デッキまとめ【30th CELEBRATION環境】' };
  const prev = { title: '【9/26(土)～9/27(日)】ジムバトル優勝デッキまとめ【30th CELEBRATION環境】' };
  const next = { title: '【10/5(月)～10/11(日)】ジムバトル優勝デッキまとめ【30th CELEBRATION環境】' };
  const done = new Set([week, prev]);
  // 2026-10-01 の実行: RSS には処理済み（9/29）の週の記事1件だけ → その記事を見直す（以前は 0件で「新着はありません」になっていた）
  assert.deepEqual(gymFreshItems([week], (it) => done.has(it), 3), [week]);
  // 新しい週の記事が出たら、新しい記事と、いちばん新しい処理済みの記事（最後の日の追記を取りこぼさない）まで見る
  assert.deepEqual(gymFreshItems([next, week, prev], (it) => done.has(it), 3), [next, week]);
  // 処理済みの記事がなければ、上限まで
  assert.deepEqual(gymFreshItems([next, week, prev], () => false, 2), [next, week]);
});
