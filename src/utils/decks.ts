// デッキ解説コラムのレシピ（src/data/official-decks.json）と cards.json の価格を組み合わせる処理
import officialDecks from '../data/official-decks.json';
import { bestOffer, type Card } from './cards';
import { DECK_COLUMNS, type DeckColumn } from '../data/deck-columns';

export type RecipeEntry = { name: string; qty: number; category: string; cardId?: string; note?: string; officialCardId: string };
export type OfficialDeck = { deckId: string; url: string; cards: RecipeEntry[] };

export function getRecipe(deckKey: string): OfficialDeck {
  const deck = (officialDecks as Record<string, OfficialDeck>)[deckKey];
  if (!deck) throw new Error(`src/data/official-decks.json に「${deckKey}」がありません（npm run import-decks で取り込む）`);
  return deck;
}

/** 60枚の概算（掲載カードのうち在庫のあるカードの最安値 × 枚数。基本エネルギー等は含まない） */
export function deckEstimate(deckKey: string, cards: Card[]): number {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return getRecipe(deckKey).cards.reduce((sum, e) => {
    const card = e.cardId ? byId.get(e.cardId) : undefined;
    const offer = card ? bestOffer(card) : null;
    return sum + (offer ? offer.price * e.qty : 0);
  }, 0);
}

/** レシピ内のカード名から、そのカード（同名が複数あれば最初の版）を返す */
export function recipeCard(deckKey: string, name: string, cards: Card[]): Card | undefined {
  const entry = getRecipe(deckKey).cards.find((e) => e.name === name && e.cardId);
  return entry ? cards.find((c) => c.id === entry.cardId) : undefined;
}

/** 「低予算」とみなす60枚の概算の上限（円） */
export const BUDGET_LIMIT = 5000;

export type DeckCategory = 'mega' | 'ex' | 'budget';

/** 一覧のフィルター（コラム一覧のタブ・URL の ?filter= に使う） */
export const DECK_FILTERS: { key: DeckCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'mega', label: 'メガシンカ' },
  { key: 'ex', label: 'exアタッカー' },
  { key: 'budget', label: '非ex / 低予算' },
];

/**
 * デッキ解説の一覧表示用の情報（主役のカード・60枚の概算・カテゴリ・バッジ）。
 * カテゴリは主役のカード（keyCards の先頭）と概算から自動で決める:
 *   メガシンカ = 主役が「メガ〇〇ex」、exアタッカー = 主役がそれ以外の ex、非ex / 低予算 = 主役が ex でない、または概算が BUDGET_LIMIT 円未満
 */
export function deckSummary(column: { deckKey: string; keyCards: string[] }, cards: Card[]) {
  const mainCard = recipeCard(column.deckKey, column.keyCards[0], cards);
  const mainName = mainCard?.data.name ?? column.keyCards[0] ?? '';
  const estimate = deckEstimate(column.deckKey, cards);
  const isEx = /ex$/.test(mainName);
  const isMega = isEx && mainName.startsWith('メガ');
  const isBudget = !isEx || (estimate > 0 && estimate < BUDGET_LIMIT);
  const categories: DeckCategory[] = [...(isMega ? ['mega' as const] : isEx ? ['ex' as const] : []), ...(isBudget ? ['budget' as const] : [])];
  const badges = [isMega ? 'メガシンカ' : isEx ? 'exアタッカー' : '非ex', ...(isEx && isBudget ? ['低予算'] : [])];
  return { mainCard, estimate, categories, badges };
}

/** バッジの配色（サイト全体の配色に合わせ、紫は使わない） */
export function deckBadgeClass(badge: string): string {
  return (
    {
      メガシンカ: 'bg-gradient-to-r from-rose-600 to-orange-500 text-slate-100',
      exアタッカー: 'bg-blue-600 text-slate-100',
      非ex: 'bg-emerald-600 text-slate-100',
      低予算: 'bg-emerald-500/15 text-emerald-300',
    }[badge] ?? 'bg-slate-700 text-slate-300'
  );
}

/**
 * このカード（cards.json の id）を採用しているデッキ解説と採用枚数（新しい記事順）。
 * レシピがリンクしている版と同じ id だけを数える（同名でも効果の違うカードがあるため、名前では照合しない）
 */
export function decksUsingCard(cardId: string): { column: DeckColumn; qty: number }[] {
  return DECK_COLUMNS.map((column, order) => ({
    column,
    order,
    qty: getRecipe(column.deckKey).cards.filter((e) => e.cardId === cardId).reduce((sum, e) => sum + e.qty, 0),
  }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.column.pubDate.localeCompare(a.column.pubDate) || a.order - b.order)
    .map(({ column, qty }) => ({ column, qty }));
}
