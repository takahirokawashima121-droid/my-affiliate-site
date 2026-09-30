# ポケカファクトリー（ポケトリー）

競技プレイヤー向けのデッキ研究＆パーツ最安調達サイトです（Astro + Tailwind CSS 製の静的サイト）。

- 本番: https://www.pokeca-factory.com/
- 現行スタンダードの大会上位デッキについて、60枚レシピ・立ち回りと「60枚いくらで組めるか」、不足パーツの最安ショップをまとめています
- 扱うのは現行スタンダードのみです（レアリティ相場・投資・PSA価値は扱いません）
- Claude Code で作業するときのルールは [CLAUDE.md](CLAUDE.md) にまとめています

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー起動（http://localhost:4321） |
| `npm run build` | 本番ビルド（`dist/` に出力） |
| `npm run preview` | ビルド結果をローカルで確認 |
| `npx astro check` | 型チェック |
| `npm run update-prices` | 楽天・Yahoo!の最安値に価格を更新（`--ids=` `--budget=` `--dry-run`） |
| `npm run add-cards` | シードデータからカードを追加（`--dry-run`） |
| `npm run sync-trending` | 環境の頻出カードを自動で追加（`--dry-run`） |
| `npm run import-decks -- --deck=スラッグ:公式デッキコード` | 公式デッキを取り込む |
| `npm run auto-decks` / `npm run auto-city` | ジムバトル / シティリーグの新着デッキから記事を自動生成（`--dry-run`） |
| `npm run backfill-plans` | 既存記事に立ち回り（序盤・中盤・終盤）を追記（`--dry-run` `--force`） |
| `npm run apply-name-rules` | 既存の記事のデッキ名から付け足し（「（〇〇採用型）」など）を外し、通称ルール（`scripts/lib/deck-name-rules.js`）を当てはめる（`--dry-run` で確認のみ。`--report=ファイル` で PR 用の一覧を書き出す。URL は変えない） |
| `npm run check-deck-names` | 公開済み記事のデッキ名をポケカブックの●付き小見出しと照合（記事は書き換えない。結果は `.cache/deck-name-check.md`） |
| `npm run rewrite-highlights` | 決まった文（「〇〇を採用した〇〇デッキ。主力カードの効果と最安値をまとめて確認」など）のままの見どころ（highlight）を、記事ページに載っている公式のカードテキストから書き直す（`--dry-run` で確認のみ。具体的な見どころは変えない） |
| `npm run check-highlights` | 見どころの点検だけ（決まった文・同じ日の記事同士の書き出しの似かよい。結果は `.cache/highlight-check.md`） |
| `npm test` | ポケカブックのまとめ記事の読み取り（`scripts/lib/pokecabook.js`）・デッキ名の通称ルール・見どころの自動生成（`scripts/lib/highlight.js`）・自動生成の PR 本文（`scripts/lib/pr-body.js`）のテスト。実際の記事の HTML の骨組み（`scripts/test/fixtures/`）と記事ページを使う |

## 最初にやること

1. `astro.config.mjs` の `site` が本番URLになっているか確認（現在: https://www.pokeca-factory.com）
2. `src/consts.ts` でサイト名・説明文・運営者名・連絡先（`contactEmail`）を確認
3. `public/og-default.png`（1200×630）を確認する（SNSシェア時の画像。作り直し方は下の「OG画像」）
4. `src/pages/about.astro`（運営者情報）と `src/pages/privacy.md` の内容を確認

## カードデータの更新

`src/data/cards.json` を編集します。ビルド時に型チェックされ、項目の不足や型の誤りがあるとエラーになります。

**本サイトは現行スタンダード専用です。** 掲載できるのは `regulationMark` が `src/consts.ts` の `STANDARD_REGULATIONS`（現在 H・I・J）のカードと、公式の例外リスト（`STANDARD_EXEMPT_NAMES`：ハイパーボール・ボスの指令など）のカードだけで、それ以外が含まれるとビルドが失敗します（`add-cards` も追加を拒否します）。レギュレーション変更（レギュ落ち）の際は、両定数を更新し、範囲外になったカードを削除して `astro.config.mjs` の redirects に旧URLの転送先を追加してください。

