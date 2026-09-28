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
  /** 大会の種類（シティリーグ / ジムバトル）。省略時は result の文言から判定し、「ジムバトル」を含めば gym */
  eventType?: EventType;
  /** 成績。省略時は result の文言から判定（「準優勝」「TOP4」「TOP8」、それ以外で「優勝」を含めば 優勝） */
  rank?: EventRank;
  /** 大会名（例: 「シティリーグ2026 S1」「ジムバトル」）。バッジの表記に使う */
  eventName?: string;
  /** 会場（シティリーグの開催店舗など） */
  venue?: string;
  /**
   * 立ち回り（序盤・中盤・終盤の段落。文中の [[カード名]] はカード詳細ページへのリンクになる）。
   * scripts/lib/game-plan.js が60枚の構成と公式のカードテキストから自動生成する。手書きの「回し方」がある記事にはない
   */
  gamePlan?: { early: string[]; mid: string[]; end: string[] };
  /** 開催日（YYYY-MM-DD）。省略時は result の「M/D」と公開年から求める */
  eventDate?: string;
};

export type EventType = 'city' | 'gym';
export type EventRank = '優勝' | '準優勝' | 'TOP4' | 'TOP8';

// 記事の一覧は deck-columns.json（scripts/auto-deck-updater.js が新着デッキの記事を追記する）
export const DECK_COLUMNS = deckColumns as DeckColumn[];

export const columnPath = (c: DeckColumn) => `/columns/${c.slug}/`;

/** 大会の種類。明示されていなければ result の文言から判定（ジムバトル以外の大会・環境まとめ由来の記事は undefined） */
export function eventTypeOf(c: DeckColumn): EventType | undefined {
  if (c.eventType) return c.eventType;
  if (/シティ/.test(c.result)) return 'city';
  if (/ジムバトル/.test(c.result)) return 'gym';
  return undefined;
}

/** 成績。明示されていなければ result の文言から判定（判定できなければ undefined） */
export function rankOf(c: DeckColumn): EventRank | undefined {
  if (c.rank) return c.rank;
  if (/準優勝/.test(c.result)) return '準優勝';
  if (/TOP\s*4|ベスト4/i.test(c.result)) return 'TOP4';
  if (/TOP\s*8|ベスト8/i.test(c.result)) return 'TOP8';
  if (/優勝/.test(c.result)) return '優勝';
  return undefined;
}

/** 特集に載せる大会入賞デッキか（シティリーグ・ジムバトルの入賞記録があるもの） */
export const isEventPlacing = (c: DeckColumn) => eventTypeOf(c) !== undefined && rankOf(c) !== undefined;

/**
 * 開催日（YYYY-MM-DD）。eventDate があればそれを使い、なければ result の「M/D」に記事の公開年を補って求める
 * （公開月より後の月なら前年の大会とみなす。例: 2027-01-02 公開の「12/30」→ 2026-12-30）。日付がなければ公開日
 */
export function eventDate(c: DeckColumn): string {
  if (c.eventDate) return c.eventDate;
  const m = c.result.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return c.pubDate;
  const [year, pubMonth] = c.pubDate.split('-').map(Number);
  const month = Number(m[1]);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${month > pubMonth ? year - 1 : year}-${pad(month)}-${pad(Number(m[2]))}`;
}

/** 「2026-09-26」→「9/26」 */
const shortDate = (date: string) => date.slice(5).replace(/^0/, '').replace('-0', '-').replace('-', '/');

/**
 * 大会バッジ（表記と配色）。デッキカード・一覧・記事ヘッダーで共通に使う
 * - シティリーグ：濃紺 × ゴールド（例:「🏆 9/14 シティS1 優勝」「🎖️ 9/14 シティS1 TOP4」）
 * - ジムバトル：アンバー（例:「⚔️ 9/26 ジムバトル 優勝」）
 * - それ以外（環境まとめ由来の記事など）：result の文言をそのまま控えめなバッジで表示
 */
export function eventBadge(c: DeckColumn): { label: string; className: string; type: EventType | 'other' } {
  const type = eventTypeOf(c);
  const rank = rankOf(c);
  const hasDate = Boolean(c.eventDate) || /\d{1,2}\/\d{1,2}/.test(c.result);
  const date = hasDate ? `${shortDate(eventDate(c))} ` : '';
  if (type === 'city' && rank) {
    const name = (c.eventName ?? 'シティリーグ').replace(/シティリーグ\s*(\d{4})?\s*/, 'シティ');
    return {
      type,
      label: `${rank === '優勝' ? '🏆' : '🎖️'} ${date}${name} ${rank}`,
      className: 'border border-amber-500/40 bg-slate-900 text-amber-300',
    };
  }
  if (type === 'gym' && rank) {
    return { type, label: `⚔️ ${date}ジムバトル ${rank}`, className: 'border border-amber-300 bg-amber-100 text-amber-800' };
  }
  return { type: 'other', label: `🏅 ${c.result}`, className: 'border border-slate-300 bg-slate-100 text-slate-700' };
}

/** デッキの系統（「メガジガルデex（〇〇型）」→「メガジガルデex」）。特集に同じデッキが並ばないようにする */
const deckBase = (c: DeckColumn) => c.deckName.replace(/（.*）$/, '');

/**
 * トップページの「最新大会入賞デッキ特集」。deck-columns.json のシティリーグ・ジムバトル入賞デッキを、開催日（→ 公開日）が
 * 新しい順に並べて先頭から選ぶ（type を渡すとその大会だけ）。新しい大会のデッキが追加されれば、次のビルドで自動的に特集が切り替わる。
 * 同じ日付どうしはシティリーグ → ジムバトル、成績の高い順、deck-columns.json の掲載順。同じ系統のデッキは1件だけ載せる
 */
export function latestEventDecks(limit = 6, type?: EventType): { title: string; date: string; columns: DeckColumn[] } {
  const rankOrder: EventRank[] = ['優勝', '準優勝', 'TOP4', 'TOP8'];
  const score = (c: DeckColumn) => (eventTypeOf(c) === 'city' ? 0 : 10) + rankOrder.indexOf(rankOf(c)!);
  const sorted = DECK_COLUMNS.map((c, order) => ({ c, order, date: eventDate(c) }))
    .filter(({ c }) => isEventPlacing(c) && (!type || eventTypeOf(c) === type))
    .sort((a, b) => b.date.localeCompare(a.date) || score(a.c) - score(b.c) || b.c.pubDate.localeCompare(a.c.pubDate) || a.order - b.order);
  const seen = new Set<string>();
  const columns = sorted.filter(({ c }) => !seen.has(deckBase(c)) && seen.add(deckBase(c))).slice(0, limit).map(({ c }) => c);
  const date = sorted[0]?.date ?? '';
  return { title: `最新大会入賞デッキ特集（シティ＆ジムバ）${date ? `・${shortDate(date)}更新` : ''}`, date, columns };
}
