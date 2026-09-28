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

export const columnPath = (c: DeckColumn) => `/columns/${c.slug}/`;

/** ジムバトル優勝デッキの記事か（result が「9/26 ジムバトル優勝」の形式） */
export const isGymWin = (c: DeckColumn) => /ジムバトル優勝/.test(c.result);

/**
 * 優勝日（YYYY-MM-DD）。result の「M/D」に、記事の公開年を補って求める
 * （公開月より後の月なら前年の大会とみなす。例: 2027-01-02 公開の「12/30」→ 2026-12-30）。日付がなければ公開日
 */
export function eventDate(c: DeckColumn): string {
  const m = c.result.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return c.pubDate;
  const [year, pubMonth] = c.pubDate.split('-').map(Number);
  const month = Number(m[1]);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${month > pubMonth ? year - 1 : year}-${pad(month)}-${pad(Number(m[2]))}`;
}

/** デッキの系統（「メガジガルデex（〇〇型）」→「メガジガルデex」）。特集に同じデッキが並ばないようにする */
const deckBase = (c: DeckColumn) => c.deckName.replace(/（.*）$/, '');

/**
 * トップページの「最新ジムバトル優勝デッキ特集」。deck-columns.json から優勝日（→ 公開日）が新しい順に並べて先頭から選ぶため、
 * scripts/auto-deck-updater.js が新しい優勝デッキを追記すれば、次のビルドで自動的に特集が切り替わる。
 * 同じ日付どうしは deck-columns.json の掲載順。同じ系統のデッキは1件だけ載せる
 */
export function latestGymWinners(limit = 6): { title: string; date: string; columns: DeckColumn[] } {
  const sorted = DECK_COLUMNS.filter(isGymWin)
    .map((c, order) => ({ c, order, date: eventDate(c) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.c.pubDate.localeCompare(a.c.pubDate) || a.order - b.order);
  const seen = new Set<string>();
  const columns = sorted.filter(({ c }) => !seen.has(deckBase(c)) && seen.add(deckBase(c))).slice(0, limit).map(({ c }) => c);
  const date = sorted[0]?.date ?? '';
  const [, m, d] = date.split('-').map(Number);
  return { title: `最新ジムバトル優勝デッキ特集${date ? `（${m}/${d}）` : ''}`, date, columns };
}