| 項目 | 内容 |
| --- | --- |
| `id` | 一意なID（半角英数字・ハイフン） |
| `name` | カードの正式名称（例: `ナンジャモ`、`リーリエの全力`）。「（SA）」などの表記は含めない |
| `rarity` | レアリティ（例: `SAR`、`SR`） |
| `cardNumber` | カード番号（例: `096/071`） |
| `expansionCode` | 収録弾の略称記号（例: `SV2D`、`SM4+`） |
| `regulationMark` | レギュレーションマーク（例: `H`）。**弾ではなくカード左下に印刷されたマークを入力**（再録カードは元のマークのままの場合がある。例: SV8a 再録の大地の器は `G`）。不明なら省略 |
| `substituteIds` | 予算を抑えたい人向けの代用・関連カードの `id`（任意）。現行スタンダードで使えるカードを指定する |
| `imageUrl` | 画像URL（`public/` 配下のパスも可。空なら仮画像を表示） |
| `salePrice` / `saleShop` / `saleUrl` | 販売最安値（円）/ ショップ名 / アフィリエイトURL |
| `buybackPrice` / `buybackShop` / `buybackUrl` | 買取目安（円。販売最安値から計算）/ ショップ名 / アフィリエイトURL（ショップ名・URL は省略可。表示は `src/config/affiliate.ts` の `SHOPS` の `enabled` で切り替え） |
| `updatedAt` | 更新日時（例: `2026-09-26T10:00:00+09:00`）。「新着順」の並び替えに使用 |

画面上の表記は「ナンジャモ SAR [SV2D 096/071]」、楽天API・モール検索のキーワードは「ナンジャモ SAR 096/071 ポケカ」の形式で自動生成されます（`src/utils/cardFormat.ts`）。

販売価格は `npm run update-prices` で楽天市場・Yahoo!ショッピングの最安値に更新でき、安い方を販売最安値として表示します（`.env` に `RAKUTEN_APP_ID`・`RAKUTEN_ACCESS_KEY`・`YAHOO_APP_ID` が必要。`YAHOO_APP_ID` がなければ楽天のみ）。買取価格は販売相場から算出した目安です。価格の出典に関する注意書きは `src/consts.ts` の `priceNotice` で変更できます（データの取得方法を変えたら実態に合わせて更新してください）。

## カードの追加（シードデータ）

環境上位デッキのパーツなどを追加するときは、`scripts/seed/meta-cards.json` にカード（id・name・rarity・cardNumber・expansionCode・regulationMark・deck・role）を追記して、次を実行します。

```
npm run add-cards -- --dry-run              # 楽天の出品で型番を確認（保存しない）
npm run add-cards                           # 確認できたカードだけ cards.json に追加
npm run update-prices -- --ids=<追加したid>  # 販売価格・画像・Yahoo!価格・買取目安を取得
```

楽天で「カード名・番号・弾記号」をすべて含む出品が3件以上あるカードだけが追加されます（`--min-hits=` で変更可）。既存と id・型番が重複するカードは追加されません。買取目安は、未設定（0）の場合に update-prices が販売最安値の約62%で自動設定します。

### 環境の頻出カードを自動で追加（ポケカブック）

```
npm run sync-trending -- --dry-run   # 採用ランキング・急上昇・追加候補を表示するだけ
npm run sync-trending                # 追加候補のシードを作り、add-cards → update-prices まで実行
```

