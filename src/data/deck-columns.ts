// デッキ解説コラム（src/pages/columns/）の一覧・相互リンク用のデータ
// レシピ（カードと枚数）は src/data/official-decks.json（npm run import-decks が公式デッキコードから生成）を使う

export type DeckColumn = {
  /** URL（/columns/{slug}/）とファイル名（src/pages/columns/{slug}.astro） */
  slug: string;
  /** src/data/official-decks.json のキー */
  deckKey: string;
  /** デッキ名（一覧・相互リンクの見出し） */
  deckName: string;
  title: string;
  description: string;
  /** 大会・日付（「9/26 ジムバトル優勝」） */
  result: string;
  pubDate: string;
  /** 見どころ（トップページの特集カードに表示する一言） */
  highlight: string;
  /** 主力パーツ（レシピ内のカード名。最安値カードとして記事上部に表示する。同名が複数あれば最初の版） */
  keyCards: string[];
};

export const DECK_COLUMNS: DeckColumn[] = [
  {
    slug: 'mega-gengar-deck',
    deckKey: 'mega-gengar',
    deckName: 'メガゲンガーex',
    title: '【9/26 ジムバトル優勝】メガゲンガーexデッキレシピと回し方！採用カード最安値・代替パーツ提案',
    description:
      '9/26のジムバトルで優勝したメガゲンガーexデッキの60枚レシピを、採用カードの最安値つきで解説。ゲンガーex・メガゲンガーexの役割、序盤からの回し方、予算を抑える代替パーツまで紹介します。',
    result: '9/26 ジムバトル優勝',
    pubDate: '2026-09-27',
    highlight: 'ゲンガーexの「カオスペイン」でベンチも狙い、メガゲンガーexの230で押し切る',
    keyCards: ['メガゲンガーex', 'ゲンガーex', 'ゴースト', 'ノココッチ', 'アンズの秘技', '危ない廃墟'],
  },
  {
    slug: 'mega-diancie-deck',
    deckKey: 'mega-diancie',
    deckName: 'メガディアンシーex',
    title: '【9/26 ジムバトル優勝】メガディアンシーexデッキレシピと回し方！採用カード最安値・代替パーツ提案',
    description:
      '9/26のジムバトルで優勝したメガディアンシーexデッキの60枚レシピを、採用カードの最安値つきで解説。ワンダーパッチ・テレパス超エネルギーでの展開、ヨノワールのカースドボム、回し方、予算を抑える代替パーツまで紹介します。',
    result: '9/26 ジムバトル優勝',
    pubDate: '2026-09-27',
    highlight: '進化不要のメガディアンシーexが最大240ダメージ。ヨノワールのカースドボムで詰める',
    keyCards: ['メガディアンシーex', 'ヨノワール', 'ワンダーパッチ', 'ミステリーガーデン', 'テレパス超エネルギー', 'ミュウex'],
  },
  {
    slug: 'hops-zacian-deck',
    deckKey: 'hops-zacian',
    deckName: 'ホップのザシアンex',
    title: '【9/26 ジムバトル優勝】ホップのザシアンデッキレシピと回し方！採用カード最安値・代替パーツ提案',
    description:
      '9/26のジムバトルで優勝したホップのザシアンexデッキの60枚レシピを、採用カードの最安値つきで解説。ホップのカビゴン・ホップのこだわりハチマキの役割、回し方、予算を抑える代替パーツまで紹介します。',
    result: '9/26 ジムバトル優勝',
    pubDate: '2026-09-27',
    highlight: '「+30」を3枚重ねて、ブレイブスラッシュが330ダメージに',
    keyCards: ['ホップのザシアンex', 'ホップのカビゴン', 'ホップのこだわりハチマキ', 'ホップのバッグ', 'ハロンタウン', 'メガガルーラex'],
  },
  {
    slug: 'mega-greninja-deck',
    deckKey: 'mega-greninja',
    deckName: 'メガゲッコウガex',
    title: '【9/26 ジムバトル優勝】メガゲッコウガexデッキレシピと回し方！採用カード最安値・代替パーツ提案',
    description:
      '9/26のジムバトルで優勝したメガゲッコウガexデッキの60枚レシピを、採用カードの最安値つきで解説。ケロマツからの進化ライン、ゲッコウガex・メガユキメノコexの役割、予算を抑える代替パーツまで紹介します。',
    result: '9/26 ジムバトル優勝',
    pubDate: '2026-09-27',
    highlight: 'ニンジャスピナーで戻した水エネルギーを、ひっさつしゅりけんのダメカン6個に変える',
    keyCards: ['メガゲッコウガex', 'ゲコガシラ', 'ケロマツ', 'ゲッコウガex', 'メガユキメノコex', 'なみのりビーチ'],
  },
];

/** トップページの特集（最新の大会結果） */
export const FEATURED_DECKS = {
  title: '最新ジムバトル優勝デッキ特集（9/26）',
  slugs: ['mega-gengar-deck', 'mega-diancie-deck', 'hops-zacian-deck', 'mega-greninja-deck'],
};

export const columnPath = (c: DeckColumn) => `/columns/${c.slug}/`;
