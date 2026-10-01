// ポケカブックのまとめ記事・RSS の読み取り（●付き小見出しのデッキ名と公式デッキコードの対応）
// scripts/auto-deck-updater.js（記事の自動生成）と scripts/check-deck-names.js（公開済み記事のデッキ名の照合）から使う

import * as cheerio from 'cheerio';
import { fetchText, norm } from './official.js';

/** まとめ記事の RSS と、対象にする記事タイトル（デッキタイプ別のまとめ記事は過去の環境のデッキを含むため対象外） */
export const FEEDS = {
  gym: { feed: 'https://pokecabook.com/archives/category/deck-recipe/feed', title: /ジムバトル優勝デッキまとめ/ },
  city: { feed: 'https://pokecabook.com/archives/category/tournament/city-league/feed', title: /シティリーグ.*デッキまとめ/ },
};

/**
 * ジムバトルで今回見る記事（新しい順に最大 max 件）。処理済みの記事に着いたら、その記事までで止める。
 * まとめ記事は同じ URL・同じタイトル（「【9/28(月)～10/4(日)】…」のような1週間分）のまま毎日デッキが追記されるため、
 * いちばん新しい処理済みの記事も見直し、新しいデッキかどうかはデッキコードで判定する
 */
export function gymFreshItems(items, isDone, max) {
  const firstDone = items.findIndex(isDone);
  return items.slice(0, Math.min(firstDone === -1 ? items.length : firstDone + 1, max));
}

/** 「9/27」→ 月日の比較用の数値（927） */
export const dateKey = (date) => (date ? date.split('/').map(Number).reduce((m, d) => m * 100 + d) : 0);

/**
 * ジムバトルの候補の並び順: 記事のないデッキ名の1つ目 → 記事のあるデッキ名の1つ目 → 同じデッキ名の2つ目以降（別構築）。
 * 同じ条件なら新しい日付が先（同じデッキ名が複数あるときは、いちばん新しい日付のものを1つ目にする）。同じ日付なら記事の掲載順
 */
export function orderGymDecks(decks, hasArticle) {
  const occurrence = new Map();
  const rank = (d) => d.nth * 2 + Number(hasArticle(d.archetype));
  return [...decks]
    .sort((a, b) => dateKey(b.date) - dateKey(a.date))
    .map((d) => {
      const nth = occurrence.get(norm(d.archetype)) ?? 0;
      occurrence.set(norm(d.archetype), nth + 1);
      return { ...d, nth };
    })
    .sort((a, b) => rank(a) - rank(b));
}

/** シティリーグで記事にする成績（上位入賞のみ。並び順が優先順） */
export const CITY_RANKS = ['優勝', '準優勝'];

/** RSS の記事一覧 */
export async function feedItems(feedUrl) {
  const $ = cheerio.load(await fetchText(feedUrl), { xmlMode: true });
  return $('item')
    .map((_, it) => ({ title: $(it).find('title').first().text().trim(), link: $(it).find('link').first().text().trim(), pubDate: $(it).find('pubDate').text().trim() }))
    .get();
}

/**
 * 見出し・デッキ名が「9/28【月】ジムバトル優勝」のような日付・大会名になっていないか
 * （まとめ記事の見出しが日付のときにデッキ名として使ってしまい、タイトルが「【9/28 ジムバトル優勝】9/28【月】ジムバトル優勝（〇〇採用型）」になったため）
 */
export const isDeckName = (text) => Boolean(text) && !/\d{1,2}\/\d{1,2}|【[月火水木金土日]】|ジムバトル|シティリーグ|優勝|入賞|まとめ/.test(text);

/**
 * 「●スッカラカン」→「スッカラカン」。ポケカブックのまとめ記事は、日付の見出しの下に●付きの小見出しでデッキ名を書いている。
 * デッキ名として使えない●行（日付・大会名・「●大会結果」のような項目名）は null
 */