[ポケカブックのデッキレシピ一覧](https://pokecabook.com/archives/category/deck-recipe)（既定 2ページ）の記事から公式デッキコードを集め、公式のデッキページでカードを集計します。

- 記事の見出し（「〇〇環境」「レギュレーション変更前」）で各デッキの環境を判定し、**現環境のデッキだけ**で採用率を出します。急上昇は前環境からの採用率の伸びです。
- 追加候補は、未登録カードのうち採用の多い上位（`--top=` 既定 15、`--min-decks=` 既定 3）と、優先デッキ（`PRIORITY_DECKS`：ぷにぷにサークル・メガミミロップ）の未登録パーツすべてです。基本エネルギーは除きます。
- 版は公式カード検索の「スタンダード」絞り込みで選ぶため、G以前の版は自動で除外されます。デッキで使われた版と効果テキストが同じ版のうち、最低レアリティの版を選びます。
- マークは弾から決めます（スクリプト内の `SET_MARKS`）。新しい弾が出たら追記してください。未登録の弾の版は選ばれません。
- 結果は `scripts/seed/trending-cards.json` に保存され、add-cards が楽天の出品で型番を確認してから追加します。

デッキページ・カード詳細は `.cache/`（Git 管理外）に保存し、同じサイトへのリクエストは1.5秒以上あけます。

`.github/workflows/sync-trending.yml` が毎週月曜 日本時間 午前5時23分に `npm run sync-trending` を実行し、カードが追加されていれば `npm run build` でビルドが通ることを確認してから、main に直接コミット・プッシュします（ビルドに失敗した場合は push しません。Secrets は価格の自動更新と共通。Actions タブ →「Sync trending cards」→「Run workflow」で手動実行も可）。

## 価格の自動更新（GitHub Actions）

`.github/workflows/update-prices.yml` が1日2回（日本時間 午前4時7分・16時7分）に `node scripts/update-prices.js --budget=600` を実行し（600秒を過ぎたら新しいカードの取得を始めず、残りは次回）、`src/data/cards.json` に差分があれば「chore: daily price update」としてコミット・プッシュします（Vercel が自動デプロイ）。GitHub の Actions タブ →「Update prices」→「Run workflow」から手動実行もできます。

事前に、リポジトリの Settings → Secrets and variables → Actions に `RAKUTEN_APP_ID`・`RAKUTEN_ACCESS_KEY`・`YAHOO_APP_ID` を登録してください。全カードで API エラーになった場合（キーの失効など）はワークフローが失敗し、GitHub から通知されます。

楽天APIへのリクエストには、アプリ登録時の「許可されたWebサイト」と一致する Origin が必要です。`scripts/update-prices.js`・`scripts/add-cards.js` の `RAKUTEN_ORIGIN_URL` は、楽天側の登録に合わせて設定してください（現在は登録済みの Vercel のURL）。

楽天市場に在庫のないカードは「在庫なし」となり、買取価格も根拠がないため「要査定」と表示されます。

## OG画像（SNSシェア時の画像）

- トップ・コラム・デッキ解説・Tier表など、個別の画像を指定しないページは `public/og-default.png`（1200×630。`src/consts.ts` の `ogImage`）を使います
- カードページはカードの画像（`cards.json` の `imageUrl`）、コラムはフロントマターの `heroImage` があればそれを使います
- `og-default.png` の元は `scripts/assets/og-default.html` です。文言やデザインを変えたら、次のコマンドで PNG を作り直してコミットしてください（Playwright はプロジェクトの依存に入れていないので、使うときだけ入れます）

```sh
npm install --no-save playwright
npx playwright install chromium   # Chromium が入っていない場合だけ
node scripts/render-og-image.js   # public/og-default.png を上書き
```

## X（旧Twitter）用の画像

`public/generate-assets.html` をブラウザで開くと、X のアイコン（400×400）・プロフィールのヘッダー（1500×500）・サイト紹介バナー（1200×675）を描画し、そのまま PNG で保存できます（「出力倍率」で2倍＝ヘッダー 3000×1000 なども選べます）。フォントが読み込めたかどうかは、ページ上部に表示されます。

- デザインはサイトと `og-default.png` に合わせています（白い背景に細かい方眼・ハザードストライプ・「ポケカファクトリー」は M PLUS Rounded 1c の赤→オレンジのグラデーション）
- アイコンはサイト左上の黄色い「P」のロゴマーク（`public/favicon.svg`）がもとで、X の丸い切り抜きの内側に収めています

- ヘッダーは、スマホの X アプリでアイコンが重なる左下（x:0〜370・y:320〜500）に何も置かず、大事な文字は中央（上下60pxより内側）に集めています。「Xのトリミング目安を表示」でアイコンの位置と上下が切れる範囲を確認できます（保存する画像には入りません）
- コマンドでまとめて書き出すこともできます。Web フォント（Noto Sans JP・M PLUS Rounded 1c）が読み込めなかったときは書き出さずに止まります

```sh
npm install --no-save playwright
node scripts/render-x-assets.js --scale=2   # .cache/x-assets/ にアイコン・ヘッダー・バナーと、確認用の icon-circle・header-guide を保存
```

## コラム記事の追加

`src/content/blog/` に `.md` ファイルを追加するだけです。書き方は `src/content/blog/how-to-write-post.md` を参照してください。

## デッキ解説コラム（/columns/）

デッキ解説は `src/pages/columns/{slug}.astro`（共通レイアウト `src/layouts/DeckColumn.astro`）で、記事の一覧情報は `src/data/deck-columns.json`、60枚レシピは `src/data/official-decks.json` にあります。

```
npm run import-decks -- --deck=スラッグ:公式デッキコード   # 公式デッキを取り込み、未登録カードを追加（手動で記事を書くとき）
npm run auto-decks -- --dry-run                            # 新着の優勝デッキと生成予定を表示
npm run auto-decks                                         # 新着の優勝デッキから記事を自動生成
```

### 新着入賞デッキの自動生成（GitHub Actions）

`.github/workflows/auto-deck-sync.yml` が1日2回（日本時間 朝8時18分・夜23時23分）、ポケカブックのRSSから新着のジムバトル優勝デッキ（`npm run auto-decks`）と、シティリーグの優勝・準優勝デッキ（`npm run auto-city`）を検知し、次の処理をして1つの **Pull Request**（ブランチ `auto/deck-sync`）にまとめます（`scripts/auto-deck-updater.js`）。シティリーグだけを手動で取得したいときは `.github/workflows/auto-city-sync.yml`（Actions タブから手動実行のみ）を使います。

- ジムバトル・シティリーグそれぞれ、既存の記事がないデッキ名を優先して最大4デッキを選び、未登録カードを最低レアリティで追加・価格取得
- 記事（デッキの構成・公式テキストによる主力カードの効果・最安値つき60枚レシピ・代替案の枠）を生成
- 立ち回り（序盤・中盤・終盤）を、60枚の構成と公式のカードテキストから自動生成して `deck-columns.json` の `gamePlan`（`early` / `mid` / `end`）に保存（`scripts/lib/game-plan.js`。表示は `src/components/GamePlan.astro`）
- デッキ名は**ポケカブックのまとめ記事の●付き小見出し**（例: 「●スッカラカン」「●ボムファイアロー」）を正とします。●はテーマの装飾で表示されていて HTML の文字には含まれないため、日付の見出し（h2）の下の小見出し（h3〜h6。実際の記事では `<h4>スッカラカン</h4>`）を●付き小見出しとして読みます。日付の見出し（h2 の「9/28【月】ジムバトル優勝」など）はデッキ名として使いません。●付き小見出しが取れなかったデッキだけ、レシピから推定し、PR に「推定」と明記します。日付・大会名がデッキ名に残った場合は生成を止めます
- 記事の URL（slug）はデッキ名の英語表記から作ります（例: `tauros-deck-0928`・`bomb-talonflame-deck-0928`・`mega-lopunny-ex-deck-0927`）。ポケモン名は `scripts/lib/pokemon-names-en.json`（PokeAPI の日本語名・英語名対応表）、ポケモン名でない呼び名（スッカラカン・ボムなど）は `scripts/lib/english-name.js` の `DECK_WORDS` で英語にします。英語にできない部分があるときは主役ポケモンの英語名を使い、それもなければローマ字にして、PR の確認項目に出します。ローマ字の読み仮名は使いません
- デッキ名は通称ルール（`scripts/lib/deck-name-rules.js` の `DECK_NAME_RULES`）に当てはまれば、ポケカブックの●付き小見出しの名前より優先します（例: ヤドキング採用 →「ひらめきチャレンジ」、カミッチュ採用でカミツオロチexなし →「おまつりおんど」、ドラパルトexに特性「カースドボム」のカード →「ボムドラパ」、ドラパルトexにノココッチ →「ノココッチドラパ」）。ヤドキング1枚だけなど迷うもの、2つ以上のルールに当てはまるものは名前を変えず、PR に一覧で出します。通称の足し方は CLAUDE.md の「通称の足し方」を見てください
- デッキ名には「（ノココッチex採用型）」のような付け足しをしません。同じ日・同じ名前の記事ができたときは PR に一覧で出します。URL だけは、レシピを比べて一方にしか入っていないポケモンの英語名を付けて区別します（例: `dragapult-ex-deck-0927-moltres`。`scripts/lib/deck-variant.js`）
- 処理済みの記事・デッキは `scripts/cache/processed-decks.json` に記録（まとめ記事は同じURLのまま毎日更新されるため、URL＋タイトルとデッキコードで判定）

代替カード・カスタマイズ案は自動では書かないため、PR で各記事の `TODO` を追記してからマージしてください。立ち回りが未記載の既存記事には `npm run backfill-plans` で追記できます（手書きの「回し方」がある記事は対象外）。PR の作成には、リポジトリの Settings → Actions → General → Workflow permissions で「Allow GitHub Actions to create and approve pull requests」を有効にする必要があります。

PR に「マーク未対応の弾」と表示されたカードは、`scripts/lib/official.js` の `SET_MARKS` に弾とレギュレーションマーク（カード画像の左下）を追記すると、次回から登録されます。

### 公開済み記事のデッキ名チェック（GitHub Actions・手動）

`.github/workflows/check-deck-names.yml`（`scripts/check-deck-names.js`）は、公開済みのすべてのデッキ記事について、元になったポケカブックのまとめ記事から公式デッキコードが一致するデッキの●付き小見出しの名前を取り出し、今のデッキ名と比べて、結果を **Issue** として作成します。**記事は書き換えません。** GitHub の Actions タブ →「Check deck names (manual)」→「Run workflow」から実行します（定期実行はしません）。

- 一覧には「今のデッキ名」「ポケカブックの名前」「判定（一致・不一致・確認できなかった）」「記事のURL」「元記事」「メモ」が入ります
- 元記事は `scripts/cache/processed-decks.json` の記録から探し、記録にない記事はいまの RSS のまとめ記事からも探します。ジムバトルのまとめ記事は同じURLのまま毎日書き換えられるため、見つからないときは処理日の前後に Wayback Machine に保存された版も読みます
- 以前に当サイトで付けていた付け足し（「（ノココッチex採用型）」など）を外すと一致する場合は「一致」とします
- シティリーグのようにデッキ名が画像にしかない記事、元記事からデッキが消えている記事、手動で作成した記事（元記事の記録がない）は「確認できなかった」になります。元記事を人が見て確認してください

### ポケカブックの HTML の取得（GitHub Actions・手動、調査用）

ポケカブックの記事の作りが変わって読み取りがおかしくなったときの調査用です。`.github/workflows/fetch-pokecabook-html.yml` を Actions タブ →「Fetch pokecabook HTML (manual)」→「Run workflow」から実行すると、指定した記事（空白区切りで複数可）の HTML をそのまま取得し、実行結果のページの Artifacts（`pokecabook-html`、7日で削除）に保存します。あわせて次のものを作ります。

- ログ: ●付きの文字・見出し・デッキコードのリンクがどの要素の中にあるかと、`scripts/lib/pokecabook.js` での読み取り結果（`scripts/debug/outline-html.js`）
- 骨組み: 本文・画像を除き、見出し・デッキコードのリンク・タグの構造だけを残した HTML（`scripts/debug/skeleton-html.js`）。テスト用の `scripts/test/fixtures/` はこれを使います。取得した HTML そのものはリポジトリにコミットしません（記事本文を転載しないため）

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

Vercel でホスティングしています（本番: https://www.pokeca-factory.com/）。main への push で本番デプロイされ、PR ごとにプレビューが作られます。ビルドコマンドは `npm run build`、出力ディレクトリは `dist` です。
