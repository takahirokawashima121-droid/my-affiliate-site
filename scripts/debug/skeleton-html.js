// まとめ記事の HTML から、テスト用の「骨組み」だけを取り出す（ポケカブックの読み取りの不具合調査用）
// 使い方: node scripts/debug/skeleton-html.js 記事.html > 骨組み.html
// 残すのは .entry-content のタグ・class の構造、見出しの文字（日付・会場・デッキ名）、デッキコードのリンクと成績の文字のみ。
// 記事本文・画像の URL・プレイヤー名は残さない（収集元の記事本文を転載しないため）

import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';

const $ = cheerio.load(readFileSync(process.argv[2], 'utf8'));
const content = $('.entry-content').first();
content.find('script, style, noscript, iframe, ins, .toc, #toc').remove();

const keepText = (node) => {
  for (let el = node.parent; el && el.type === 'tag'; el = el.parent) {
    if (/^h[1-6]$/.test(el.name)) return true;
    if (el.name === 'a' && /deckID/.test(el.attribs?.href ?? '')) return true;
  }
  return false;
};
const clean = (node) => {
  for (const child of [...(node.children ?? [])]) {
    if (child.type === 'comment') $(child).remove();
    else if (child.type === 'text') {
      if (child.data.trim() && !keepText(child)) child.data = '…';
    } else if (child.type === 'tag') {
      for (const name of Object.keys(child.attribs)) {
        if (name === 'class' || (name === 'href' && /deckID/.test(child.attribs.href))) continue;
        delete child.attribs[name];
      }
      clean(child);
    }
  }
};
clean(content.get(0));

const title = $('h1.entry-title').first().text().trim() || $('title').text().trim();
const article = $('article').first();
console.log(
  `<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title></head>\n<body class="${$('body').attr('class') ?? ''}">\n<article class="${article.attr('class') ?? ''}">\n<h1 class="entry-title">${title}</h1>\n<div class="${content.attr('class')}">${content.html()}</div>\n</article>\n</body></html>`,
);
