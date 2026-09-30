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
  - `scripts/lib/deck-variant.js` … 同名デッキの URL の区別（デッキ名には付けない）
  - `scripts/lib/title-place.js` … 同じ日・同じ名前の記事のタイトルに都道府県・店舗名を付けて区別する
  - `scripts/lib/deck-name-rules.js` … デッキ名の通称ルール（`DECK_NAME_RULES`。ポケカブックの名前より優先）。特性で判定するルール用の特性の一覧は `scripts/lib/card-abilities.json`（自動生成のときに公式のカードテキストから追記される）
  - `scripts/lib/pokecabook.js` … ポケカブックのまとめ記事・RSS の読み取り（●付き小見出しとデッキコードの対応）。テストは `scripts/test/`（実際の記事の HTML の骨組みを使う）
  - `scripts/lib/highlight.js` … デッキ記事の見どころ（`highlight`。記事の書き出しの下の「このデッキのポイント」（`src/components/DeckHighlight.astro`）・一覧・トップの特集・X投稿文に使う）を公式のカードテキストから作る。決まった文の禁止リスト（`BANNED_PHRASES`）と、同じ日の記事の書き出しの点検もここ
  - `scripts/lib/ai-highlight.js` … 自動生成の見どころを Claude API で書く（設定は `AI_HIGHLIGHT_CONFIG`。くわしくは「6. 記事・紹介文の品質基準」）。API のエラーの理由の文（`apiErrorDetail`。キーの文字は伏せる）・見どころのチェック役（`review`）・要確認のときに AI に直させる処理（`checkAndFix`）もここ
  - `scripts/lib/game-rules.md` … ポケカの基本ルールのメモ（公式テキストには書かれていないが、ゲームのルールで決まっていること）。見どころを書く役とチェック役の両方に渡す。足し方は「6. 記事・紹介文の品質基準」
  - `scripts/lib/highlight-rewrite.js` … 公開済みの記事の見どころの AI でのまとめ書き直し（対象の選び方・同じ日の記事との点検・`deck-columns.json` への反映・PR 本文）。実行は `scripts/ai-highlight-rewrite.js`
  - `scripts/lib/pr-body.js` … 自動生成の PR 本文の「生成した記事」の1本分（大会の日付・開催店舗と都道府県・順位・元記事の何会場目か・デッキ名が●付き小見出しか推定か）。取れなかった項目は「取得できず」と書く
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
  - `npm test`（`scripts/lib/pokecabook.js` の読み取り、`scripts/lib/deck-name-rules.js` の通称ルール、`scripts/lib/highlight.js` の見どころの自動生成、`scripts/lib/ai-highlight.js` の AI の見どころの点検と従来の方法への切り替え（API は呼ばない）、`scripts/lib/highlight-rewrite.js` のまとめ書き直し（`highlightBy: "manual"` を上書きしないこと・API のエラーの理由。API は呼ばない）、`scripts/lib/pr-body.js` の PR 本文、`scripts/lib/title-place.js` のタイトルの区別、`.github/workflows/` の YAML の書き方（`scripts/test/workflows.test.js`）のテスト。どれかを変更したら必ず実行する）
  - `npm run rewrite-highlights`（決まった文のままの見どころを書き直す。`--dry-run` あり）/ `npm run check-highlights`（点検だけ）
  - `npm run ai-highlight-test -- --slug=スラッグ`（公開済みの記事1本の見どころを Claude API で試しに書き、今の見どころと並べて出す。ファイルは変えない。`ANTHROPIC_API_KEY` が必要。GitHub Actions の「AI highlight test (manual)」からも実行できる）
  - `npm run ai-highlight-review`（公開済みの記事の見どころをチェック役の AI にかけて結果を出す。`--slug=スラッグ` で1本だけ・なしなら全部。テスト用の9本（`scripts/test/fixtures/ai-highlight-review-cases.json`）も一緒にチェックし、`mustFlag: true` の2本（手で直す前の文＝`seek-inspiration-deck-0929`・`dipplin-festival-lead-deck-0927`）をどちらも「要確認」にでき、`mustNotFlag: true` の5本（今サイトに出ている文＝`slowking-deck`・`n-zoroark-ex-deck`・`mabusoruex-deck-0928`・`n-zoroark-ex-deck-0927`・`mega-lopunny-ex-deck-0927`）をすべて「問題なし」にできれば合格と出す。ファイルは変えない。GitHub Actions の「AI highlight review (manual)」からも実行できる）
  - `npm run ai-highlight-rewrite`（公開済みの記事の見どころを Claude API でまとめて書き直す。`highlightBy: "manual"` の記事は対象外。`--limit=5` で試しに5本だけ・`--dry-run` あり。`--only-flagged` で「要確認の記事だけ直す」。`--tagline-only` で「ひとことだけ作る」（一覧のカードの `tagline` だけ。見どころは変えない。`--tagline-missing` も付けると「ひとことがまだない記事だけ作る」）。ふだんは GitHub Actions の「AI highlight rewrite (manual)」から実行し、結果を `auto/ai-highlight-rewrite`（要確認の記事だけ直すときは `auto/ai-highlight-fix`・ひとことだけ作るときは `auto/ai-tagline`）ブランチの PR にする。main には直接入れない）
  - `npm run apply-name-rules`（デッキ名の付け足しを外し、通称ルールを既存の記事に当てはめる。`--dry-run` あり。`--report=ファイル` で PR 用の一覧を書き出す。URL は変えない）
  - `npm run check-deck-names`（公開済み記事のデッキ名とポケカブックの●付き小見出しを照合。記事は書き換えない。GitHub Actions の `check-deck-names.yml` を手動実行すると結果が Issue になる）
