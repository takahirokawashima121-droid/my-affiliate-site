import { getCollection, type CollectionEntry } from 'astro:content';

export type Card = CollectionEntry<'cards'>;

/** 表示で使うレアリティの並び順（ここにないものは末尾） */
const RARITY_ORDER = ['UR', 'SSR', 'SAR', 'HR', 'SR', 'SA', 'AR', 'CHR', 'RRR', 'RR', 'R', 'U', 'C', 'PROMO'];

export async function getCards(): Promise<Card[]> {
  const cards = await getCollection('cards');
  return cards.sort((a, b) => b.data.updatedAt.valueOf() - a.data.updatedAt.valueOf());
}

export function getRarities(cards: Card[]): string[] {
  const rank = (r: string) => (RARITY_ORDER.includes(r) ? RARITY_ORDER.indexOf(r) : RARITY_ORDER.length);
  return [...new Set(cards.map((c) => c.data.rarity))].sort((a, b) => rank(a) - rank(b));
}

/** カード詳細ページのパス */
export function cardPath(card: Card): string {
  return `/cards/${card.id}/`;
}

/** 「ナンジャモ SAR（SV2D 096/071）」形式の表示名（同名カードの区別用） */
export function cardLabel(card: Card): string {
  const { name, rarity, modelNumber } = card.data;
  return `${name} ${rarity}（${modelNumber}）`;
}

const RARITY_STYLES: Record<string, string> = {
  UR: 'bg-gradient-to-r from-amber-400 to-yellow-300 text-amber-950',
  SAR: 'bg-gradient-to-r from-amber-400 via-pink-400 to-violet-400 text-white',
  SSR: 'bg-gradient-to-r from-slate-700 to-slate-500 text-amber-200',
  SR: 'bg-violet-600 text-white',
  SA: 'bg-violet-600 text-white',
  AR: 'bg-teal-600 text-white',
  HR: 'bg-amber-500 text-white',
};

/** レアリティバッジの配色クラス */
export function rarityClass(rarity: string): string {
  return RARITY_STYLES[rarity] ?? 'bg-slate-600 text-white';
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
