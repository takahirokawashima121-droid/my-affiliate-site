// 公開済みのデッキ記事のデッキ名が、ポケカブックのまとめ記事の●付き小見出しの名前と合っているかを照合する（記事は書き換えない）
//
// 使い方:
//   npm run check-deck-names       結果を .cache/deck-name-check.md（Issue 本文）と .cache/deck-name-check.json に書き出す
//
// GitHub Actions の check-deck-names.yml（Actions タブから手動実行）が実行し、結果の .md をそのまま Issue として作成する。
//
// 仕組み:
// 1. src/data/deck-columns.json の全記事について、src/data/official-decks.json から公式デッキコード（deckID）を引く
// 2. 元になったまとめ記事を scripts/cache/processed-decks.json（記事化したデッキコード・記事の記録）から探す。
//    記録にない記事（手動で作成した記事など）や、記録の記事にデッキコードが見つからない場合は、
//    いまの RSS に載っているジムバトル・シティリーグのまとめ記事からもデッキコードを探す。
//    ジムバトルのまとめ記事は同じURLのまま毎日書き換えられ、古いデッキが消えるため、見つからないときは
//    Wayback Machine（web.archive.org）に保存された、処理日の前後の版も読む
// 3. まとめ記事を scripts/lib/pokecabook.js（記事の自動生成と同じ読み取り処理）で読み、デッキコードが一致するデッキの●付き小見出しの名前を取り出す
// 4. 今のデッキ名と比べ、「一致」「不一致」「確認できなかった」に分ける。
//    古い記事の付け足し（「（ノココッチex採用型）」など当サイトで付けていた区別）を外した名前が一致する場合も「一致」とする。
//    デッキ名の通称ルール（scripts/lib/deck-name-rules.js）に当てはまるデッキは、ルールの名前と比べる（ポケカブックの名前より優先）。
//    ●付き小見出しがない（シティリーグのように名前が画像にしかない）、デッキコードが元記事に見つからない、取得に失敗した、などは「確認できなかった」
//
// マナー: ポケカブックへのリクエストは1.5秒以上あけ（scripts/lib/official.js の fetchText）、robots.txt で禁止されたページは取得しない。
// 保存・出力するのはデッキ名・記事のURLのみ（本文・画像・プレイヤー名は保存しない）

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchText, norm } from './lib/official.js';
import { FEEDS, feedItems, parseCityArticle, parseGymArticle } from './lib/pokecabook.js';
import { baseDeckName } from './lib/deck-variant.js';
import { matchDeckNameRule } from './lib/deck-name-rules.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const SITE_URL = 'https://www.pokeca-factory.com/';
const OUT_MD = path('.cache/deck-name-check.md');
const OUT_JSON = path('.cache/deck-name-check.json');

/** Wayback Machine の保存版を探す範囲（処理日の何日前〜何日後）と、1記事あたりに読む保存版の数の上限 */
const ARCHIVE_DAYS_BEFORE = 7;
const ARCHIVE_DAYS_AFTER = 2;
const ARCHIVE_MAX_SNAPSHOTS = 6;

const STATUS = { match: '一致', mismatch: '不一致', unknown: '確認できなかった' };

const readJson = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback);
const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const isCity = (title) => /シティリーグ/.test(title ?? '');
const withoutEx = (name) => norm(name).replace(/ex$/i, '');