- 定期実行: `.github/workflows/` 配下（`update-prices.yml`、`sync-trending.yml`、`auto-deck-sync.yml` ほか）
  - `fetch-pokecabook-html.yml`（手動実行のみ）… ポケカブックの記事の HTML を Artifacts に保存し、構造と骨組みをログに出す。この環境からポケカブックにアクセスできないときの調査用
  - 実行時刻は各 yml の cron が正。README と食い違っていたら README を直す
  - **yml を書くときの注意**: `${{ }}` の中に「: 」（コロンと空白）を含む文字（例: `'content: …'`）があるときは、値の全体を `"${{ … }}"` のように `""` で囲む。囲まないと YAML の書き方の誤りになり、GitHub がそのワークフローを読めなくなる（Actions の一覧に名前ではなくファイル名が出る・push のたびに失敗した実行ができる・Run workflow の入力欄が出ない）。yml を変えたら `npm test`（`scripts/test/workflows.test.js` がすべての yml を読んで確かめる）

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
  - **デッキ名に、カードの採用や枚数による付け足し（「（ハンディサーキュレーター採用型）」「（ヒカリ2枚型）」など）を付けない。** 同じ日に同じ名前のデッキが並んでもデッキ名はそのままにし、自動生成の PR に「同じ日・同じ名前の記事」として一覧で出す（URL は `-2` や区別のカードの英語名で重ならないようにする）
    - 同じ日・同じ大会の種類・同じ名前の記事があるときだけ、**タイトルで**区別する（一覧のカードや記事の見出しに出るデッキ名はシンプルなまま。URL は変えない）。`scripts/lib/title-place.js`（自動生成と `npm run apply-name-rules` の両方で使う）
      - 大会の種類が違えば（シティリーグとジムバトル）、同じ日・同じ名前でも区別の対象にしない
      - タイトルの【】の中に都道府県を付ける（例: 【9/26 シティリーグ優勝・千葉】メガゲッコウガexデッキレシピ！…）。都道府県も同じなら店舗名を付ける
      - 店舗のデータ（`venue`）がない記事（ジムバトルなど）は、レシピの違いからタイトルのデッキ名のあとに「（〇〇採用型）」を付ける（例: 【9/26 ジムバトル優勝】メガゲッコウガex（ノココッチex採用型）デッキレシピ…）。重なった記事すべてに付ける
        - その記事にしか入っていないカードから選ぶ（ほかの記事にも入っていて枚数が違うだけのカードは選ばない）。基本エネルギー（とエネルギー全般）は選ばない
        - サイトの全デッキ記事の半分以上に入っているカード（定番カード。ボスの指令・キチキギスexなど）は選ばない
        - 選ぶ順番: ポケモン → サポート → グッズ・ポケモンのどうぐ・スタジアム。同じ種類で複数あれば、入っているデッキ記事の数が少ないカード → 枚数の多いカード → 元のデッキで先に出てくるカードの順
        - 候補が1枚もなければ（定番カードしかない場合も）「（別構築）」、2本以上あれば「（別構築2）」「（別構築3）」
        - 通称ルールで名前が変わって重ならなくなった記事には付けない
        - 付けたときは PR に「どのカードを選んだか」と「そのカードが何本のデッキ記事に入っているか」を出す
        - **一度付けた採用型は変えない。** 付けた名前は `deck-columns.json` のその記事に `"titleLabel": "ワニノコ採用型"` と `"titleLabelBy": "auto"` で保存し、あとで記事が増えて定番カードの判定が変わっても付け直さない。ルールで選ぶのは、新しく重なった記事（`titleLabel` がまだない記事）だけ
        - **採用型を手で書き換える手順**
          1. `src/data/deck-columns.json` でその記事（`slug` で探す）の `titleLabel` を書きたい名前にする（例: `"titleLabel": "回復型"`。かっこ「（）」は書かない）
          2. 同じ記事の `titleLabelBy` を `"manual"` にする（手で書いた印。自動生成・`npm run apply-name-rules` はこの名前を使い、上書きしない）
          3. `title` は直さなくてよい（ビルド時に `src/data/deck-columns.ts` が `titleLabel` をタイトルのデッキ名のあとに付け替える。`npm run apply-name-rules` を実行すると `title` の文字も書き換わる）
          4. `npm run build` で記事のタイトルを確認する（`npm run apply-name-rules -- --dry-run` の一覧では「手で書いた名前」と出る）
          - 採用型を外したいときは `titleLabel` と `titleLabelBy` の2行を消す（重なったままなら、次に自動生成・`apply-name-rules` を実行したときにルールで付け直される）
          - 同じグループの記事と同じ名前にするとタイトルが重なるので、PR の「⚠ タイトルで区別できない記事」に出る
      - 店舗のデータもレシピもなく区別できない記事は、PR の「人が確認すべき点」で知らせる
  - ただし、次の**通称ルールに当てはまるデッキは、ルールの名前を優先する**（●付き小見出しから名前が取れた場合も、推定した場合も）
    - ヤドキングが入っている → 「ひらめきチャレンジ」
    - カミッチュが入っていて、カミツオロチexが入っていない → 「おまつりおんど」（「カミッチュ（おまつりおんど）」とは書かない）
    - ドラパルトexのデッキに、特性「カースドボム」を持つカード（サマヨール・ヨノワール）が入っている → 「ボムドラパ」
    - ドラパルトexのデッキに、ノココッチが入っている → 「ノココッチドラパ」
    - 違う名前の2つ以上のルールに当てはまるデッキ（例: ボムドラパとノココッチドラパの両方）は、どちらの名前にもせず元の名前のまま残し、PR の「人が確認すべき点」に書いて人に決めてもらう
    - ヤドキングが1枚だけなど、ルールのカードが少なく迷うデッキ（`minQty` 未満）も自動では通称にしない。PR の「人が確認すべき点」に一覧で書き、人に確認する
  - **通称の足し方**（「〇〇が入った△△デッキは□□と呼ぶ」と言われたら）
    1. `scripts/lib/deck-name-rules.js` の `DECK_NAME_RULES` に1行足す
       - カード名で判定: `{ name: '□□', deck: '△△', card: '〇〇', note: '説明' }`
       - 特性の名前で判定（そのほうが確実なとき。同じ特性を持つ複数のカードをまとめて見られる）: `{ name: '□□', deck: '△△', ability: '特性名', note: '説明' }`。特性を持つカードが `scripts/lib/card-abilities.json` に載っていなければ追記する（自動生成では公式のカードテキストから自動で追記される）
       - 「〇〇が入っていたら当てはまらない」は `without: 'カード名'`、「〇〇が少ないときは迷う」は `minQty: 枚数` を足す
    2. `scripts/lib/english-name.js` の `DECK_NAMES` に英語表記（URL 用）を足す
    3. `scripts/test/deck-name-rules.test.js` にテストを足して `npm test`
    4. `npm run apply-name-rules -- --dry-run` で当てはまる記事を確認してから `npm run apply-name-rules` で公開済みの記事にも当てはめる（URL は変えない）
    5. この一覧（CLAUDE.md）と README に追記する
  - ●はテーマの装飾で表示されていて HTML の文字には含まれない（実際の HTML は `<h2>9/28【月】ジムバトル優勝</h2>` → `<h4><span>スッカラカン</span></h4>` → 画像の figcaption にデッキコードのリンク）
  - 日付の見出し（「9/28【月】ジムバトル優勝」など）はデッキ名に使わない
  - ●付き小見出しの名前が取れないとき（シティリーグのように画像にしか名前がない場合など）だけ、60枚の構成から推定し、PR に「推定」と明記する。推定では進化前のポケモン名などをそのまま使わず、正しいアーキタイプ名に補正する（例: 「カジッチュ」→「おまつりおんど」）
  - タイトル・スラッグ・`deck-columns.json` の表記を必ず一致させる
  - スラッグはデッキ名の英語表記にする（例: `tauros-deck-0928`・`bomb-talonflame-deck-0928`・ひらめきチャレンジ＝`seek-inspiration-deck-0929`・おまつりおんど＝`dipplin-festival-lead-deck-0927`・ボムドラパ＝`bomb-dragapult`・ノココッチドラパ＝`dudunsparce-dragapult`。`scripts/lib/english-name.js`）。ローマ字の読み仮名は使わない。公開済みの記事は、デッキ名を変えてもスラッグは変えない
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
- **見どころの AI 化**（`scripts/lib/ai-highlight.js`。自動生成の新しい記事と、手動で実行するまとめ書き直しだけ。立ち回り・説明文・X投稿文は AI で書かない）
  - 自動生成では、まず従来の方法（`scripts/lib/highlight.js`）で見どころを作り、そのあと Claude API に書かせる
  - AI に渡すのは、デッキ名・60枚のレシピ・採用カードの公式テキスト（`recipeProfiles` の内容）だけ。渡したものに書かれていないこと（効果・ダメージ・枚数・環境の話など）を書かない・主役のカード（`keyCards` の先頭）から書き始める・説明文を貼らず自然な日本語にする・書くカードは主役とそれを支えるカード1枚まで・長さは従来と同じくらい（`HIGHLIGHT_MAX` 以内）・誇張（最強・必勝・絶対など）を使わない・カードの効果の条件（「〇〇を持つポケモンなら」「〇〇が出ていれば」など）を省いたり広い言い方に変えたりしない（短くするときは条件ではなく説明の部分を削る。ひとことにも同じ指示を渡す。`CONDITION_RULE`）、をプロンプトで指示する
  - AI の文は `reviewAiHighlight` で点検する（`BANNED_PHRASES`・同じ日の記事の書き出し・主役からの書き出し・長さ・誇張・データにない「」の名前や数字・公式テキストの長い文の貼り付け）。引っかかったら理由を伝えて**1回だけ**書き直させる
  - それでも通らない・API のエラー・`ANTHROPIC_API_KEY` がない・呼び出し回数の上限に達したときは、従来の方法の見どころを使う。**AI の失敗で記事の自動生成を止めない**
  - **チェック役**（`createAiHighlighter` の `review`）: 点検を通った AI の文を、別の呼び出しで、見どころと「そこに名前が出てくるカードの公式テキスト」だけを渡して見比べさせる。見どころは短い紹介文なので、「書いていないこと」ではなく「書いてあることが間違っていないか」だけを見る。答えは JSON で、気になった点を1つずつ「誤り」か「問題なし」で答えさせる（`{"checks": [{"point": "…", "judgment": "誤り" | "問題なし", "reason": "…", "quote": "…"}], "notes": [...]}`。structured outputs）
    - **判定はプログラムで決める**（`parseReview`）: `checks` に「誤り」が1つでもあれば要確認、なければ問題なし（AI に要確認かどうかを答えさせない。「理由には問題なしと書いてあるのに要確認」という矛盾を起こさないため）。PR・ログに出す理由は「誤り」の点だけ（「どの部分：理由（公式テキスト「引用」）」）
    - **「誤り」には根拠の公式テキストの一文を必ず引用させる**（`quote`）。次の「誤り」は誤りとして数えない（ログに「誤りとして数えなかった点」として出すだけ）: 引用がない・引用がチェック役に渡した公式テキストに見つからない（`quoteFound`。全角半角・空白・かぎかっこ・句読点の違いと「…」の省略は見ない。4字未満の引用は根拠にしない）・理由に「誤りではない」「問題なし」などと書いてある
    - 要確認にするもの: 公式テキストとの食い違い（「山札にもどす」を「回収する」など）・どのカードの効果か／効果の対象の取り違え・書いてある数字の違い・対象を限定する条件が抜けて文が間違いになる（「ルールを持たないポケモンなら」→「ポケモンなら」など）・ルール上できない組み合わせ（ふしぎなアメで飛ばした1進化の特性を使うなど）
    - 要確認にしないもの: 数字・枚数・ダメージの省略、「自分の番に1回」などの回数制限の省略、デメリット・代償の省略、ゲームの基本ルールの省略、スタジアムが「おたがいに」効くことの省略、意味が変わらない言い換え、公式テキストが渡されていないカード（チェック役に渡す文に「確認できず」の名前として並べ、答えの `notes` に参考として書かせる。「✅ チェック済み（参考・確認できず：…）」と出る）
    - **要確認なら、AI に自分で直させる**（`createAiHighlighter` の `checkAndFix`。自動生成とまとめ書き直しの両方）
      1. チェック役の「誤り」の理由を書く役に渡して、見どころを書き直させる（`fix`。直した文も `reviewAiHighlight` の点検を通す）
      2. 書き直した文を、もう一度チェック役にかける
      3. 問題なしになれば直した文を使い「🔧 自分で直せた（最初の指摘：…）」、それでも要確認なら直した文を使い「⚠ 要確認：理由」「🙋 直せずに人に知らせた」を出す（**書き直しは1回まで**）。直した文が点検を通らない・API のエラーのときは元の文のまま「🙋 直せずに人に知らせた（理由）」
      - 呼ぶ回数は1本あたり最大5回（書く2回・チェック・直す・チェック）
    - PR（自動生成・まとめ書き直し）の記事ごとに「✅ チェック済み」「⚠ 要確認：理由」「⚠ チェックできず」と、直させたときは「🔧 自分で直せた」「🙋 直せずに人に知らせた」を出し、⚠ の記事は PR の本文のいちばん上にまとめる（自動生成の PR では、直せた記事の直す前の文も出す）
    - ⚠ でも AI の文は使う（直すかどうかは人が決める）。チェック役のエラー・上限でも文は使い「⚠ チェックできず」にする
    - チェック役・直しの呼び出しも、1回の実行の上限回数に数える
  - **ポケカの基本ルールのメモ**（`scripts/lib/game-rules.md`）: 公式テキストには書かれていないが、ゲームのルールで決まっていることを1か所にまとめ、書く役とチェック役の両方のプロンプト（system）に入れる。チェック役は、このメモに合っている書き方を「誤り」にしない
    - **足し方**（「AI がこのルールを間違えた」と言われたら）
      1. `scripts/lib/game-rules.md` の「## ルール」の下に、「- 」で始めて1行足す（1行に1つ。「- 」で始まらない行・ほかの見出しの下の行は AI に渡らない）。例: `- 「〇〇」の効果は、…。（例: △△の「□□」）`
      2. 間違えた見どころを `scripts/test/fixtures/ai-highlight-review-cases.json` に `mustNotFlag: true`（正しい文なのに要確認にされた）か `mustFlag: true`（間違った文を見逃した）で足し、`scripts/test/ai-highlight.test.js` の本数と一覧を直して `npm test`
      3. 「AI highlight review (manual)」で合格するか確かめる
      - コードは変えなくてよい（`scripts/lib/ai-highlight.js` が読み込む）
  - PR の「生成した記事」の各記事に「見どころ（AIで作成）」「見どころ（従来の方法・理由）」を出し、「Claude API（見どころ）の使用量」にモデル・呼んだ回数・トークン数・おおよその料金（ドル）を出す
  - **モデルの変え方**: `scripts/lib/ai-highlight.js` の `AI_HIGHLIGHT_CONFIG.model` だけを書き換える（今は `claude-sonnet-5-5`）。料金の目安は同じファイルの `PRICES` にあるモデルだけ出る（ないモデルは「不明」。追記すれば出る）。effort に対応していないモデル（`claude-haiku-4-5` など）にするときは `effort` を `null` にする。変えたら「AI highlight test (manual)」で数本試してから PR にする
  - 1回の実行（`npm run auto-decks` / `npm run auto-city` それぞれ）で API を呼ぶ回数の上限は `AI_HIGHLIGHT_CONFIG.maxCallsPerRun`（80回。ひとこと・チェック役・直しの分も数える。1本あたり見どころ最大5回＋ひとこと最大7回。見どころを先に全部書いてから、ひとことを書く）
  - API のエラーのときは、API が返した理由の文（残高不足など）をログと PR 本文に出す（`apiErrorDetail`）。**キーの文字は出さない**（`sk-ant-…` と渡したキーは伏せる）
