# CLAUDE.md — ポケカファクトリー（ポケトリー）

このファイルは Claude Code が作業開始時に必ず読む前提知識です。
仕様が変わったら、このファイルと README.md も同じPRで更新してください。

## 1. サイトの目的
- 競技プレイヤー向けの「デッキ研究＆パーツ最安調達」サイト（本番: https://www.pokeca-factory.com/）
- 価値の中心は「優勝デッキが60枚いくらで組めるか」と「最安ショップへの導線」
- 扱うのは現行スタンダードのみ。レアリティ相場・投資・PSA価値は扱わない

## 2. 技術構成
- Astro + Tailwind CSS（`@tailwindcss/vite`）、`@astrojs/sitemap`、`trailingSlash: 'always'`
- ホスティング: Vercel（main への push で本番デプロイ）
- 主要ファイル
  - `src/consts.ts` … サイト設定、`STANDARD_REGULATIONS`・`STANDARD_EXEMPT_NAMES`、`priceNotice`
  - `src/data/cards.json` … カードDB（ビルド時に型チェック）
  - `src/data/deck-columns.json` … デッキ記事の一覧情報
  - `src/data/official-decks.json` … 60枚レシピ
  - `src/pages/columns/{slug}.astro` ＋ `src/layouts/DeckColumn.astro` … デッキ解説
  - `src/content/blog/` … コラム記事（Markdown）
  - `scripts/lib/official.js` の `SET_MARKS` … 弾ごとのレギュレーションマーク
  - `scripts/lib/deck-variant.js` … 同名デッキの型名付け
  - `scripts/cache/processed-decks.json` … 処理済みの記事・デッキ
  - `.cache/` … スクレイピング結果のキャッシュ（Git 管理外）
- 主要コマンド
  - `npm run dev` / `npm run build` / `npm run preview` / `npx astro check`
  - `npm run update-prices`（`--ids=` `--budget=秒` `--dry-run`。GitHub Actions では `--budget=600`）
  - `npm run add-cards`（`--dry-run`）/ `npm run sync-trending`（`--dry-run`）
  - `npm run import-decks -- --deck=スラッグ:公式デッキコード`
  - `npm run auto-decks`（ジムバトル）/ `npm run auto-city`（シティリーグ）。いずれも `--dry-run` あり
  - `npm run backfill-plans`（既存記事に立ち回りを追記。`--dry-run` `--force`）
- 定期実行: `.github/workflows/` 配下（`update-prices.yml`、`sync-trending.yml`、`auto-deck-sync.yml` ほか）
  - 実行時刻は各 yml の cron が正。README と食い違っていたら README を直す

## 3. Git のルール（最重要）
- **Claude Code は main へ直接 push しない。** 作業ブランチを作り、PR を作成して終了する
  - 例外は GitHub Actions による次の自動コミットのみ
    - 価格データの更新（`update-prices.yml`：`cards.json` の価格・画像更新）
    - sync-trending による新規カード追加（`sync-trending.yml`：ビルド検証済みのもの）
  - 記事・デッキ名・コード・デザインの変更は、自動生成でも必ず PR を経由する
- ブランチ名: `feat/…` `fix/…` `perf/…` `content/…`
- コミットメッセージ: `feat:` `fix:` `perf:` `content:` `docs:` `chore:` の接頭辞＋日本語の要約
- PR の説明には「変更内容」「確認したこと」「人が確認すべき点」を書く
- マージは人が Vercel のプレビューを確認してから行う

## 4. 作業完了の条件
- `npx astro check` と `npm run build` がエラーなく通る
- データ取得系スクリプトを変更した場合は `--dry-run` で結果を確認し、PR に要約を貼る
- UI を変更した場合は、ジムバトル・シティリーグ両方の該当ページで表示を確認する

