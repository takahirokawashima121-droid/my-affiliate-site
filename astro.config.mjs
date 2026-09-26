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
  build: { inlineStylesheets: 'always' },
  vite: { plugins: [tailwindcss()] },
});