/** robots.txt（User-agent: * のグループ）で禁止されていないか。robots.txt が取れないときは許可とみなす */
const robotsCache = new Map();
async function allowedByRobots(url) {
  const { origin, pathname } = new URL(url);
  if (!robotsCache.has(origin)) {
    let rules = [];
    try {
      let inGroup = false;
      for (const raw of (await fetchText(`${origin}/robots.txt`)).split('\n')) {
        const line = raw.replace(/#.*/, '').trim();
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (/^user-agent$/i.test(key)) inGroup = value === '*';
        else if (inGroup && /^(dis)?allow$/i.test(key) && value) rules.push({ allow: /^allow$/i.test(key), path: value });
      }
    } catch {
      rules = [];
    }
    robotsCache.set(origin, rules);
  }
  // いちばん長く一致したルールに従う
  const hit = robotsCache
    .get(origin)
    .filter((r) => pathname.startsWith(r.path.replace(/\*$/, '')))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return !hit || hit.allow;
}

/** まとめ記事を1回だけ取得して読む。返り値: { decks, html } または { error } */
const pageCache = new Map();
function readArticle(link, title) {
  const key = `${link}#${isCity(title) ? 'city' : 'gym'}`;
  if (!pageCache.has(key)) {
    pageCache.set(
      key,
      (async () => {
        if (!(await allowedByRobots(link))) return { error: 'robots.txt で取得が禁止されている' };
        try {
          const html = await fetchText(link);
          return { html, decks: isCity(title) ? parseCityArticle(html, title) : parseGymArticle(html) };
        } catch (error) {
          return { error: `元記事を取得できなかった（${error.message}）` };
        }
      })(),
    );
  }
  return pageCache.get(key);
}

/** 「2026-09-28」→ Wayback Machine の日時（20260928000000）。days 日ずらす */
const waybackTime = (date, days) => new Date(Date.parse(`${date}T00:00:00+09:00`) + days * 864e5).toISOString().replace(/\D/g, '').slice(0, 14);

/**
 * 元記事の Wayback Machine の保存版（処理日の前後）。処理日に近い順に最大 ARCHIVE_MAX_SNAPSHOTS 件
 * 返り値: [{ link: 保存版のURL（元のHTMLのまま）, title }]
 */
const snapshotCache = new Map();
async function archivedArticles(article) {
  if (!article.processedAt) return [];
  const key = `${article.link}#${article.processedAt}`;
  if (!snapshotCache.has(key)) {
    const from = waybackTime(article.processedAt, -ARCHIVE_DAYS_BEFORE);
    const to = waybackTime(article.processedAt, ARCHIVE_DAYS_AFTER);
    const target = waybackTime(article.processedAt, 0.5);
    let times = [];
    try {
      const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(article.link)}&output=json&filter=statuscode:200&collapse=digest&from=${from}&to=${to}`;
      const rows = JSON.parse((await fetchText(cdx)) || '[]').slice(1);
      times = rows.map((r) => r[1]).sort((a, b) => Math.abs(Number(a) - Number(target)) - Math.abs(Number(b) - Number(target)));
    } catch (error) {
      console.warn(`Wayback Machine の保存版を探せませんでした: ${article.link}（${error.message}）`);
    }
    snapshotCache.set(
      key,
      times.slice(0, ARCHIVE_MAX_SNAPSHOTS).map((t) => ({ link: `https://web.archive.org/web/${t}id_/${article.link}`, title: article.title, archived: true })),
    );
  }
  return snapshotCache.get(key);
}

