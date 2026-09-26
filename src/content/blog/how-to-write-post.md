---
title: このブログへの記事の追加方法（Markdownの書き方ガイド）
description: src/content/blog にMarkdownファイルを置くだけで記事を追加できます。フロントマターの項目やアフィリエイトリンクの書き方を解説します。
pubDate: 2026-09-26
tags: [使い方]
affiliate: false
draft: true
---

## 記事ファイルを作る

`src/content/blog/` に `記事のURLにしたい名前.md` を作成します。ファイル名がそのままURL（`/blog/ファイル名/`）になるので、**半角英数字とハイフン**がおすすめです。

## フロントマター

ファイル先頭に次のように書きます。

```yaml
---
title: 記事タイトル（32文字前後が目安）
description: 検索結果に表示される説明文（120文字前後が目安）
pubDate: 2026-09-26
updatedDate: 2026-10-01   # 任意：更新日
heroImage: /images/sample.jpg  # 任意：public/ に置いた画像
tags: [ガジェット, レビュー]
draft: false      # true にすると本番ビルドで非公開
affiliate: true   # true で記事冒頭に「PR」表記を表示
---
```

## アフィリエイトリンクの書き方

Markdown内にHTMLをそのまま書けます。`rel="sponsored nofollow"` を付けるのがGoogle推奨です。

```html
<a class="btn-affiliate" href="https://..." target="_blank" rel="sponsored nofollow noopener">Amazonで見る</a>
```

ASPから発行された広告タグ（もしもアフィリエイトのかんたんリンク等）も、そのまま貼り付けて使えます。

## 目次について

`##` 見出しが3つ以上ある記事には、目次が自動で表示されます。
