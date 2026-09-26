import { getCollection, type CollectionEntry } from 'astro:content';
import { cardDisplayName, modelCode } from './cardFormat';

export type Card = CollectionEntry<'cards'>;

/** 表示で使うレアリティの並び順（ここにないものは末尾） */
const RARITY_ORDER = ['MUR', 'FUR', 'UR', 'SSR', 'SAR', 'HR', 'SR', 'SA', 'ACE', 'AR', 'CHR', 'RRR', 'RR', 'R', 'U', 'C', 'PROMO'];

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

/** 「ナンジャモ SAR [SV2D 096/071]」形式の表示名（同名カードの区別用） */
export function cardLabel(card: Card): string {
  return cardDisplayName(card.data);
}

/**
 * 販売価格と買取価格の差。
 * 買取価格が販売価格以上（逆ザヤ）の場合は、データが古い・誤っている可能性が高いため
 * valid=false とし、画面では差額・買取率の代わりに「相場確認中」と表示する。
 */
export function priceGap(card: Card): { valid: boolean; spread: number; rate: number } {
  const { salePrice, saleInStock, buybackPrice } = card.data;
  const valid = saleInStock && salePrice > 0 && buybackPrice < salePrice;
  return {
    valid,
    spread: salePrice - buybackPrice,
    rate: salePrice > 0 ? Math.round((buybackPrice / salePrice) * 100) : 0,
  };
}

/**
 * 買取価格を表示してよいか。
 * 買取価格は販売相場から算出した目安のため、販売在庫がない（販売相場がない）カードでは
 * 根拠のない数値になる。その場合は金額を出さず「要査定」と表示する。
 */
export function showsBuybackPrice(card: Card): boolean {
  return card.data.saleInStock;
}

/** 「SV2D 096/071」形式の型番 */
export function cardModel(card: Card): string {
  return modelCode(card.data);
}

const RARITY_STYLES: Record<string, string> = {
  MUR: 'bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 text-white',
  FUR: 'bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 text-white',
  UR: 'bg-gradient-to-r from-amber-400 to-yellow-300 text-amber-950',
  SAR: 'bg-gradient-to-r from-amber-400 via-pink-400 to-violet-400 text-white',
  SSR: 'bg-gradient-to-r from-slate-700 to-slate-500 text-amber-200',
  SR: 'bg-violet-600 text-white',
  SA: 'bg-violet-600 text-white',
  AR: 'bg-teal-600 text-white',
  HR: 'bg-amber-500 text-white',
  ACE: 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white',
  U: 'bg-slate-500 text-white',
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