export function bulletName(text) {
  // 表記はポケカブックのまま使う（NFKC で全角の（）を半角にしない）
  const name = text.trim().match(/^●\s*([^\n]+)/)?.[1].trim().replace(/デッキ$/, '');
  if (!name || name.length > 30 || !isDeckName(name) || /[:：]|レシピ|結果|さん$/.test(name)) return null;
  return name;
}

/**
 * 小見出し（h3〜h6）の文字からデッキ名を取り出す。ポケカブックの小見出しの「●」はテーマの装飾で表示されるため、文字に●がないときも●付きとして読む。
 * デッキ名として使えない小見出し（日付・大会名・「大会結果」など）は null
 */
export function headingName(text) {
  const t = text.trim();
  return bulletName(t.normalize('NFKC').startsWith('●') ? t : `●${t}`);
}

/** root の中のノード（要素・テキスト）を文書の順にたどる。visit が false を返したら、その要素の中は見ない */
function eachInOrder(root, visit) {
  const go = (node) => {
    if (visit(node) === false) return;
    for (const child of node.children ?? []) go(child);
  };
  for (const child of root?.children ?? []) go(child);
}

/**
 * ●付きの小見出しを文書の順に追う。見出しの中で「●」と名前が別の要素に分かれている場合（<span>●</span>スッカラカン）にも対応する。
 * text(node) が true を返したら、そのテキストは●行として処理済み
 */
function bulletTracker() {
  let pending = false;
  const state = { name: null };
  state.text = (node) => {
    const t = node.data.trim();
    if (!t) return false;
    if (pending) {
      pending = false;
      state.name = bulletName(`●${t}`);
      return true;
    }
    if (t === '●') return (pending = true);
    if (!t.startsWith('●')) return false;
    state.name = bulletName(t);
    return true;
  };
  return state;
}

const DECK_ID = /https:\/\/www\.pokemon-card\.com\/deck\/(?:result|confirm)\.html\/deckID\/([A-Za-z0-9-]+)/;

/**
 * ジムバトルのまとめ記事から、デッキごとの公式デッキコードを取り出す。
 * 記事の構成（2026年9月の実際の HTML）: 日付の見出し（<h2>9/28【月】ジムバトル優勝</h2>）→ デッキ名の小見出し（<h4>スッカラカン</h4>）→
 * 画像の figcaption に公式デッキコードのリンク（リンクの文字は「9/28【月】ジムバトル優勝」）。
 * ページに表示される小見出しの「●」はテーマ（Cocoon）の装飾（CSS）で表示されていて、HTML の文字には含まれない（CSS にも「●」の文字はない）。
 * そのため、日付の見出しの下の h3〜h6 の小見出しを「●付き小見出し」として扱う（文字に●が含まれる古い形式・<span>●</span> の形式にも対応）。
 * 小見出し1つにつき、すぐ後のデッキ1つだけに使う（小見出しのないデッキに前のデッキの名前を付けないため）。
 * デッキ名は●付きの小見出しを正とする（nameSource: 'bullet'）。小見出しがなく h2 がデッキ名のとき（古い形式の記事）は h2 を使う（'heading'）。
 * どちらもないときは archetype を null にし、あとでレシピから推定する（inferArchetype）
 */
