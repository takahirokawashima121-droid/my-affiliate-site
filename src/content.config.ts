import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // アフィリエイトリンクを含む記事は true（PR表記を自動表示）
    affiliate: z.boolean().default(true),
  }),
});

// カード相場データ（src/data/cards.json）。ビルド時に項目の型・必須チェックを行う
const cards = defineCollection({
  loader: file('src/data/cards.json'),
  schema: z.object({
    name: z.string().min(1), // カードの正式名称（例: "ナンジャモ", "リーリエの全力"）。（SA）等の表記は含めない
    rarity: z.string().min(1), // レアリティ（例: "SAR", "SR"）。レアリティ記号のない再録カードは "-"
    cardNumber: z.string().regex(/^\d+\/\d+$/, 'カード番号は「096/071」の形式で入力してください'), // カード番号
    expansionCode: z.string().regex(/^[A-Za-z0-9+-]+$/, '収録弾の記号は「SV2D」「SM4+」の形式で入力してください'), // 収録弾の略称記号
    regulationMark: z.string().regex(/^[A-Z]$/, 'レギュレーションマークは「H」「I」「J」などの英大文字1字で入力してください').optional(), // カード左下のレギュレーションマーク（不明な旧弾は省略）
    imageUrl: z.string().default(''), // 画像URL（空なら仮画像を表示）
    salePrice: z.number().int().nonnegative(), // 販売最安値（円）。在庫なしの場合は 0
    saleInStock: z.boolean().default(true), // 楽天市場に在庫のある出品があるか（false なら「在庫なし」表示）
    saleShop: z.string(), // 販売ショップ名
    saleUrl: z.url(), // 販売アフィリエイトリンク
    saleImpressionUrl: z.url().optional(), // 販売側のインプレッション計測用画像（A8.net の 0.gif 等）
    // ↑ sale* は楽天市場の最安値。↓ yahoo* は Yahoo!ショッピングの最安値（scripts/update-prices.js が更新）
    yahooPrice: z.number().int().nonnegative().nullable().optional(), // 在庫のある該当商品なしは null、未取得は省略
    yahooUrl: z.string().optional(), // 商品ページURL（もしもアフィリエイト経由）。該当なしは ''
    yahooUpdatedAt: z.coerce.date().optional(), // Yahoo! の価格・リンクが変化した日時
    buybackPrice: z.number().int().nonnegative(), // 買取最高値（円）
    buybackShop: z.string(), // 買取ショップ名
    buybackUrl: z.url(), // 買取アフィリエイトリンク
    buybackImpressionUrl: z.url().optional(), // 買取側のインプレッション計測用画像
    // 予算を抑えたい人向けの代用・関連カード（cards.json 内の id。存在しない id はビルド時にエラー）
    substituteIds: z.array(z.string()).optional(),
    updatedAt: z.coerce.date(), // 更新日時
  }),
});

export const collections = { blog, cards };
