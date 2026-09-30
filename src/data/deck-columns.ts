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
  /**
   * 見どころを書いたのは誰か（'ai' = Claude API が書いた / 'manual' = 人が手で直した / なし = 従来の方法など）。
   * 'manual' の見どころは、自動生成・まとめ書き直し（npm run ai-highlight-rewrite / rewrite-highlights）で上書きしない
   */
  highlightBy?: 'ai' | 'manual';
  /**
   * ひとこと（一覧のカード＝トップの特集・デッキ解説の一覧に出す30〜40字の短い紹介）。ないときは一覧に見どころ（highlight）を出す（cardBlurb）。
   * Claude API が書く（scripts/lib/ai-highlight.js の writeTagline）。記事の本文・X投稿文には使わない
   */
  tagline?: string;
  /** ひとことを書いたのは誰か（'ai' = Claude API / 'manual' = 人が手で直した。'manual' は自動生成・まとめ作成で上書きしない） */
  taglineBy?: 'ai' | 'manual';
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
  /**
   * タイトルだけに付ける採用型（「ワニノコ採用型」「別構築」など）。同じ日・同じ名前の記事をタイトルで区別するためのもの（デッキ名には付けない）。
   * scripts/lib/title-place.js が付けて保存し、保存済みの記事は付け直さない。ここを書き換えれば、タイトルにはこの名前が出る
   */
  titleLabel?: string;
  /** titleLabel を付けたのは誰か（'auto' = ルールで自動 / 'manual' = 人が手で書いた。どちらも自動では上書きしない） */
  titleLabelBy?: 'auto' | 'manual';
};

export type EventType = 'city' | 'gym';
export type EventRank = '優勝' | '準優勝' | 'TOP4' | 'TOP8';

// 記事の一覧は deck-columns.json（scripts/auto-deck-updater.js が新着デッキの記事を追記する）
/**
 * タイトルの【】のすぐあとのデッキ名に「（{titleLabel}）」を付ける（scripts/lib/title-place.js の withLabel と同じ）。
 * deck-columns.json の titleLabel だけを手で書き換えても、タイトルに反映されるようにする
 */
function titleWithLabel(c: DeckColumn): string {
  const m = c.title.match(/^(【[^】]*】)(.*)$/);
  if (!c.titleLabel || !m || !m[2].startsWith(c.deckName)) return c.title;
  const rest = m[2].slice(c.deckName.length).replace(/^（[^（）]*）/, '');
  return `${m[1]}${c.deckName}（${c.titleLabel}）${rest}`;
}
export const DECK_COLUMNS = (deckColumns as DeckColumn[]).map((c) => (c.titleLabel ? { ...c, title: titleWithLabel(c) } : c));

export const columnPath = (c: DeckColumn) => `/columns/${c.slug}/`;

/** 一覧のカードに出す短い紹介: ひとこと（tagline）があればそれ、なければ見どころ（highlight） */
export const cardBlurb = (c: Pick<DeckColumn, 'tagline' | 'highlight'>) => c.tagline?.trim() || c.highlight;

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

/** 成績の並び順（優勝 → 準優勝 → TOP4 → TOP8 → 「TOP16」などその他の順位 → 順位なし） */
const RANK_ORDER: EventRank[] = ['優勝', '準優勝', 'TOP4', 'TOP8'];
function rankScore(c: DeckColumn): number {
  const rank = rankOf(c);
  if (rank) return RANK_ORDER.indexOf(rank);
  const top = c.result.match(/(?:TOP|ベスト)\s*(\d+)/i);
  return top ? Number(top[1]) : Number.MAX_SAFE_INTEGER;
}

/** 大会の種類の並び順（同じ日付・同じ成績なら シティリーグ → ジムバトル） */
const EVENT_TYPE_ORDER: Record<EventType, number> = { city: 0, gym: 1 };

/**
 * デッキ記事の並び順（コラム一覧・トップページの特集で共通）
 * - 大会の記事（シティリーグ・ジムバトル）：開催日が新しい順 → 成績の高い順 → シティリーグ → ジムバトル → 公開日が新しい順 → deck-columns.json の掲載順
 * - 環境まとめの記事（大会の種類がないもの）：大会の記事のあと、一覧の最後にまとめて、公開日が新しい順 → deck-columns.json の掲載順
 * 開催日は YYYY-MM-DD で比べるため、12月 → 1月のように年をまたいでも正しく並ぶ（eventDate() が年を補う）
 */
export function sortColumnsByEvent<T extends DeckColumn>(columns: readonly T[]): T[] {
  return columns
    .map((c, order) => ({ c, order, type: eventTypeOf(c), date: eventDate(c) }))
    .sort((a, b) => {
      if (!a.type || !b.type) return Number(!a.type) - Number(!b.type) || b.c.pubDate.localeCompare(a.c.pubDate) || a.order - b.order;
      return (
        b.date.localeCompare(a.date) ||
        rankScore(a.c) - rankScore(b.c) ||
        EVENT_TYPE_ORDER[a.type] - EVENT_TYPE_ORDER[b.type] ||
        b.c.pubDate.localeCompare(a.c.pubDate) ||
        a.order - b.order
      );
    })
    .map(({ c }) => c);
}

/**
 * トップページの「最新大会入賞デッキ特集」。deck-columns.json のシティリーグ・ジムバトル入賞デッキを、コラム一覧と同じ並び順
 * （sortColumnsByEvent）で並べて先頭から選ぶ（type を渡すとその大会だけ）。新しい大会のデッキが追加されれば、次のビルドで自動的に特集が切り替わる。
 * 同じ系統のデッキは1件だけ載せる
 */
export function latestEventDecks(limit = 6, type?: EventType): { title: string; date: string; columns: DeckColumn[] } {
  const sorted = sortColumnsByEvent(DECK_COLUMNS.filter((c) => isEventPlacing(c) && (!type || eventTypeOf(c) === type)));
  const seen = new Set<string>();
  const columns = sorted.filter((c) => !seen.has(deckBase(c)) && seen.add(deckBase(c))).slice(0, limit);
  const date = sorted[0] ? eventDate(sorted[0]) : '';
  return { title: `最新大会入賞デッキ特集（シティ＆ジムバ）${date ? `・${shortDate(date)}更新` : ''}`, date, columns };
}
