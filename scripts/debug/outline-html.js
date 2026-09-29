// まとめ記事の HTML の作りをログに出す（ポケカブックの読み取りの不具合調査用）
// 使い方: node scripts/debug/outline-html.js 記事.html
// ●付きのテキスト・見出し・デッキコードのリンクについて、祖先の要素（タグ.class）と、scripts/lib/pokecabook.js の読み取り結果を出す

import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { parseCityArticle, parseGymArticle } from '../lib/pokecabook.js';

const file = process.argv[2];
const html = readFileSync(file, 'utf8');
const $ = cheerio.load(html);

const label = (el) => `${el.name}${el.attribs?.id ? `#${el.attribs.id}` : ''}${el.attribs?.class ? `.${el.attribs.class.trim().split(/\s+/).join('.')}` : ''}`;
const path = (node) => {
  const chain = [];
  for (let el = node.type === 'tag' ? node : node.parent; el && el.type === 'tag'; el = el.parent) chain.unshift(label(el));
  return chain.join(' > ');
};

console.log(`\n===== ${file} =====`);
console.log('title:', $('title').text().trim());
console.log('.entry-content:', $('.entry-content').length, '/ article:', $('article').length, '/ main:', $('main').length);
for (const sel of ['.post_content', '.entry-body', '.article-body', '.p-entry__body', '.single-content', '.l-mainContent', '.c-postContent']) {
  if ($(sel).length) console.log(`${sel}:`, $(sel).length);
}

console.log('\n--- headings ---');
$('h1,h2,h3,h4,h5,h6').each((_, el) => console.log(`${path(el)} | ${$(el).text().trim().replace(/\s+/g, ' ').slice(0, 60)}`));

console.log('\n--- text with ● ---');
const walk = (node) => {
  if (node.type === 'text' && /[●⚫⬤•]/.test(node.data)) console.log(`${path(node)} | ${JSON.stringify(node.data.trim().slice(0, 60))}`);
  for (const c of node.children ?? []) walk(c);
};
walk($.root().get(0));

console.log('\n--- deck links ---');
$('a[href*="deckID"], a[href*="deck/"]').each((_, el) => console.log(`${path(el)} | ${$(el).attr('href')} | ${JSON.stringify($(el).text().trim().slice(0, 40))}`));

console.log('\n--- raw HTML around the first ● (400 chars) ---');
const i = html.indexOf('●');
console.log(i < 0 ? '(no ●)' : html.slice(Math.max(0, i - 300), i + 100));

console.log('\n--- parse result ---');
console.log('gym:', JSON.stringify(parseGymArticle(html)));
console.log('city:', JSON.stringify(parseCityArticle(html, $('title').text())));