/** 1記事分の照合 */
async function checkColumn(column, deckId, articles, fallbackArticles, recipe = []) {
  const row = {
    slug: column.slug,
    deckName: column.deckName,
    url: `${SITE_URL}columns/${column.slug}/`,
    deckId: deckId ?? null,
    sourceName: null,
    status: STATUS.unknown,
    source: null,
    note: '',
  };
  if (!deckId) return { ...row, note: '公式デッキコードが official-decks.json にない' };

  const notes = [];
  const seen = new Set();
  // いまの記事 → RSS・記録のほかの記事 → 元記事の保存版（処理日の前後）の順に探す
  const candidates = async function* () {
    yield* articles;
    yield* fallbackArticles;
    for (const article of articles) yield* await archivedArticles(article);
  };
  for await (const article of candidates()) {
    const key = `${article.link}#${isCity(article.title) ? 'city' : 'gym'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const page = await readArticle(article.link, article.title);
    if (page.error) {
      if (articles.includes(article)) notes.push(page.error);
      else if (article.archived) notes.push('Wayback Machine の保存版を取得できなかった');
      continue;
    }
    const deck = page.decks.find((d) => d.deckId === deckId);
    if (!deck) {
      // デッキコードは本文にあるが、●付き小見出し・成績と対応づけられなかった（シティリーグの TOP4 以下など）
      if (page.html.includes(deckId)) {
        return { ...row, source: article.link, note: `元記事${article.archived ? '（Wayback Machine の保存版）' : ''}にデッキコードはあるが、●付き小見出しとの対応を読み取れなかった` };
      }
      continue;
    }
    if (deck.nameSource !== 'bullet') {
      const note =
        deck.nameSource === 'heading'
          ? `●付き小見出しがない（見出しは「${deck.archetype}」）`
          : '●付き小見出しがない（デッキ名が画像にしかない）';
      return { ...row, source: article.link, note: article.archived ? `${note}（Wayback Machine の保存版）` : note };
    }
    // 通称ルールに当てはまるデッキは、ルールの名前が正（枚数が少なく迷うもの・2つ以上のルールに当てはまるものは、ポケカブックの名前と比べる）
    const rule = matchDeckNameRule(recipe);
    const expected = rule && !rule.uncertain ? rule.name : deck.archetype;
    const exact = norm(column.deckName) === norm(expected);
    const base = norm(baseDeckName(column.deckName)) === norm(expected);
    return {
      ...row,
      sourceName: deck.archetype,
      source: article.link,
      status: exact || base ? STATUS.match : STATUS.mismatch,
      note: [
        article.archived ? 'Wayback Machine の保存版で確認' : '',
        expected !== deck.archetype ? `通称ルールにより「${expected}」が正` : '',
        rule?.conflict ? `通称ルール「${rule.rules.map((r) => r.name).join('」「')}」の両方に当てはまるため要確認` : '',
        rule?.uncertain && !rule.conflict ? `通称ルール「${rule.name}」に当てはまるか要確認（カードが少ない）` : '',
        !exact && base ? '付け足しは当サイトで付けた区別' : '',
        !exact && !base && withoutEx(baseDeckName(column.deckName)) === withoutEx(expected) ? '「ex」の有無だけが違う' : '',
      ]
        .filter(Boolean)
        .join(' / '),
    };
  }
  if (notes.length) return { ...row, note: [...new Set(notes)].join(' / ') };
  if (articles.length === 0) return { ...row, note: '元記事の記録がなく、いまの RSS の記事にもデッキコードが見つからない（手動で作成した記事など）' };
  const archived = (await Promise.all(articles.map(archivedArticles))).flat().length;
  return {
    ...row,
    source: articles[0].link,
    note: `元記事にデッキコードが見つからない（まとめ記事が更新され、掲載が消えた可能性。処理日前後の Wayback Machine の保存版 ${archived}件にもなし）`,
  };
}

/** Markdown の表のセル（| と改行をエスケープ） */
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function renderMarkdown(rows) {
  const count = (status) => rows.filter((r) => r.status === status).length;
  const table = (list) => [
    '| 今のデッキ名 | ポケカブックの名前 | 判定 | 記事のURL | 元記事 | メモ |',
    '| --- | --- | --- | --- | --- | --- |',
    ...list.map((r) => `| ${cell(r.deckName)} | ${cell(r.sourceName ?? '—')} | ${r.status} | ${r.url} | ${r.source ?? '—'} | ${cell(r.note)} |`),
  ];
  const section = (status, lead) => {
    const list = rows.filter((r) => r.status === status);
    return [`## ${status}（${list.length}件）`, '', ...(lead ? [lead, ''] : []), ...(list.length ? table(list) : ['なし']), ''];
  };
  return [
    `# デッキ名チェック結果（${todayJst()}）`,
    '',
    `公開済みのデッキ記事 ${rows.length}件のデッキ名を、ポケカブックのまとめ記事で公式デッキコードが一致するデッキの●付き小見出しの名前と比べました。`,
    '',
    `- ${STATUS.mismatch}: **${count(STATUS.mismatch)}件**`,
    `- ${STATUS.unknown}: ${count(STATUS.unknown)}件`,
    `- ${STATUS.match}: ${count(STATUS.match)}件`,
    '',
    '> このチェックでは記事を書き換えていません。不一致の記事を直す場合は、deck-columns.json の deckName・title・slug とページを合わせて直し、slug を変えるときは astro.config.mjs の redirects に旧URLを追加してください（別の PR で行います）。',
    '> 「付け足しは当サイトで付けた区別」は、以前に同名デッキを区別するために当サイトで付けていた「（〇〇採用型）」を外すと一致したものです（今は付け足しをしません。`npm run apply-name-rules` で外せます）。',
    '',
    ...section(STATUS.mismatch),
    ...section(STATUS.unknown, 'シティリーグなど、デッキ名が画像にしかない記事や、まとめ記事が更新されて元のデッキが見つからない記事です。元記事（画像を含む）を人が見て確認してください。'),
    ...section(STATUS.match),
    '---',
    '_scripts/check-deck-names.js（GitHub Actions: check-deck-names.yml）が作成しました_',
  ].join('\n');
}

