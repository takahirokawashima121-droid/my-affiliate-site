// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// 本番URL（canonical / OGP / sitemap / RSS に使われます）
export default defineConfig({
  site: 'https://my-affiliate-site-phi.vercel.app/',
  trailingSlash: 'always',
  integrations: [sitemap()],
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  // カードデータ補正（正式名・カード番号の修正）に伴い変更したカード詳細ページの旧URL → 新URL
  redirects: {
    '/cards/lillie-sr-sm11b-068/': '/cards/lillies-full-force-sr-sm11b-068/',
    '/cards/umbreon-vmax-sa-s6a-095/': '/cards/umbreon-vmax-hr-s6a-095/',
    '/cards/lugia-v-sa-s12-110/': '/cards/lugia-v-sr-s12-110/',
    '/cards/giratina-v-sa-s11-111/': '/cards/giratina-v-sr-s11-111/',
    '/cards/rayquaza-vmax-sa-s7r-085/': '/cards/rayquaza-vmax-hr-s7r-082/',
    '/cards/eevee-ex-sar-sv8a-213/': '/cards/eevee-ex-sar-sv8a-224/',
    '/cards/lillies-clefairy-ex-sar-sv9-124/': '/cards/lillies-clefairy-ex-sar-sv9-126/',
    '/cards/lugia-vstar-ur-s12-130/': '/cards/lugia-vstar-ur-s12-123/',
    '/cards/terapagos-ex-sar-sv7-128/': '/cards/terapagos-ex-sar-sv7-130/',
    '/cards/ogerpon-ex-sar-sv6-129/': '/cards/ogerpon-ex-sar-sv6-125/',
    '/cards/miraidon-ex-sar-sv1v-103/': '/cards/miraidon-ex-sar-sv1v-102/',
  },
  build: { inlineStylesheets: 'always' },
  vite: { plugins: [tailwindcss()] },
});
