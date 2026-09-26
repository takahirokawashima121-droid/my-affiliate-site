# ポケカ価格ナビ

中古ポケモンカードの販売最安値・買取最高値を比較できる、Astro + Tailwind CSS 製の静的サイトです。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー起動（http://localhost:4321） |
| `npm run build` | 本番ビルド（`dist/` に出力） |
| `npm run preview` | ビルド結果をローカルで確認 |
| `npx astro check` | 型チェック |

## 最初にやること

1. `astro.config.mjs` の `site` が本番URLになっているか確認（現在: https://my-affiliate-site-phi.vercel.app/）
2. `src/consts.ts` でサイト名・説明文・運営者名・連絡先（`contactEmail`）を確認
3. `public/og-default.png`（1200×630）を置く（SNSシェア時の画像）
4. `src/pages/about.astro`（運営者情報）と `src/pages/privacy.md` の内容を確認

## カードデータの更新

`src/data/cards.json` を編集します。ビルド時に型チェックされ、項目の不足や型の誤りがあるとエラーになります。

| 項目 | 内容 |
| --- | --- |
| `id` | 一意なID（半角英数字・ハイフン） |
| `name` | カードの正式名称（例: `ナンジャモ`、`リーリエの全力`）。「（SA）」などの表記は含めない |
| `rarity` | レアリティ（例: `SAR`、`SR`） |
| `cardNumber` | カード番号（例: `096/071`） |
| `expansionCode` | 収録弾の略称記号（例: `SV2D`、`SM4+`） |
| `imageUrl` | 画像URL（`public/` 配下のパスも可。空なら仮画像を表示） |
| `salePrice` / `saleShop` / `saleUrl` | 販売最安値（円）/ ショップ名 / アフィリエイトURL |
| `buybackPrice` / `buybackShop` / `buybackUrl` | 買取最高値（円）/ ショップ名 / アフィリエイトURL |
| `updatedAt` | 更新日時（例: `2026-09-26T10:00:00+09:00`）。「新着順」の並び替えに使用 |

画面上の表記は「ナンジャモ SAR [SV2D 096/071]」、楽天API・モール検索のキーワードは「ナンジャモ SAR 096/071 ポケカ」の形式で自動生成されます（`src/utils/cardFormat.ts`）。

販売価格は `npm run update-prices` で楽天市場の最安値に更新できます（`.env` に `RAKUTEN_APP_ID` と `RAKUTEN_ACCESS_KEY` が必要）。買取価格は現在サンプルデータです。実データに差し替えたら `src/consts.ts` の `sampleData` を `false` にしてください（トップの注意書きが消えます）。

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
