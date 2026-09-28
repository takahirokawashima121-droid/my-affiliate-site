// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// 本番URL（canonical / OGP / sitemap / RSS に使われます）
export default defineConfig({
  site: 'https://pokeca-factory.com',
  trailingSlash: 'always',
  integrations: [sitemap()],
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  redirects: {
    // カードデータ補正（正式名・カード番号の修正）に伴い変更したカード詳細ページの旧URL → 新URL
    // （転送先が現行スタンダード外で削除されたカードの場合は、下と同じ転送先に付け替え済み）
    '/cards/lillie-sr-sm11b-068/': '/',
    '/cards/umbreon-vmax-sa-s6a-095/': '/',
    '/cards/lugia-v-sa-s12-110/': '/',
    '/cards/giratina-v-sa-s11-111/': '/',
    '/cards/rayquaza-vmax-sa-s7r-085/': '/',
    '/cards/eevee-ex-sar-sv8a-213/': '/cards/eevee-ex-sar-sv8a-224/',
    '/cards/lillies-clefairy-ex-sar-sv9-124/': '/cards/lillies-clefairy-ex-sar-sv9-126/',
    '/cards/lugia-vstar-ur-s12-130/': '/',
    '/cards/terapagos-ex-sar-sv7-128/': '/cards/terapagos-ex-sar-sv7-130/',
    '/cards/ogerpon-ex-sar-sv6-129/': '/cards/ogerpon-ex-sar-sv6-125/',
    '/cards/miraidon-ex-sar-sv1v-103/': '/',
    // 現行スタンダード（H・I・J ＋公式の例外リスト）外のため削除したカードの旧URL → 同名の現行カード、なければトップ
    '/cards/nanjamo-sar-sv2d-096/': '/',
    '/cards/charizard-ex-sar-sv2a-201/': '/',
    '/cards/lugia-v-sr-s12-110/': '/',
    '/cards/mew-ex-sar-sv2a-205/': '/cards/mew-ex-fur-m6a-135/',
    '/cards/pikachu-ar-sv2a-173/': '/',
    '/cards/charizard-ex-sar-sv4a-349/': '/',
    '/cards/lillies-full-force-sr-sm11b-068/': '/',
    '/cards/umbreon-vmax-hr-s6a-095/': '/',
    '/cards/rayquaza-vmax-hr-s7r-082/': '/',
    '/cards/pikachu-zekrom-gx-sr-sm9-101/': '/',
    '/cards/nanjamo-sar-sv4a-350/': '/',
    '/cards/giratina-v-sr-s11-111/': '/',
    '/cards/erikas-invitation-sar-sv2a-206/': '/',
    '/cards/charizard-ex-sar-sv3-134/': '/',
    '/cards/charizard-vmax-ssr-s4a-308/': '/',
    '/cards/charizard-gx-ssr-sm8b-209/': '/',
    '/cards/lugia-vstar-ur-s12-123/': '/',
    '/cards/gardevoir-ex-sar-sv1s-101/': '/',
    '/cards/miraidon-ex-sar-sv1v-102/': '/',
    '/cards/koraidon-ex-sar-sv1s-103/': '/',
    '/cards/counter-catcher-sv8a-139/': '/',
    '/cards/earthen-vessel-sv8a-143/': '/',
    '/cards/nest-ball-sv4a-159/': '/',
    '/cards/bravery-charm-sv4a-169/': '/',
    '/cards/pal-pad-u-sv1s-069/': '/',
  },
  build: { inlineStylesheets: 'always' },
  vite: { plugins: [tailwindcss()] },
});
