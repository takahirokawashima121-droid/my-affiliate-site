// scripts/update-prices.js（楽天・Yahoo!の最安値の取得）のうち、まとめ売り・選ぶ形の商品を外す判定のテスト（npm test）
// 商品名は、実際の価格更新のログに出ていた商品名（2026/9/26〜10/1）を使う。API は呼ばない

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundleLines, isBundleTitle, matchingItems, pickAvailableImage, pickCheapest, resolveOutcomes, saleOutcome, splitMatches } from '../update-prices.js';

const card = (name, cardNumber, expansionCode, rarity = 'U') => ({ name, cardNumber, expansionCode, rarity });
const item = (itemName, itemPrice, shopName = 'テスト店') => ({ itemName, itemPrice, shopName, itemUrl: `https://example.com/${encodeURIComponent(itemName)}` });

const nokocchi = card('ノコッチ', '078/100', 'SV9', 'C');
const handy = card('ハンディサーキュレーター', '095/101', 'SV6');
const iyui = card('イーユイ', '018/066', 'SV5a');
const mushitori = card('むしとりセット', '094/101', 'SV6');

test('まとめ売り・〇種類のセットの商品名を見分ける（実際の商品名）', () => {
  const bundles = [
    [nokocchi, 'E63【ポケモン カード】 ノコッチ HP70 いれかわる sv9 078/100 4枚セット 即決'],
    [handy, 'ポケモンカードゲーム ハンディサーキュレーターとジャミングタワーとクレセリアのセット SV6 SV6 095/101 U 【中古】'],
    [iyui, 'ポケモンカードゲーム イーユイ SV5A SV5A 018/066 U 2枚セット 【中古】'],
    [mushitori, 'ポケモンカードゲーム むしとりセット SV6 SV6 094/101 U 2枚セット 【中古】'],
    [card('ラティアスex', '019/064', 'SV7a', 'RR'), 'ポケモンカードゲーム 4枚まとめセット ラティアスex 019/064 RR ポケカ 2512LBM'],
    [card('アカマツ', '097/102', 'SV7'), '[trc-94340] 【中古】 ポケモンカードゲーム アカマツとタロとブライアのセット SV7 SV7 097/102 U'],
    [card('ホップのこだわりハチマキ', '092/100', 'SV9'), 'ポケモンカードゲーム ホップのこだわりハチマキ SV9 SV9 092/100 U 4枚セット 【中古】'],
    [card('シアノ', '102/106', 'SV8'), 'S221【ポケモン カード】 シアノ sv8 102/106 2枚セット 即決'],
    [nokocchi, 'ノコッチ sv9 078/100 ×4枚'],
    [nokocchi, 'ノコッチ sv9 078/100 2枚組'],
    [nokocchi, 'よりどり ノコッチ sv9 078/100'],
    [nokocchi, 'ポケカ 078/100 ノコッチ ほか 選べる'],
  ];
  for (const [c, title] of bundles) assert.equal(isBundleTitle(c, title), true, title);
});

test('1枚売りの商品名はまとめ売りにしない（カード名・商品名に「セット」が入るものも）', () => {
  const singles = [
    [nokocchi, 'ポケモンカード ノコッチ SV9 078/100 C 【中古】'],
    [nokocchi, 'ノコッチ C sv9 078/100 ポケモンカード'],
    [handy, 'ハンディサーキュレーター 095/101'],
    [handy, 'ポケモンカードゲーム ハンディサーキュレーター SV6 拡張パック 変幻の仮面 095/101 U 【中古】'],
    // カード名が「〜セット」
    [mushitori, 'ポケモンカードゲーム むしとりセット SV6 SV6 094/101 U 【中古】'],
    // スターターセットのカード
    [card('ミニーブ', '006/017', 'MEM', '-'), 'ポケモンカードゲーム ミニーブ スターターセットex(イーブイ/ゾロア＆ゾロアーク/ニャオハ＆マスカーニャ) 006/017'],
    [card('メガゲンガーex', '003/021', 'MBG', '-'), 'ポケモンカードゲームMEGA スターターセットMEGA メガゲンガーex メガゲンガーex  (003/021)'],
    // 記号・数字が入る1枚売り
    [card('アンノーン', '060/103', 'M6a', '-'), 'ポケモンカードゲーム アンノーン × M6a拡張パック 30th CELEBRATION　(060/103)'],
    [card('ピカチュウex', '234/193', 'M2a', 'SAR'), 'ポケモンカード ピカチュウex 234/193SAR ポケカ'],
    [card('ピカチュウex', '234/193', 'M2a', 'SAR'), 'ポケモンカードゲームMEGA M2a ハイクラスパック MEGAドリームex ピカチュウex SAR (234/193)'],
    [card('メガリザードンXex', '116/080', 'M2', 'MUR'), 'ポケカ ポケモンカード メガリザードンXex I M2 116/080 MUR #UX3719'],
    [card('トウコ', '085/086', 'SV11W'), 'ポケモンカード トウコ(ミラー) SV11W 085/086 U 【中古】'],
    [nokocchi, 'ポケモンカード ノコッチ SV9 078/100 C 1枚'],
  ];
  for (const [c, title] of singles) assert.equal(isBundleTitle(c, title), false, title);
});

