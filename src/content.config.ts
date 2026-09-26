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
    name: z.string(), // カード名
    modelNumber: z.string(), // 型番
    rarity: z.string(), // レアリティ
    imageUrl: z.string().default(''), // 画像URL（空なら仮画像を表示）
    salePrice: z.number().int().nonnegative(), // 販売最安値（円）
    saleShop: z.string(), // 販売ショップ名
    saleUrl: z.url(), // 販売アフィリエイトリンク
    buybackPrice: z.number().int().nonnegative(), // 買取最高値（円）
    buybackShop: z.string(), // 買取ショップ名
    buybackUrl: z.url(), // 買取アフィリエイトリンク
    updatedAt: z.coerce.date(), // 更新日時
  }),
});

export const collections = { blog, cards };