- **一覧のカードの「ひとこと」**（`deck-columns.json` の各記事の `tagline`・`taglineBy`。`highlightBy`（なければ `highlight`）のすぐ後ろに置く）
  - トップの特集・デッキ解説の一覧のカードは、`tagline` があればそれ、なければ `highlight` を出す（`src/data/deck-columns.ts` の `cardBlurb`）。記事の本文の「このデッキのポイント」・X投稿文は見どころのまま
  - 自動生成では、見どころをすべて決めたあとに Claude API で1本書く（`scripts/lib/ai-highlight.js` の `writeTagline`。渡すのは見どころと同じデータ＋その記事の見どころ（参考））。長さは `TAGLINE_MIN`〜`TAGLINE_MAX`（30〜40字）
  - 見どころと同じく、カードの効果の条件を省いたり広い言い方に変えたりしない（短くするときは条件ではなく説明の部分を削る）よう指示する（`CONDITION_RULE`。直すときも同じ指示）
  - 最初の指示で「40字を1字でも超えると使えない（35字くらいが目安）」と強く伝える。**答えは structured outputs の JSON（`{"tagline": "…"}`。`TAGLINE_SCHEMA`）で受け取り、完成したひとこと1本だけを入れさせる**（字数を数える考えごと・下書きを本文に書かせない。以前は本文に考えごとが混ざり、書き直しで refusal・空の答えになった）
  - 点検は `reviewTagline`（長さ・主役のカード名が入っている・データにない「」の名前や数字・誇張・決まった文・同じ日の記事と同じ文）。**点検に通らない・断られた（refusal）・空の答えなら、理由を伝えて書き直させる（2回まで。`TAGLINE_MAX_ATTEMPTS` = 3回書く）**。長さは「長すぎます（今46字）。あと6字以上削って、40字以内…」のように具体的な数で伝える。書き直しは毎回1通のメッセージで呼び直す（前の答えと直す点は渡す文の後ろに「## 前に書いたひとこと」として書く。前の応答を会話に戻さない。断られたときは前の答えを渡さない）。それでも通らない・API のエラー・上限のときは、ひとことなし（一覧は見どころを出す）
  - チェック役・直しは見どころと同じ基準（`checkAndFix(input, text, { kind: 'tagline' })`。チェック役には「## ひとこと」として渡す）。要確認なら1回だけ直させ（直した文が長さなどの点検に通らなければ、もう1回だけ書き直させる。`TAGLINE_FIX_ATTEMPTS`）、それでも要確認なら直した文を使い、PR のいちばん上に「⚠ 要確認」で出す
  - 1本あたりの呼び出しは最大7回（書く3回・チェック・直す2回・チェック）
  - `"taglineBy": "ai"` … AI が書いたひとこと / `"manual"` … 人が手で直したひとこと。**自動生成でも「ひとことだけ作る」でも上書きしない**（ひとことを手で直したら必ず `"taglineBy": "manual"` にする）
  - 公開済みの記事は「AI highlight rewrite (manual)」の「ひとことだけ作る」（`--tagline-only`）で書く。「ひとことがまだない記事だけ作る」（`--tagline-only --tagline-missing`）なら `tagline` がまだない記事だけを書き、書けたひとことは変えない（PR は同じ `auto/ai-tagline`）。**見どころ（`highlight`・`highlightBy`）は変えない**（`"highlightBy": "manual"` の記事も、見どころはそのままでひとことだけ書く）。PR は `auto/ai-tagline` ブランチ。変えるのは `deck-columns.json` の `tagline`・`taglineBy` だけ（レシピ・価格・カードの効果は触らない）
