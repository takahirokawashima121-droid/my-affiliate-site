import { getCollection, type CollectionEntry } from 'astro:content';

export type Card = CollectionEntry<'cards'>;

/** 表示で使うレアリティの並び順（ここにないものは末尾） */
const RARITY_ORDER = ['UR', 'SAR', 'SR', 'SA', 'AR', 'HR', 'CHR', 'RRR', 'RR', 'R', 'U', 'C', 'PROMO'];

export async function getCards(): Promise<Card[]> {
  const cards = await getCollection('cards');
  return cards.sort((a, b) => b.data.updatedAt.valueOf() - a.data.updatedAt.valueOf());
}

export function getRarities(cards: Card[]): string[] {
  const rank = (r: string) => (RARITY_ORDER.includes(r) ? RARITY_ORDER.indexOf(r) : RARITY_ORDER.length);
  return [...new Set(cards.map((c) => c.data.rarity))].sort((a, b) => rank(a) - rank(b));
}

export function formatYen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 最新の更新日時 */
export function latestUpdate(cards: Card[]): Date | undefined {
  return cards.reduce<Date | undefined>((max, c) => (!max || c.data.updatedAt > max ? c.data.updatedAt : max), undefined);
}
