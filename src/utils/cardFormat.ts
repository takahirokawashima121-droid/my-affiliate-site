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

/** カード名＋レアリティ（例: "ナンジャモ SAR"）。レアリティ記号のない再録カード（rarity "-"）はカード名のみ */
export function nameWithRarity({ name, rarity }: Pick<CardIdentity, 'name' | 'rarity'>): string {
  return rarity === '-' ? name : `${name} ${rarity}`;
}

/** 表示名（例: "ナンジャモ SAR [SV2D 096/071]"、"ハイパーボール [SV4a 161/190]"）。見出し・<title>・パンくず等で使う */
export function cardDisplayName(card: CardIdentity): string {
  return `${nameWithRarity(card)} [${modelCode(card)}]`;
}

/**
 * キーワードに入れるレアリティ。楽天APIは1文字の半角語を含むキーワードを「keyword is not valid」で拒否するため、
 * 「U」「C」「R」など1文字のレアリティは含めない（カード名＋番号で十分に特定できる）
 */
const rarityWord = (rarity: string) => (rarity.length >= 2 ? ` ${rarity}` : '');

/** 楽天API・モール検索用のキーワード（例: "ナンジャモ SAR 096/071 ポケカ"、"なかよしポフィン 063/071 ポケカ"） */
export function cardSearchKeyword({ name, rarity, cardNumber }: Pick<CardIdentity, 'name' | 'rarity' | 'cardNumber'>): string {
  return `${name}${rarityWord(rarity)} ${cardNumber} ポケカ`;
}

/**
 * 楽天APIの検索キーワード候補（該当商品が見つからなければ次の候補で再検索する）
 * 1. "ナンジャモ SAR 096/071 ポケカ"
 * 2. "ナンジャモ SAR 096/071"（「ポケカ」を含まない出品タイトル向け）
 * 3. "ナンジャモ 096/071"（レアリティ表記が異なる・省略された出品タイトル向け）
 */
export function cardSearchKeywords(card: Pick<CardIdentity, 'name' | 'rarity' | 'cardNumber'>): string[] {
  const { name, rarity, cardNumber } = card;
  // 1文字レアリティのカードは 2 と 3 が同じになるため重複を除く
  return [...new Set([cardSearchKeyword(card), `${name}${rarityWord(rarity)} ${cardNumber}`, `${name} ${cardNumber}`])];
}
