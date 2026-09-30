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
  - `scripts/lib/deck-name-rules.js` … デッキ名の言い換え表（`DECK_NAME_RULES`。ポケカブックの名前より優先）
  - `scripts/lib/pokecabook.js` … ポケカブックのまとめ記事・RSS の読み取り（●付き小見出しとデッキコードの対応）。テストは `scripts/test/`（実際の記事の HTML の骨組みを使う）
  - `scripts/lib/highlight.js` … デッキ記事の見どころ（`highlight`。一覧・トップの特集・X投稿文に使う）を公式のカードテキストから作る。決まった文の禁止リスト（`BANNED_PHRASES`）と、同じ日の記事の書き出しの点検もここ
  - `scripts/cache/processed-decks.json` … 処理済みの記事・デッキ
  - `public/og-default.png` … 個別の画像がないページの OG 画像（1200×630）。元は `scripts/assets/og-default.html` で、`node scripts/render-og-image.js` で作り直す（手順は README の「OG画像」）
  - `public/generate-assets.html` … X のアイコン・プロフィールのヘッダー（1500×500）・サイト紹介バナー（1200×675）の描画と保存（デザインはサイト・OG画像に合わせた白基調）。`node scripts/render-x-assets.js` でフォントを確認してから PNG に書き出せる（手順は README の「X（旧Twitter）用の画像」）
  - `.cache/` … スクレイピング結果のキャッシュ（Git 管理外）
- 主要コマンド
  - `npm run dev` / `npm run build` / `npm run preview` / `npx astro check`
  - `npm run update-prices`（`--ids=` `--budget=秒` `--dry-run`。GitHub Actions では `--budget=600`）
  - `npm run add-cards`（`--dry-run`）/ `npm run sync-trending`（`--dry-run`）
  - `npm run import-decks -- --deck=スラッグ:公式デッキコード`
  - `npm run auto-decks`（ジムバトル）/ `npm run auto-city`（シティリーグ）。いずれも `--dry-run` あり
  - `npm run backfill-plans`（既存記事に立ち回りを追記。`--dry-run` `--force`）
  - `npm test`（`scripts/lib/pokecabook.js` の読み取り、`scripts/lib/deck-name-rules.js` の言い換えルール、`scripts/lib/highlight.js` の見どころの自動生成のテスト。どれかを変更したら必ず実行する）
  - `npm run rewrite-highlights`（決まった文のままの見どころを書き直す。`--dry-run` あり）/ `npm run check-highlights`（点検だけ）
  - `npm run apply-name-rules`（言い換えルールを既存の記事に当てはめる。`--dry-run` あり。URL は変えない）
  - `npm run check-deck-names`（公開済み記事のデッキ名とポケカブックの●付き小見出しを照合。記事は書き換えない。GitHub Actions の `check-deck-names.yml` を手動実行すると結果が Issue になる）
- 定期実行: `.github/workflows/` 配下（`update-prices.yml`、`sync-trending.yml`、`auto-deck-sync.yml` ほか）
  - `fetch-pokecabook-html.yml`（手動実行のみ）… ポケカブックの記事の HTML を Artifacts に保存し、構造と骨組みをログに出す。この環境からポケカブックにアクセスできないときの調査用
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
  - レギュ落ち時は、両定数の更新・範囲外カードの削除・`astro.config.mjs` の `redirects` への旧URL追加をセットで行う
