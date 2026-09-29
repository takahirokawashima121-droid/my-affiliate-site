# ポケカファクトリー（ポケトリー）

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

**本サイトは現行スタンダード専用です。** 掲載できるのは `regulationMark` が `src/consts.ts` の `STANDARD_REGULATIONS`（現在 H・I・J）のカードと、公式の例外リスト（`STANDARD_EXEMPT_NAMES`：ハイパーボール・ボスの指令など）のカードだけで、それ以外が含まれるとビルドが失敗します（`add-cards` も追加を拒否します）。レギュレーション変更（スタン落ち）の際は、両定数を更新し、範囲外になったカードを削除して `astro.config.mjs` の redirects に旧URLの転送先を追加してください。

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
| `buybackPrice` / `buybackShop` / `buybackUrl` | 買取最高値（円）/ ショップ名 / アフィリエイトURL |
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

`.github/workflows/sync-trending.yml` が毎週月曜 日本時間 午前5時23分に `npm run sync-trending` を実行し、ビルドが通ることを確認してから、カードが追加されていればコミット・プッシュします（Secrets は価格の自動更新と共通。Actions タブ →「Sync trending cards」→「Run workflow」で手動実行も可）。

## 価格の自動更新（GitHub Actions）

`.github/workflows/update-prices.yml` が毎日 日本時間 午前4時7分に `npm run update-prices` を実行し、`src/data/cards.json` に差分があれば「chore: daily price update」としてコミット・プッシュします（Vercel が自動デプロイ）。GitHub の Actions タブ →「Update prices」→「Run workflow」から手動実行もできます。

事前に、リポジトリの Settings → Secrets and variables → Actions に `RAKUTEN_APP_ID`・`RAKUTEN_ACCESS_KEY`・`YAHOO_APP_ID` を登録してください。全カードで API エラーになった場合（キーの失効など）はワークフローが失敗し、GitHub から通知されます。

楽天市場に在庫のないカードは「在庫なし」となり、買取価格も根拠がないため「要査定」と表示されます。

## コラム記事の追加

`src/content/blog/` に `.md` ファイルを追加するだけです。書き方は `src/content/blog/how-to-write-post.md` を参照してください。

## デッキ解説コラム（/columns/）

デッキ解説は `src/pages/columns/{slug}.astro`（共通レイアウト `src/layouts/DeckColumn.astro`）で、記事の一覧情報は `src/data/deck-columns.json`、60枚レシピは `src/data/official-decks.json` にあります。

```
npm run import-decks -- --deck=スラッグ:公式デッキコード   # 公式デッキを取り込み、未登録カードを追加（手動で記事を書くとき）
npm run auto-decks -- --dry-run                            # 新着の優勝デッキと生成予定を表示
npm run auto-decks                                         # 新着の優勝デッキから記事を自動生成
```

### 新着優勝デッキの自動生成（GitHub Actions）

`.github/workflows/auto-deck-sync.yml` が1日2回（日本時間 8時18分・23時23分。時刻は auto-deck-sync.yml の cron が正）、ポケカブックのRSSから新着の「ジムバトル優勝デッキまとめ」を検知し、次の処理をして **Pull Request** を作成します（`scripts/auto-deck-updater.js`）。

- 既存の記事がないデッキ名を優先して最大4デッキを選び、未登録カードを最低レアリティで追加・価格取得
- 記事（デッキの構成・公式テキストによる主力カードの効果・最安値つき60枚レシピ・代替案の枠）を生成
- デッキ名はまとめ記事の見出し（h2）から取ります。見出しが「9/28【月】ジムバトル優勝」のような日付・大会名のときはデッキ名として使わず、レシピから推定して PR に「推定」と明記します。日付・大会名がデッキ名に残った場合は生成を止めます
- 記事の URL（slug）はデッキの主役ポケモンの英語名から作ります（例: `mega-kangaskhan-ex-deck-0928`、型名付きは `jellicent-ex-deck-0928-slowbro`）。英語名は `scripts/lib/pokemon-names-en.json`（PokeAPI の日本語名・英語名対応表）と `scripts/lib/english-name.js` で引きます。英語名が分からないときだけローマ字になり、PR の確認項目に出ます
- 同じデッキ名の記事がすでにある（または同じ回に複数ある）場合は、レシピを比べて一方にしか入っていないカード（ex → ACE SPEC → そのほかのポケモン → トレーナーズの順）から「メガゲッコウガex（ノココッチex採用型）」のように名付けます。型名のない既存の同名記事にも型名を付けます（`scripts/lib/deck-variant.js`）
- 処理済みの記事・デッキは `scripts/cache/processed-decks.json` に記録（まとめ記事は同じURLのまま毎日更新されるため、URL＋タイトルとデッキコードで判定）

回し方・代替カードは自動では書かないため、PR で各記事の `TODO` を追記してからマージしてください。PR の作成には、リポジトリの Settings → Actions → General → Workflow permissions で「Allow GitHub Actions to create and approve pull requests」を有効にする必要があります。

PR に「マーク未対応の弾」と表示されたカードは、`scripts/lib/official.js` の `SET_MARKS` に弾とレギュレーションマーク（カード画像の左下）を追記すると、次回から登録されます。

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
