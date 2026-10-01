// scripts/lib/highlight.js（デッキ記事の見どころの自動生成・決まった文の点検）のテスト（npm test）
// カードテキストは、自動生成した実際の記事ページ（src/pages/columns/*.astro）の「主力カードの効果」から読む

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { auditHighlights, bannedPhrases, chooseHighlights, highlightCandidates, opening, similarOpenings } from '../lib/highlight.js';
import { effectsFromPage, lineFromGamePlan } from '../rewrite-highlights.js';
import { buildXPosts, xWeightedLength, PARENT_POST_LIMIT } from '../../src/utils/shareText.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const recipes = JSON.parse(read('src/data/official-decks.json'));
const columns = JSON.parse(read('src/data/deck-columns.json'));
const nameOfId = new Map(JSON.parse(read('src/data/cards.json')).map((c) => [c.id, c.name]));

/** 記事ページから見どころの材料を作る（scripts/rewrite-highlights.js と同じ） */
function input(slug) {
  const column = columns.find((c) => c.slug === slug);
  const profiles = effectsFromPage(read(`src/pages/columns/${slug}.astro`), nameOfId);
  profiles.get(column.keyCards[0]).line = lineFromGamePlan(column.gamePlan);
  return { recipe: recipes[column.deckKey].cards, profiles, keyCards: column.keyCards };
}
const TEMPLATE = 'カミッチュ・カジッチュを採用したおまつりおんどデッキ。主力カードの効果と最安値をまとめて確認';

test('記事ページの「主力カードの効果」から、公式のカードテキストを読み取れる', () => {
  const { profiles } = input('dipplin-festival-lead-deck-0929');
  const kamitchu = profiles.get('カミッチュ').effects;
  assert.deepEqual(kamitchu.map((e) => [e.kind, e.name, e.cost, e.damage]), [
    ['特性', 'おまつりおんど', '', ''],
    ['ワザ', 'ともだちのわ', '草', '20×'],
  ]);
  assert.equal(kamitchu[1].text, '自分のベンチポケモンの数×20ダメージ。');
  assert.deepEqual(lineFromGamePlan(columns.find((c) => c.slug === 'hydrapple-ex-deck-0929').gamePlan).sort(), ['カジッチュ', 'カミッチュ'].sort());
});

test('見どころは主役の特性・ワザ名・ダメージと、組み合わせるカードの効果を書き、決まった文を使わない', () => {
  const [first] = highlightCandidates(input('dipplin-festival-lead-deck-0929'));
  assert.match(first, /特性「おまつりおんど」/);
  assert.match(first, /「ともだちのわ」（20×）/);
  assert.match(first, /自分のベンチポケモンの数×20ダメージ/);
  assert.match(first, /バチンキーの特性「ドンドンだいこ」は、自分のバトルポケモンが特性「おまつりおんど」を持つポケモンなら/);
  assert.deepEqual(bannedPhrases(first), []);
});

test('ダメージが増えるワザ（30＋）を主力として先に書き、進化前のポケモンは組み合わせのカードに選ばない', () => {
  const [first] = highlightCandidates(input('ceruledge-ex-deck-0929'));
  assert.match(first, /^ソウブレイズexのワザ「しんえんほむら」（30＋）は、自分のトラッシュにあるエネルギーの枚数×20ダメージ追加/);
  const hydrapple = highlightCandidates(input('hydrapple-ex-deck-0929')).join('\n');
  assert.doesNotMatch(hydrapple, /カミッチュ|カジッチュ/);
});

test('カードテキストにない効果・ワザは書かない（「」のワザ名・特性名はすべてデータにある）', () => {
  for (const slug of ['mherakurosuex-deck-0927', 'hisui-deck-0927', 'burungeruex-deck-0927', 'mrizadonxex-deck-0927', 'dipplin-festival-lead-deck-0929', 'hydrapple-ex-deck-0929', 'ceruledge-ex-deck-0929']) {
    const data = input(slug);
    const known = [...data.profiles.values()].flatMap((p) => p.effects.flatMap((e) => [e.name, ...(e.text.match(/「[^」]+」/g) ?? []).map((q) => q.slice(1, -1))]));
    for (const h of highlightCandidates(data)) {
      assert.ok(h.length > 0 && bannedPhrases(h).length === 0, `${slug}: ${h}`);
      for (const [, q] of h.matchAll(/「([^」]+)」/g)) assert.ok(known.includes(q), `${slug}: 「${q}」はカードテキストにない`);
    }
  }
});