- カードのURL（id）を変える場合は、必ず `redirects` に旧URL → 新URLを追加する
- デッキ名は**ポケカブックのまとめ記事の●付き小見出しの名前を正とする**（例: 「●スッカラカン」「●ボムファイアロー」「●ケンタロス」）
  - ただし、次の**言い換えルールに当てはまるデッキは、ルールの名前を優先する**（●付き小見出しから名前が取れた場合も、推定した場合も）
    - ヤドキングが採用されている → 「ひらめきチャレンジ」
    - カミッチュが採用されていて、カミツオロチexが採用されていない → 「おまつりおんど」（「カミッチュ（おまつりおんど）」とは書かない）
    - 同じ名前のデッキが複数あるときは、これまでどおり「（〇〇採用型）」を付けて区別する（例: おまつりおんど（スイレンのお世話採用型））。そのデッキにしか入っていないカードがなく、既存の同名デッキと大きな差がないときは「（別構築型）」などを付けず、そのままの名前にする
    - ルールの本体は `scripts/lib/deck-name-rules.js` の `DECK_NAME_RULES`（言い換え表）。追加するときは表に1行足し、`scripts/lib/english-name.js` の `DECK_NAMES` に英語表記を追記し、`npm run apply-name-rules` で既存の記事にも当てはめ、このリストも更新する
    - ヤドキングが1枚だけなど、ルールのカードが少なく迷うデッキ（`minQty` 未満）は自動では言い換えない。PR の「人が確認すべき点」に一覧で書き、人に確認する
  - ●はテーマの装飾で表示されていて HTML の文字には含まれない（実際の HTML は `<h2>9/28【月】ジムバトル優勝</h2>` → `<h4><span>スッカラカン</span></h4>` → 画像の figcaption にデッキコードのリンク）
  - 日付の見出し（「9/28【月】ジムバトル優勝」など）はデッキ名に使わない
  - ●付き小見出しの名前が取れないとき（シティリーグのように画像にしか名前がない場合など）だけ、60枚の構成から推定し、PR に「推定」と明記する。推定では進化前のポケモン名などをそのまま使わず、正しいアーキタイプ名に補正する（例: 「カジッチュ」→「おまつりおんど」）
  - タイトル・スラッグ・`deck-columns.json` の表記を必ず一致させる
  - スラッグはデッキ名の英語表記にする（例: `tauros-deck-0928`・`bomb-talonflame-deck-0928`・ひらめきチャレンジ＝`seek-inspiration-deck-0929`・おまつりおんど＝`dipplin-festival-lead-deck-0927`。`scripts/lib/english-name.js`）。ローマ字の読み仮名は使わない
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
- 見どころ（`highlight`）は `scripts/lib/highlight.js` が、主役の特性・ワザ（名前・ダメージ・効果）と、主役と組み合わせて使うカードの効果を、公式のカードテキストの文のまま組み立てる。`BANNED_PHRASES` の決まった文や、同じ日の記事と書き出しがそっくりなもの（カード名・「」の中・数字を伏せた骨組みで比較）は、自動生成の PR の「紹介文の確認すべき点」に出る。X投稿文は見どころを文の区切りで詰めて使う
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
- トレトク（A8.net・宅配買取）の案内は `src/components/ToretokuNotice.astro` だけで出す（リンクと計測画像はセットで、コードは `src/config/affiliate.ts` の `SHOPS.toretoku`）
  - 置き場所: デッキ記事の最後・レギュ落ちを説明する記事（frontmatter `regulationBuyback: true`）・カードページ（価格比較・買取目安の欄とは別の場所に小さく）
  - ほかのショップと並べたり比べたりしない（価格比較の表・買取目安の欄・`BuybackOptions` に入れない）。書くのは事実（送料・手数料無料／無料の宅配キット／スリーブやファイルのまま送れる／まとめて買取）だけで、「高価買取」などの言いすぎ・体験談風の文は使わない。案内のすぐ近くに「PR」を出す
- カーナベル（カードごとの買取リンク）は A8.net の案内でポケカの成果が 2026/05/13 から発生しないため、`src/config/affiliate.ts` の `SHOPS.kanabell.enabled = false` で止めている。止めている間はリンク・計測画像を出さず、買取ボタンは古本市場（ふるいち）に向ける。`cards.json` の `buybackShop`・`buybackUrl`・`buybackImpressionUrl` は消さない（`true` に戻せば元の表示になる。`scripts/add-cards.js` もこの設定に従う）
- 買取価格は「買取目安」（販売価格をもとに当サイトが計算した目安）として出し、金額の横に店名を出さない。「最高値」「高価」「一番高く」は使わない
- 広告表記「当サイトはアフィリエイト広告（PR）を利用しています」はヘッダーの上（`Header.astro`）に全ページ共通で出している。消さない

## 9. 迷ったとき
- 仕様にない判断が必要な場合は、実装を止めて PR か出力で質問を明記する
- 大量のファイル・記事を一括で書き換える作業は、先に対象件数と数件のサンプルを出して確認を取る
