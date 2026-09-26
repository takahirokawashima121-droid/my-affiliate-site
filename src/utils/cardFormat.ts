// カードの表示名・型番・検索キーワードの組み立て
// サイト（Astro）と scripts/update-prices.js の両方から使うため、astro:content には依存しない

export type CardIdentity = {
  name: string; // 正式名称（例: "ナンジャモ"）
  rarity: string; // レアリティ（例: "SAR"）
  cardNumber: string; // カード番号（例: "096/071"）
  expansionCode: string; // 収録弾の略称記号（例: "SV2D"）
};

/** 型番（例: "SV2D 096/071"） */
export function modelCode({ expansionCode, cardNumber }: Pick<CardIdentity, 'expansionCode' | 'cardNumber'>): string {
  return `${expansionCode} ${cardNumber}`;
}

/** 表示名（例: "ナンジャモ SAR [SV2D 096/071]"）。見出し・<title>・パンくず等で使う */
export function cardDisplayName(card: CardIdentity): string {
  return `${card.name} ${card.rarity} [${modelCode(card)}]`;
}

/** 楽天API・モール検索用のキーワード（例: "ナンジャモ SAR 096/071 ポケカ"） */
export function cardSearchKeyword({ name, rarity, cardNumber }: Pick<CardIdentity, 'name' | 'rarity' | 'cardNumber'>): string {
  return `${name} ${rarity} ${cardNumber} ポケカ`;
}
