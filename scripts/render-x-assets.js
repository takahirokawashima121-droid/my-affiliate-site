// public/generate-assets.html の X 用画像（アイコン・ヘッダー・サイト紹介バナー）を PNG に書き出す。
// Web フォント（Noto Sans JP・M PLUS Rounded 1c）が読み込めたことを確かめてから書き出し、読めなければ止める。
// Playwright（Chromium）が必要。プロジェクトの依存には入れていないので、使うときだけ入れる:
//   npm install --no-save playwright && node scripts/render-x-assets.js [--scale=2] [--out=.cache/x-assets]
// 書き出すもの: icon / header / banner と、確認用の icon-circle（丸く切り抜いた見え方）・header-guide（アイコンの位置などの目安）
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const scale = Number(arg('scale', '2'));
const outDir = resolve(root, arg('out', '.cache/x-assets'));

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
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  // Google Fonts は Node の fetch で取ってブラウザに渡す（プロキシの証明書をブラウザが信頼しない環境でも読めるように）
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const res = await fetch(route.request().url(), { headers: { 'user-agent': await page.evaluate(() => navigator.userAgent) } });
    await route.fulfill({
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? '', 'access-control-allow-origin': '*' },
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
  await page.goto(pathToFileURL(join(root, 'public/generate-assets.html')).href, { waitUntil: 'networkidle' });
  const fontsOk = await page.evaluate(() => window.xAssets.ready);
  if (!fontsOk) {
    const status = await page.textContent('#font-status');
    throw new Error(`Web フォントを読み込めませんでした。ネットワークを確認してください。\n${status}`);
  }
  console.log(await page.textContent('#font-status'));

  await mkdir(outDir, { recursive: true });
  const jobs = [
    ['icon', 'pokeca-factory-icon', false],
    ['iconCircle', 'pokeca-factory-icon-circle', false],
    ['header', 'pokeca-factory-header', false],
    ['banner', 'pokeca-factory-banner', false],
    ['header', 'pokeca-factory-header-guide', true],
  ];
  for (const [name, file, guides] of jobs) {
    const dataUrl = await page.evaluate(([n, s, g]) => window.xAssets.toDataURL(n, s, g), [name, scale, guides]);
    const path = join(outDir, `${file}@${scale}x.png`);
    await writeFile(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`保存しました: ${path}`);
  }
} finally {
  await browser.close();
}
