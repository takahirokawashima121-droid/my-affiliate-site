# My Affiliate Blog

Astro + Tailwind CSS で作った、アフィリエイト向けの高速な静的ブログです。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー起動（http://localhost:4321） |
| `npm run build` | 本番ビルド（`dist/` に出力） |
| `npm run preview` | ビルド結果をローカルで確認 |
| `npx astro check` | 型チェック |

## 最初にやること

1. `astro.config.mjs` の `site` を本番URLに変更
2. `src/consts.ts` でサイト名・説明文・運営者名を変更
3. `public/og-default.png`（1200×630）を置く（SNSシェア時の画像）
4. `src/pages/about.md` と `src/pages/privacy.md` を自分用に書き換え

## 記事の追加

`src/content/blog/` に `.md` ファイルを追加するだけです。書き方は `src/content/blog/how-to-write-post.md` を参照してください。

## フォルダ構成

```
src/
├── content/blog/     # 記事（Markdown）
├── content.config.ts # フロントマターのスキーマ
├── components/       # ヘッダー・カード・パンくず等
├── layouts/          # ページレイアウト
├── pages/            # ルーティング
├── styles/global.css # Tailwind 設定
└── consts.ts         # サイト設定
```

## デプロイ

Cloudflare Pages / Netlify / Vercel などで、ビルドコマンド `npm run build`、出力ディレクトリ `dist` を指定してください。
