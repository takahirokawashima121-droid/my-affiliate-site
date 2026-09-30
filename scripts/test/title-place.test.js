// scripts/lib/title-place.js（同じ日・同じ名前の記事のタイトルを開催地で区別する）のテスト（npm test）

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeTitles, recipeLabels, venueParts, withLabel, withPlace } from '../lib/title-place.js';

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

test('大会の種類が違えば、同じ日・同じ名前でも区別の対象にしない', () => {
  const c = { ...city('a', 'ショップA（千葉）', '優勝', 'メガジガルデex') };
  const { titles, groups } = placeTitles([c, gym('x')]);
  assert.equal(titles.size, 0);
  assert.equal(groups.length, 0);
});

test('タイトルのデッキ名のあとに「（〇〇採用型）」を付ける・付け直す', () => {
  const t = '【9/26 ジムバトル優勝】メガジガルデexデッキレシピ！…';
  assert.equal(withLabel(t, 'メガジガルデex', 'ヒーローマント採用型'), '【9/26 ジムバトル優勝】メガジガルデex（ヒーローマント採用型）デッキレシピ！…');
  assert.equal(withLabel('【9/26 ジムバトル優勝】メガジガルデex（別構築）デッキ', 'メガジガルデex', '別構築2'), '【9/26 ジムバトル優勝】メガジガルデex（別構築2）デッキ');
  assert.equal(withLabel('【9/26 ジムバトル優勝】メガジガルデex（別構築）デッキ', 'メガジガルデex', null), '【9/26 ジムバトル優勝】メガジガルデexデッキ');
});

test('採用型のカードの選び方: その記事にしかないカード・ポケモン → サポート → グッズ等・枚数・順番', () => {
  const E = (name, qty, category) => ({ name, qty, category });
  const shared = [E('メガジガルデex', 3, 'ポケモン'), E('ハイパーボール', 4, 'グッズ'), E('基本闘エネルギー', 8, 'エネルギー')];
  // ポケモンがサポートより優先。枚数が違うだけのカード（ハイパーボール）は選ばない
  const a = [...shared, E('リーリエの決心', 4, 'サポート'), E('ヨマワル', 1, 'ポケモン')];
  const b = [...shared.map((e) => (e.name === 'ハイパーボール' ? { ...e, qty: 2 } : e)), E('ヒーローマント', 1, 'ポケモンのどうぐ')];
  assert.deepEqual(recipeLabels([a, b]), [{ card: 'ヨマワル', label: 'ヨマワル採用型' }, { card: 'ヒーローマント', label: 'ヒーローマント採用型' }]);
  // 同じ種類なら枚数の多いカード、それも同じなら先に出てくるカード
  const c = [...shared, E('ペパー', 1, 'サポート'), E('ボスの指令', 2, 'サポート')];
  const d = [...shared, E('ジャンボアイス', 1, 'グッズ'), E('おいしいおむすび', 1, 'グッズ')];
  assert.deepEqual(recipeLabels([c, d]).map((x) => x.card), ['ボスの指令', 'ジャンボアイス']);
  // 基本エネルギー・特殊エネルギーは選ばない。違うカードがなければ別構築（2本目以降は番号付き）
  const e = [...shared, E('基本鋼エネルギー', 2, 'エネルギー')];
  assert.deepEqual(recipeLabels([shared, e, shared]).map((x) => x.label), ['別構築', '別構築2', '別構築3']);
});

test('店舗のデータがない記事（ジムバトル）は、レシピの違いから「（〇〇採用型）」をタイトルに付ける', () => {
  const recipes = {
    x: [{ name: 'メガジガルデex', qty: 3, category: 'ポケモン' }, { name: 'ヒーローマント', qty: 1, category: 'ポケモンのどうぐ' }],
    y: [{ name: 'メガジガルデex', qty: 3, category: 'ポケモン' }, { name: 'サバイブギプス', qty: 1, category: 'ポケモンのどうぐ' }],
  };
  const { titles, groups, unresolved } = placeTitles([gym('x'), gym('y')], (c) => recipes[c.slug]);
  assert.equal(titles.get('x'), '【9/26 ジムバトル優勝】メガジガルデex（ヒーローマント採用型）デッキレシピと回し方！採用カード最安値・代替パーツ提案');
  assert.equal(titles.get('y'), '【9/26 ジムバトル優勝】メガジガルデex（サバイブギプス採用型）デッキレシピと回し方！採用カード最安値・代替パーツ提案');
  assert.deepEqual(groups[0].columns.map((t) => t.card), ['ヒーローマント', 'サバイブギプス']);
  assert.deepEqual(unresolved, []);
});

test('レシピもない記事はタイトルが重なったままになり、PR で知らせる一覧に入る', () => {
  const { titles, unresolved } = placeTitles([gym('x'), gym('y')]);
  assert.equal(titles.size, 0);
  assert.deepEqual(unresolved[0].columns.map((c) => c.slug), ['x', 'y']);
});