- **見どころを書いたのは誰かの印**（`deck-columns.json` の各記事の `highlightBy`。`highlight` のすぐ後ろに置く）
  - `"ai"` … Claude API が書いた見どころ。自動生成・まとめ書き直しで AI の文を使ったときに自動で付く
  - `"manual"` … 人が手で直した見どころ。**自動生成でも、まとめ書き直し（`npm run ai-highlight-rewrite`・`npm run rewrite-highlights`）でも上書きしない**
  - なし … 従来の方法（`scripts/lib/highlight.js`）などで作った見どころ。まとめ書き直しの対象になる
  - **見どころを手で直したら、必ず `"highlightBy": "manual"` にする**（付けないと、次のまとめ書き直しで AI の文に置き換わる）。例:
    ```json
    "highlight": "ドラパルトexの「ファントムダイブ」…",
    "highlightBy": "manual",
    ```
  - AI の見どころに戻してよいときは `highlightBy` の行を消す（次のまとめ書き直しで書き直される）
  - 今 `"manual"` の記事: 9/27 シティリーグの4本（`dragapult-ex-deck-0927`・`mega-kangaskhan-ex-deck-0927`・`n-zoroark-ex-deck-0927`・`mega-sharpedo-ex-deck-0927`）・`dipplin-festival-lead-deck-0929`・`seek-inspiration-deck-0929`・`dipplin-festival-lead-deck-0927`・`n-zoroark-ex-deck`・`tauros-deck-0928`・`mega-lopunny-ex-deck-0927`・`msanaitoex-deck-0926`・`mgekkougaex-deck-0926`・`orivuaex-deck-0926`・`okidogi-deck-0928`
