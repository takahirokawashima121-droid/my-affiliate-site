import { getCollection, type CollectionEntry } from 'astro:content';
import { cardDisplayName, modelCode } from './cardFormat';
import { STANDARD_EXEMPT_NAMES, STANDARD_REGULATIONS } from '../consts';

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

/** 公式の例外リストにより、レギュレーションマークに関わらずスタンダードで使えるカードか */
export function isStandardExempt(card: Card): boolean {
  return STANDARD_EXEMPT_NAMES.includes(card.data.name);
}

/** 現在のスタンダードレギュレーションで使えるカードか（マークが H・I・J 等、または公式の例外リストのカード） */
export function isStandardLegal(card: Card): boolean {
  const mark = card.data.regulationMark;
  return (mark !== undefined && (STANDARD_REGULATIONS as readonly string[]).includes(mark)) || isStandardExempt(card);
}

/** カード名の後ろに付けるレアリティ（レアリティ記号のない再録カード「-」は付けない） */
export function hasRarityMark(rarity: string): boolean {
  return rarity !== '-';
}

/** 同じカード名の別バージョン（別レアリティ・別の弾）を、販売価格の安い順に返す（在庫なしは最後） */
export function sameNameVariants(card: Card, cards: Card[]): Card[] {
  const price = (c: Card) => (c.data.saleInStock ? c.data.salePrice : Infinity);
  return cards.filter((c) => c.id !== card.id && c.data.name === card.data.name).sort((a, b) => price(a) - price(b));
}

/**
 * 同じカード名が複数登録されている場合に、在庫ありで販売価格が最も安いカードの ID の集合を返す。
 * 一覧で「最安版」バッジを付けるために使う（同名でも弾によって効果が異なる場合がある点に注意）。
 */
export function cheapestVariantIds(cards: Card[]): Set<string> {
  const groups = new Map<string, Card[]>();
  for (const c of cards) groups.set(c.data.name, [...(groups.get(c.data.name) ?? []), c]);
  const ids = new Set<string>();
  for (const group of groups.values()) {
    const inStock = group.filter((c) => c.data.saleInStock && c.data.salePrice > 0);
    if (group.length < 2 || inStock.length === 0) continue;
    ids.add(inStock.reduce((min, c) => (c.data.salePrice < min.data.salePrice ? c : min)).id);
  }
  return ids;
}

/** 「SV2D 096/071」形式の型番 */
export function cardModel(card: Card): string {
  return modelCode(card.data);
}

// ポケモンらしいキーカラー（イエロー / レッド / ブルー）を軸にした、紫を使わない配色。
// 白文字のバッジは -500 以上の濃さにして読みやすさを確保する
const RARITY_STYLES: Record<string, string> = {
  MUR: 'bg-gradient-to-r from-red-500 via-amber-400 to-sky-500 text-white [text-shadow:0_1px_1px_rgb(0_0_0/0.35)]',
  FUR: 'bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 text-white',
  UR: 'bg-gradient-to-r from-amber-300 to-yellow-400 text-amber-950',
  SAR: 'bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white',
  SSR: 'bg-gradient-to-r from-slate-700 to-slate-500 text-amber-200',
  HR: 'bg-amber-500 text-white',
  SR: 'bg-blue-600 text-white',
  SA: 'bg-blue-600 text-white',
  ACE: 'bg-gradient-to-r from-red-600 to-rose-500 text-white',
  AR: 'bg-teal-600 text-white',
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
