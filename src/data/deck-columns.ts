// デッキ解説コラム（src/pages/columns/）の一覧・相互リンク用のデータ
import deckColumns from './deck-columns.json';

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

// 記事の一覧は deck-columns.json（scripts/auto-deck-updater.js が新着デッキの記事を追記する）
export const DECK_COLUMNS: DeckColumn[] = deckColumns;

/** トップページの特集（最新の大会結果から4〜6件。メガシンカ・ex・非ex・低予算が偏らないように選ぶ） */
export const FEATURED_DECKS = {
  title: '最新ジムバトル優勝デッキ特集（9/26）',
  slugs: ['mega-gengar-deck', 'mega-diancie-deck', 'hops-zacian-deck', 'mega-greninja-deck', 'dekanuchixyan-deck-0926', 'soubureizuex-deck-0926'],
};

export const columnPath = (c: DeckColumn) => `/columns/${c.slug}/`;
