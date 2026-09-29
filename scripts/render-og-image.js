// scripts/assets/og-default.html を 1200×630 の PNG にして public/og-default.png に保存する。
// Playwright（Chromium）が必要。プロジェクトの依存には入れていないので、使うときだけ入れる:
//   npm install --no-save playwright && node scripts/render-og-image.js
// （Chromium がない場合は先に `npx playwright install chromium`）
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = join(root, 'scripts/assets/og-default.html');
const output = join(root, 'public/og-default.png');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright が見つかりません。`npm install --no-save playwright` を実行してから、もう一度実行してください。');
  process.exit(1);
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // Google Fonts は Node の fetch で取ってブラウザに渡す（プロキシの証明書をブラウザが信頼しない環境でも読めるように）
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const res = await fetch(route.request().url(), { headers: { 'user-agent': await page.evaluate(() => navigator.userAgent) } });
    await route.fulfill({
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? '', 'access-control-allow-origin': '*' },
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
  await page.goto(pathToFileURL(template).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Web フォント（M PLUS Rounded 1c・Noto Sans JP）が読めていないと別の書体で保存されるので止める。
  // document.fonts.check() は該当するフォントが1つもないときも true を返すので、読み込み済みの書体を数えて確かめる
  const loaded = await page.evaluate(() => {
    const families = new Set();
    document.fonts.forEach((f) => f.status === 'loaded' && families.add(f.family.replaceAll('"', '')));
    return [...families];
  });
  const missing = ['M PLUS Rounded 1c', 'Noto Sans JP'].filter((f) => !loaded.includes(f));
  if (missing.length) throw new Error(`Web フォントを読み込めませんでした: ${missing.join('、')}。ネットワークを確認してください。`);
  await page.screenshot({ path: output, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`保存しました: ${output}`);
} finally {
  await browser.close();
}