export function parseGymArticle(html) {
  const $ = cheerio.load(html);
  const decks = [];
  let heading = null;
  let headingDate = null;
  let inSection = false; // 最初の h2 より前（前書き）のリンクは読まない
  const bullet = bulletTracker();
  eachInOrder($('.entry-content').get(0), (node) => {
    if (node.type === 'text') return void bullet.text(node);
    if (node.type !== 'tag') return;
    if (node.name === 'h2') {
      const text = $(node).text().trim();
      inSection = true;
      bullet.name = null;
      if (text.normalize('NFKC').startsWith('●')) {
        bullet.name = bulletName(text);
        return false;
      }
      heading = isDeckName(text) ? text : null;
      headingDate = text.match(/(\d{1,2}\/\d{1,2})/)?.[1] ?? null;
      return false;
    }
    if (/^h[3-6]$/.test(node.name)) {
      // ●はテーマの装飾で表示されるため、文字に●がなくても小見出しの名前をデッキ名にする（前書きの小見出しは使わない）
      if (inSection) bullet.name = headingName($(node).text());
      return false;
    }
    if (node.name !== 'a') return;
    const deckId = ($(node).attr('href') ?? '').match(DECK_ID)?.[1];
    if (!deckId || !inSection || decks.some((d) => d.deckId === deckId)) return false;
    const text = $(node).text();
    const date = text.match(/(\d{1,2}\/\d{1,2})/)?.[1] ?? headingDate;
    // 成績はリンクの文字（「9/27【日】ジムバトル優勝」など）から読む。文字に成績がなければ null（記事では優勝として扱い、PR に「取得できず」と出す）
    const rank = /準優勝/.test(text) ? '準優勝' : /優勝/.test(text) ? '優勝' : null;
    const name = bulletName(text) ?? bullet.name;
    bullet.name = null;
    // venueNo: 記事の中で何会場目か（ジムバトルはデッキ1つが1会場の大会。PR で元記事と見比べるため）
    decks.push({ deckId, archetype: name ?? heading, nameSource: name ? 'bullet' : heading ? 'heading' : null, date, rank, venueNo: decks.length + 1 });
    return false;
  });
  return decks;
}

/**
 * シティリーグのまとめ記事から、会場ごとの入賞デッキ（CITY_RANKS の成績のみ）を取り出す。
 * 記事の構成: 日付の見出し（「シティリーグ9/28【月】」。1日だけの記事はタイトルの日付）→ 会場の見出し（h2 / h4）→
 * 「大会結果」→ 成績ごとの画像（figcaption のリンク文字が「優勝」「準優勝」「TOP4」…、リンク先が公式デッキコード）。
 * デッキ名は画像にしか載っていないことが多い。画像の前に●付きの小見出しでデッキ名が書かれていれば、それを正とする
 * （●1つにつきすぐ後のデッキ1つだけに使う。会場の見出しでリセット）。なければ archetype を null にし、あとでレシピから推定する。
 * venueNo は記事の中で何会場目か（会場の見出しを上から数える。結果の画像がない会場も数える）
 */
export function parseCityArticle(html, title) {
  const $ = cheerio.load(html);
  let date = title.match(/(\d{1,2}\/\d{1,2})/)?.[1];
  let venue = null;
  let venueNo = 0; // 何会場目か（記事の中の会場の見出しを上から数える）
  const decks = [];
  const bullet = bulletTracker();
  eachInOrder($('.entry-content').get(0), (node) => {
    if (node.type === 'text') return void bullet.text(node);
    if (node.type !== 'tag') return;
    if (/^h[2-4]$/.test(node.name)) {
      const text = $(node).text().trim();
      if (text.normalize('NFKC').startsWith('●')) {
        bullet.name = bulletName(text);
        return false;
      }
      const headingDate = text.match(/シティリーグ\s*(\d{1,2}\/\d{1,2})/)?.[1];
      if (headingDate) [date, venue] = [headingDate, null];
      else [venue, venueNo] = [text, venueNo + 1];
      bullet.name = null;
      return false;
    }
    if (node.name !== 'a' || !venue || $(node).closest('figcaption').length === 0) return;
    const deckId = ($(node).attr('href') ?? '').match(/deckID\/([A-Za-z0-9-]+)/)?.[1];
    const rank = $(node).text().normalize('NFKC').replace(/\s+/g, '').toUpperCase();
    if (deckId && CITY_RANKS.includes(rank) && !decks.some((d) => d.deckId === deckId)) {
      decks.push({ deckId, archetype: bullet.name, nameSource: bullet.name ? 'bullet' : null, date, rank, venue, venueNo });
    }
    bullet.name = null;
    return false;
  });
  return decks;
}

/** ジムバトルのまとめ記事を取得して parseGymArticle で読む */
export const articleDecks = async (url) => parseGymArticle(await fetchText(url));

/** シティリーグのまとめ記事を取得して parseCityArticle で読む */
export const cityArticleDecks = async (url, title) => parseCityArticle(await fetchText(url), title);