## 5. データのルール
- 掲載できるのは `STANDARD_REGULATIONS`（現在 H・I・J）と `STANDARD_EXEMPT_NAMES`（ハイパーボール・ボスの指令などの公式例外）のカードのみ。範囲外が含まれるとビルドが失敗する
  - `regulationMark` は弾ではなくカード左下の印刷マークで判定する（再録で元のマークのままの場合あり）
  - スタン落ち時は、両定数の更新・範囲外カードの削除・`astro.config.mjs` の `redirects` への旧URL追加をセットで行う
- カードのURL（id）を変える場合は、必ず `redirects` に旧URL → 新URLを追加する
- デッキ名は収集元の簡易表記をそのまま使わず、構成から正しいアーキタイプ名に補正する
  （例: 「カジッチュ」→「カミッチュ（おまつりおんど）」）
  - タイトル・スラッグ・`deck-columns.json` の表記を必ず一致させる
  - 判定に自信がない場合は PR の「人が確認すべき点」に明記する
- 立ち回りデータは `deck-columns.json` の `gamePlan` に `early` / `mid` / `end` の構造で保存する（ジムバトル・シティ共通）
- 収集元（ポケカブック等）の記事本文やレシピ画像を転載しない。保存するのは事実データ（日付・店舗・順位・デッキコード）とリンクのみ。プレイヤー名は保存しない
- 収集元へのリクエストは1.5秒以上あけ、robots.txt を守る

## 6. 記事・紹介文の品質基準
自動生成する文章は、Google の「大量生成された低品質コンテンツ」とみなされないことを最優先にする。

- デッキごとに、そのデッキ固有の勝ち筋（キーとなる特性・ワザ・コンボ・ダメージ計算）を必ず1つ以上具体的に書く
- デッキ名とカード名を入れ替えるだけで他のデッキにも使える文は不可
- 次のような定型文は使わない
  - 「〇〇・〇〇を採用した〇〇デッキ。主力カードの効果と最安値をまとめて確認」
- カードの効果・HP・ダメージは、公式テキスト（取得済みデータ）に基づいて書く。推測で書かない
- 生成後、同じ一覧に並ぶ記事同士で書き出しや構成が重複していないか確認する
- 解説が生成できなかった記事は TODO のまま残し、PR で報告する（中身のない文で埋めない）

## 7. デザインのルール（ホワイトラボ）
- 白基調＋微細な方眼グリッド。見出しは「M PLUS Rounded 1c」＋グラデーション
- ボタン色: 一括購入・パーツ調達＝レッド（#DC2626系）/ 買取・相場＝グリーン（#16A34A系）/ 価格比較・データ＝ローズ系
- デッキカード: メインカード1枚を `aspect-[63/88] object-cover` で表示。空のサブカード枠を作らない
- 立ち回り: 丸数字バッジ付きステップカード（1.序盤＝`bg-emerald-600` / 2.中盤＝`bg-amber-500` / 3.終盤＝`bg-red-600`）
- 本文中の主要カード名は、青文字下線の個別カードページへのリンクにする

## 8. 外部APIとセキュリティ
- 楽天・Yahoo!ショッピングAPIへのリクエスト間は 1〜2 秒待つ。価格更新は安全バジェット（`--budget=600`＝最大600秒。`update-prices.yml` で1日2回、日本時間 4:07・16:07 に実行）を守る
- APIキー（`RAKUTEN_APP_ID`・`RAKUTEN_ACCESS_KEY`・`YAHOO_APP_ID` など）は GitHub Secrets と `.env` のみ。コード・ログ・PR 本文に出力しない
- リポジトリは Public。秘密情報をコミットしていないか、push 前に必ず確認する
- アフィリエイト設定（もしもアフィリエイトのID）は変更しない

## 9. 迷ったとき
- 仕様にない判断が必要な場合は、実装を止めて PR か出力で質問を明記する
- 大量のファイル・記事を一括で書き換える作業は、先に対象件数と数件のサンプルを出して確認を取る