async function main() {
  const columns = await readJson(path('src/data/deck-columns.json'), []);
  const officialDecks = await readJson(path('src/data/official-decks.json'), {});
  const processed = await readJson(path('scripts/cache/processed-decks.json'), { articles: [] });

  // 記録にない記事を探すための、いまの RSS に載っているまとめ記事
  const fallbackArticles = [];
  for (const { feed, title } of Object.values(FEEDS)) {
    if (!(await allowedByRobots(feed))) {
      console.warn(`robots.txt で取得が禁止されているため読みません: ${feed}`);
      continue;
    }
    try {
      fallbackArticles.push(...(await feedItems(feed)).filter((it) => title.test(it.title)));
    } catch (error) {
      console.warn(`RSS を取得できませんでした: ${feed}（${error.message}）`);
    }
  }
  // 記録の記事も、ほかのデッキの元記事の候補にする（同じまとめ記事に載っていることがあるため）
  for (const a of processed.articles) fallbackArticles.push({ link: a.link, title: a.title });

  const rows = [];
  for (const column of columns) {
    const deckId = officialDecks[column.deckKey]?.deckId ?? officialDecks[column.slug]?.deckId;
    const articles = processed.articles
      .filter((a) => a.columns.includes(column.slug) || (deckId && a.decks.includes(deckId)))
      .map((a) => ({ link: a.link, title: a.title, processedAt: a.processedAt }));
    const recipe = (officialDecks[column.deckKey] ?? officialDecks[column.slug])?.cards ?? [];
    const row = await checkColumn(column, deckId, articles, fallbackArticles, recipe);
    console.log(`${row.status}\t${row.deckName}\t${row.sourceName ?? '—'}\t${row.url}${row.note ? `\t${row.note}` : ''}`);
    rows.push(row);
  }

  // 不一致 → 確認できなかった → 一致 の順（表の中は deck-columns.json の並び順）
  const order = [STATUS.mismatch, STATUS.unknown, STATUS.match];
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  mkdirSync(path('.cache/'), { recursive: true });
  await writeFile(OUT_MD, `${renderMarkdown(rows)}\n`, 'utf8');
  await writeFile(OUT_JSON, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  const count = (status) => rows.filter((r) => r.status === status).length;
  console.log(`\n全${rows.length}件: 一致 ${count(STATUS.match)} / 不一致 ${count(STATUS.mismatch)} / 確認できなかった ${count(STATUS.unknown)}`);
  console.log('結果: .cache/deck-name-check.md / .cache/deck-name-check.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
