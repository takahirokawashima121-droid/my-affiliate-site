// デッキ解説コラムのレシピ（src/data/official-decks.json）と cards.json の価格を組み合わせる処理
import officialDecks from '../data/official-decks.json';
import { bestOffer, type Card } from './cards';

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
