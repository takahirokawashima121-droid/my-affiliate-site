# ポケカ相場比較ナビ

中古ポケモンカードの販売最安値・買取最高値を比較できる、Astro + Tailwind CSS 製の静的サイトです。

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

## カードデータの更新

`src/data/cards.json` を編集します。ビルド時に型チェックされ、項目の不足や型の誤りがあるとエラーになります。

| 項目 | 内容 |
| --- | --- |
| `id` | 一意なID（半角英数字・ハイフン） |
| `name` / `modelNumber` / `rarity` | カード名 / 型番 / レアリティ |
| `imageUrl` | 画像URL（`public/` 配下のパスも可。空なら仮画像を表示） |
| `salePrice` / `saleShop` / `saleUrl` | 販売最安値（円）/ ショップ名 / アフィリエイトURL |
| `buybackPrice` / `buybackShop` / `buybackUrl` | 買取最高値（円）/ ショップ名 / アフィリエイトURL |
| `updatedAt` | 更新日時（例: `2026-09-26T10:00:00+09:00`）。「新着順」の並び替えに使用 |

現在はサンプルデータです。実データに差し替えたら `src/consts.ts` の `sampleData` を `false` にしてください（トップの注意書きが消えます）。

## コラム記事の追加

`src/content/blog/` に `.md` ファイルを追加するだけです。書き方は `src/content/blog/how-to-write-post.md` を参照してください。

## フォルダ構成

```
src/
├── data/cards.json   # カード価格データ
├── content/blog/     # コラム記事（Markdown）
├── content.config.ts # フロントマターのスキーマ
├── components/       # ヘッダー・カード・パンくず等
├── layouts/          # ページレイアウト
├── pages/            # ルーティング
├── styles/global.css # Tailwind 設定
└── consts.ts         # サイト設定
```

## デプロイ

Cloudflare Pages / Netlify / Vercel などで、ビルドコマンド `npm run build`、出力ディレクトリ `dist` を指定してください。
