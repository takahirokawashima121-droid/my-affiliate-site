// scripts/lib/title-place.js（同じ日・同じ名前の記事のタイトルを開催地で区別する）のテスト（npm test）

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeTitles, venueParts, withPlace } from '../lib/title-place.js';

const city = (slug, venue, rank = '優勝', deckName = 'メガゲッコウガex') => ({
  slug,
  deckName,
  result: `9/26 シティリーグ${rank}`,
  eventDate: '2026-09-26',
  venue,
  title: `【9/26 シティリーグ${rank}】${deckName}デッキレシピ！採用カード最安値・代替パーツ提案`,
});
const gym = (slug, deckName = 'メガジガルデex') => ({
  slug,
  deckName,
  result: '9/26 ジムバトル優勝',
  title: `【9/26 ジムバトル優勝】${deckName}デッキレシピと回し方！採用カード最安値・代替パーツ提案`,
});

test('開催店舗の文字から店舗名と都道府県を取り出す', () => {
  assert.deepEqual(venueParts('シーガル　仙台駅前店（宮城）'), { store: 'シーガル 仙台駅前店', pref: '宮城' });
  assert.deepEqual(venueParts('カードショップA'), { store: 'カードショップA', pref: null });
  assert.equal(venueParts(undefined), null);
});

test('タイトルの【】に開催地を付ける（付け直しても重ならない）', () => {
  const t = '【9/26 シティリーグ優勝】メガゲッコウガexデッキレシピ！…';
  assert.equal(withPlace(t, '9/26 シティリーグ優勝', '千葉'), '【9/26 シティリーグ優勝・千葉】メガゲッコウガexデッキレシピ！…');
  assert.equal(withPlace('【9/26 シティリーグ優勝・千葉】X', '9/26 シティリーグ優勝', '東京'), '【9/26 シティリーグ優勝・東京】X');
  assert.equal(withPlace('【環境Tier1】X', '9/26 シティリーグ優勝', '千葉'), '【環境Tier1】X');
});

test('同じ日・同じ名前の記事だけ、都道府県で区別する', () => {
  const cols = [city('a', 'ショップA（千葉）'), city('b', 'ショップB（東京）'), city('c', 'ショップC（大阪）', '優勝', 'ボムドラパ')];
  const { titles, unresolved } = placeTitles(cols);
  assert.equal(titles.get('a'), '【9/26 シティリーグ優勝・千葉】メガゲッコウガexデッキレシピ！採用カード最安値・代替パーツ提案');
  assert.equal(titles.get('b'), '【9/26 シティリーグ優勝・東京】メガゲッコウガexデッキレシピ！採用カード最安値・代替パーツ提案');
  assert.equal(titles.has('c'), false); // 同じ名前の記事がない
  assert.deepEqual(unresolved, []);
});

test('都道府県も同じなら店舗名で区別する', () => {
  const cols = [city('a', 'ショップA（千葉）'), city('b', 'ショップB（千葉）'), city('c', 'ショップC（東京）')];
  const { titles } = placeTitles(cols);
  assert.match(titles.get('a'), /^【9\/26 シティリーグ優勝・ショップA】/);
  assert.match(titles.get('b'), /^【9\/26 シティリーグ優勝・ショップB】/);
  assert.match(titles.get('c'), /^【9\/26 シティリーグ優勝・東京】/);
});

test('店舗のデータがない記事（ジムバトル）は区別できず、PR で知らせる一覧に入る', () => {
  const { titles, unresolved } = placeTitles([gym('x'), gym('y')]);
  assert.equal(titles.size, 0);
  assert.equal(unresolved.length, 1);
  assert.deepEqual(unresolved[0].columns.map((c) => c.slug), ['x', 'y']);
});