test('決まった文を見つけ、同じ日の記事で書き出しがそっくりな組を知らせる', () => {
  assert.deepEqual(bannedPhrases(TEMPLATE), ['「主力カードの効果と最安値をまとめて確認」', '「〜をまとめて確認」', '「〇〇を採用した〇〇デッキ」', '「〇〇・〇〇を採用した」']);
  assert.deepEqual(bannedPhrases('お祭り会場の下でワザを2回連続で使い、グラジオの決戦で1ターンに400以上のダメージ'), []);
  const a = { slug: 'a', pubDate: '2026-09-30', highlight: 'メガヘラクロスexのワザ「やまどつき」（170）は、相手の山札を上から2枚トラッシュする', names: ['メガヘラクロスex'] };
  const b = { slug: 'b', pubDate: '2026-09-30', highlight: 'ソウブレイズexのワザ「アメジストレイジ」（280）は、このポケモンについているエネルギーを、すべてトラッシュする', names: ['ソウブレイズex'] };
  const c = { ...b, slug: 'c', pubDate: '2026-09-29' };
  assert.equal(opening(a.highlight, a.names), '○のワザ「□」（9）は、');
  assert.equal(opening(a.highlight, a.names), opening(b.highlight, b.names));
  assert.equal(similarOpenings([a, b]).length, 1);
  const audit = auditHighlights([a, b, c, { slug: 'd', pubDate: '2026-09-30', highlight: TEMPLATE, names: [] }]);
  assert.deepEqual(audit.similar.map(([x, y]) => [x.slug, y.slug]), [['a', 'b']]);
  assert.deepEqual(audit.banned.map((x) => x.slug), ['d']);
});

test('同じ日の記事と書き出しが重なるときは、書き出しの違う候補を選ぶ', () => {
  const existing = [{ slug: 'x', highlight: 'メガヘラクロスexのワザ「やまどつき」（170）は、相手の山札を上から2枚トラッシュする', names: ['メガヘラクロスex'] }];
  const data = input('ceruledge-ex-deck-0929');
  const candidates = highlightCandidates(data);
  assert.ok(candidates.length >= 2);
  const chosen = chooseHighlights([{ slug: 'ceruledge', names: data.recipe.map((e) => e.name), candidates }], existing).get('ceruledge');
  assert.equal(similarOpenings([{ ...existing[0] }, { slug: 'ceruledge', highlight: chosen, names: data.recipe.map((e) => e.name) }]).length, 0);
});

test('X投稿文は見どころを文の区切りで止め、途中で「…」で切らずに上限に収める', () => {
  const [highlight] = highlightCandidates(input('dipplin-festival-lead-deck-0929'));
  const { parent } = buildXPosts({ deckName: 'おまつりおんど', result: '9/29 シティリーグ優勝', highlight, estimate: 12345, url: 'https://example.com/' });
  assert.ok(xWeightedLength(parent) <= PARENT_POST_LIMIT);
  assert.match(parent, /カミッチュは特性「おまつりおんど」/);
  assert.doesNotMatch(parent, /…/);
  assert.doesNotMatch(parent, /まとめて確認/);
});

test('特性の使える条件と、ワザのダメージが書かれた次の文も、カードテキストのまま入れる', () => {
  const [talonflame] = highlightCandidates(input('bomb-talonflame-deck-0928'));
  assert.match(talonflame, /^ファイアローexの特性「エキサイトダイブ」は、このカードが手札にあり、自分の場に無タイプの「メガシンカex」がいるなら、このカードをベンチに出す/);
  const [tauros] = highlightCandidates(input('tauros-deck-0928'));
  assert.match(tauros, /コインを投げる。選んだポケモンに、オモテの数×50ダメージ/);
});