- **公開済みの記事の見どころのまとめ書き直し**（Actions の「AI highlight rewrite (manual)」= `.github/workflows/ai-highlight-rewrite.yml` → `scripts/ai-highlight-rewrite.js`。手動実行のみ）
  - 対象は、公開済みのデッキ記事のうち `highlightBy` が `"manual"` でないもの（公開日が新しい順）。入力欄「試しに何本だけ」に数字を入れるとその本数だけ（空欄ならすべて）
  - 書き方は自動生成と同じ（同じ指示・同じ点検・1回だけの書き直し・チェック役が要確認なら1回だけ直させる。AI に渡すのはデッキ名・60枚のレシピ・採用カードの公式テキスト・ルールのメモだけ）
  - 点検に通らなかった・API のエラーの記事は、今の見どころのまま残す
  - 同じ日の記事と書き出しが似ないよう、比べる相手には「書き直した記事は新しい文・それ以外は今の文」を渡す（書き直した文どうしでも点検する）
  - 1回の実行で API を呼ぶ回数の上限は `REWRITE_MAX_CALLS`（250回。チェック役・直しの分を含む。この作業と「AI highlight review (manual)」だけ。通常の自動生成は80回）。残高不足・キーの問題のエラーが出たとき、ほかのエラーが3回続いたときは、残りの記事は呼ばずにやめる
  - 結果は `auto/ai-highlight-rewrite` ブランチの PR にする（main に直接入れない）。PR の本文に、記事ごとの変更前・変更後の見どころとチェック役の結果（表。自分で直せた / 直せずに人に知らせた も）、書き直せなかった記事と理由、使った量とおおよその料金、書き直し後の点検を出す
  - **要確認の記事だけ直すモード**（入力欄「やること」で「要確認の記事だけ直す」を選ぶ。`--only-flagged`）
    - manual 以外の公開済みの記事の今の見どころをチェック役にかけ、要確認になった記事だけを上の方法（「誤り」の理由を渡して1回だけ直させ、もう一度チェック）で直す
    - 問題なし・チェックできずの記事は変えない。直しても要確認のままの記事も変えず（直した案と理由を PR に出す）、人に知らせる。直せた記事だけ `highlight` を変えて `highlightBy` を `"ai"` にする
    - manual の記事は直さない（チェックだけ）。要確認なら PR で知らせるだけ
    - 結果は `auto/ai-highlight-fix` ブランチの PR にし、要確認になった記事ごとに結果・変更前・変更後・理由を表で出す。直せた記事が1本もない（deck-columns.json が変わらない）ときは PR ができないので、実行結果の Summary で見る