test('まとめ売りより高くても、1枚売りの商品を最安値に選ぶ', () => {
  const items = [
    item('E63【ポケモン カード】 ノコッチ HP70 いれかわる sv9 078/100 4枚セット 即決', 385, 'E-asta イーストア'),
    item('ノコッチ C sv9 078/100 ポケモンカード', 400, 'GAME38JAPAN'),
  ];
  assert.equal(pickCheapest(nokocchi, items).shopName, 'GAME38JAPAN');
  const handyItems = [
    item('ポケモンカードゲーム ハンディサーキュレーターとジャミングタワーとクレセリアのセット SV6 SV6 095/101 U 【中古】', 250, 'バンプ'),
    item('ポケモンカードゲーム ハンディサーキュレーター SV6 拡張パック 変幻の仮面 095/101 U 【中古】', 80, 'iimo リユース店'),
  ];
  assert.equal(pickCheapest(handy, handyItems).itemPrice, 80);
});

test('外したまとめ売りを分けて返し、該当商品から除く', () => {
  const items = [
    item('ポケモンカードゲーム イーユイ SV5A SV5A 018/066 U 2枚セット 【中古】', 29, 'カルバークリーク'),
    item('ポケモンカード イーユイ SV5a 018/066 U 【中古】', 40, 'トレトク'),
    item('ポケモンカード ナゲツケサル SV7a 031/064 U', 9, '別のカード'),
  ];
  const { matches, bundles } = splitMatches(iyui, items);
  assert.deepEqual(matches.map((i) => i.itemPrice), [40]);
  assert.deepEqual(bundles.map((i) => i.itemPrice), [29]);
  assert.deepEqual(matchingItems(iyui, items).map((i) => i.itemPrice), [40]);
});

test('お店ごとの状態：1枚売りあり・まとめ売りだけ・該当なし', () => {
  const items = [item('ポケモンカードゲーム イーユイ SV5A SV5A 018/066 U 2枚セット 【中古】', 29, 'カルバークリーク')];
  const { bundles } = splitMatches(iyui, items);
  const best = pickCheapest(iyui, items);
  assert.equal(best, undefined);
  assert.equal(saleOutcome({ best, bundles }), 'bundles');
  assert.equal(saleOutcome({ best: undefined, bundles: [] }), 'none');
  assert.equal(saleOutcome({ best: items[0], bundles }), 'sale');
});

test('まとめ売りだけのお店は、もう片方に1枚売りがあれば「なし」、どちらにも1枚売りがないときだけ前回の値段を残す', () => {
  // ノコッチ SV9・タケシのスカウト・シアノ：楽天に1枚売り・Yahoo!はまとめ売りだけ → Yahoo!は「なし」
  assert.deepEqual(resolveOutcomes('sale', 'bundles'), { rakuten: 'sale', yahoo: 'none' });
  assert.deepEqual(resolveOutcomes('bundles', 'sale'), { rakuten: 'none', yahoo: 'sale' });
  // どちらにも1枚売りがない（カードの値段が全部なくなる）→ まとめ売りだけのお店は前回の値段を残す
  assert.deepEqual(resolveOutcomes('bundles', 'bundles'), { rakuten: 'keep', yahoo: 'keep' });
  assert.deepEqual(resolveOutcomes('bundles', 'none'), { rakuten: 'keep', yahoo: 'none' });
  assert.deepEqual(resolveOutcomes('none', 'bundles'), { rakuten: 'none', yahoo: 'keep' });
  // もう片方がエラーで取れなかったときは、1枚売りがあるか分からないので残す
  assert.deepEqual(resolveOutcomes('bundles', 'unknown'), { rakuten: 'keep', yahoo: 'unknown' });
  // まとめ売りが関係ないときは今までどおり
  assert.deepEqual(resolveOutcomes('sale', 'none'), { rakuten: 'sale', yahoo: 'none' });
  assert.deepEqual(resolveOutcomes('none', 'none'), { rakuten: 'none', yahoo: 'none' });
});

test('代表画像は、取得できない画像を飛ばして次に安い1枚売りの画像を使う', async () => {
  const withImage = (name, price, shop, url) => ({ ...item(name, price, shop), imageUrl: url });
  const items = [
    withImage('ポケモンカード ノコッチ SV9 078/100 C 【中古】', 120, 'トレトク', 'https://example.com/broken.jpg'),
    withImage('ノコッチ C sv9 078/100 ポケモンカード', 300, 'GAME38JAPAN', 'https://example.com/ok.jpg'),
    withImage('ノコッチ sv9 078/100', 200, 'カードミュージアム Yahoo!店', 'https://example.com/banner.jpg'),
  ];
  const available = async (url) => url !== 'https://example.com/broken.jpg';
  const card = { ...nokocchi, imageUrl: 'https://example.com/old-4set.jpg' };
  const picked = await pickAvailableImage(card, items, available);
  assert.equal(picked.url, 'https://example.com/ok.jpg'); // 宣伝帯の出品者（カードミュージアム）は飛ばす
  assert.equal(picked.failed, 1);
  // 1枚売りの画像が1つも取れなければ url なし（呼び出し側で前の画像を残す）
  const none = await pickAvailableImage(card, items.slice(0, 1), available);
  assert.equal(none.url, undefined);
  // 前回と同じ画像は確認せずに使う
  const same = await pickAvailableImage({ ...card, imageUrl: 'https://example.com/broken.jpg' }, items, async () => false);
  assert.equal(same.url, 'https://example.com/broken.jpg');
});

test('ログの外したまとめ売りは、商品名を切らずに安い順で3件まで出す', () => {
  const long = 'ポケモンカードゲーム ハンディサーキュレーターとジャミングタワーとクレセリアのセット SV6 SV6 095/101 U 【中古】';
  const lines = bundleLines([item('b', 300), item(long, 250, 'バンプ'), item('c', 500), item('d', 400)]);
  assert.equal(lines.length, 4);
  assert.equal(lines[0], `            × ¥250（バンプ）${long}`);
  assert.equal(lines[3], '            ほか 1件');
});