- 解説が生成できなかった記事は TODO のまま残し、PR で報告する（中身のない文で埋めない）

## 7. デザインのルール（ホワイトラボ）
- 白基調＋微細な方眼グリッド。見出しは「M PLUS Rounded 1c」＋グラデーション
- ボタン色: 一括購入・パーツ調達＝レッド（#DC2626系）/ 買取・相場＝グリーン（#16A34A系）/ 価格比較・データ＝ローズ系
- デッキカード: メインカード1枚を `aspect-[63/88] object-cover` で表示。空のサブカード枠を作らない
- 立ち回り: 丸数字バッジ付きステップカード（1.序盤＝`bg-emerald-600` / 2.中盤＝`bg-amber-500` / 3.終盤＝`bg-red-600`）
- 本文中の主要カード名は、青文字下線の個別カードページへのリンクにする

## 8. 外部APIとセキュリティ
- 楽天・Yahoo!ショッピングAPIへのリクエスト間は 1〜2 秒待つ。価格更新は安全バジェット（`--budget=600`＝最大600秒。`update-prices.yml` で1日2回、日本時間 4:07・16:07 に実行）を守る
- APIキー（`RAKUTEN_APP_ID`・`RAKUTEN_ACCESS_KEY`・`YAHOO_APP_ID`・`ANTHROPIC_API_KEY` など）は GitHub Secrets と `.env` のみ。コード・ログ・PR 本文に出力しない
- リポジトリは Public。秘密情報をコミットしていないか、push 前に必ず確認する
- アフィリエイト設定（もしもアフィリエイトのID）は変更しない
- トレトク（A8.net・宅配買取）の案内は `src/components/ToretokuNotice.astro` だけで出す（リンクと計測画像はセットで、コードは `src/config/affiliate.ts` の `SHOPS.toretoku`）
  - 置き場所: デッキ記事の最後・レギュ落ちを説明する記事（frontmatter `regulationBuyback: true`）・カードページ（価格比較・買取目安の欄とは別の場所に小さく）
  - ほかのショップと並べたり比べたりしない（価格比較の表・買取目安の欄・`BuybackOptions` に入れない）。書くのは事実（送料・手数料無料／無料の宅配キット／スリーブやファイルのまま送れる／まとめて買取）だけで、「高価買取」などの言いすぎ・体験談風の文は使わない。案内のすぐ近くに「PR」を出す
- カーナベル（カードごとの買取リンク）は A8.net の案内でポケカの成果が 2026/05/13 から発生しないため、`src/config/affiliate.ts` の `SHOPS.kanabell.enabled = false` で止めている。止めている間はリンク・計測画像を出さず、買取ボタンは古本市場（ふるいち）に向ける。`cards.json` の `buybackShop`・`buybackUrl`・`buybackImpressionUrl` は消さない（`true` に戻せば元の表示になる。`scripts/add-cards.js` もこの設定に従う）
- 買取価格は「買取目安」（販売価格をもとに当サイトが計算した目安）として出し、金額の横に店名やお店のボタンを出さない（カードページ・トップのカード一覧とも、目安の数字と説明だけ）。買取査定の申込先はカードページの「買取査定に出す」（`BuybackOptions`）の欄だけに置く。「最高値」「高価」「一番高く」は使わない
- 広告表記「当サイトはアフィリエイト広告（PR）を利用しています」はヘッダーの上（`Header.astro`）に全ページ共通で出している。消さない

## 9. 迷ったとき
- 仕様にない判断が必要な場合は、実装を止めて PR か出力で質問を明記する
- 大量のファイル・記事を一括で書き換える作業は、先に対象件数と数件のサンプルを出して確認を取る
