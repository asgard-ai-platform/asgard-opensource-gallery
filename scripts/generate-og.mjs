import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'og-template.html');
const OUT_DIR = path.join(ROOT, 'public');
const LANGS = ['en', 'zh'];

if (!fs.existsSync(TEMPLATE)) {
  console.error(`Template not found: ${TEMPLATE}`);
  process.exit(1);
}

console.log('Launching headless Chromium...');
const browser = await chromium.launch();

try {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const url = `file://${TEMPLATE}?lang=${lang}`;
    console.log(`[${lang}] Loading ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });

    // Wait for fonts to be ready
    await page.evaluate(() => document.fonts.ready);
    // Small extra delay to make sure all background SVGs paint
    await page.waitForTimeout(300);

    const outPath = path.join(OUT_DIR, `og-image-${lang}.png`);
    await page.screenshot({
      path: outPath,
      omitBackground: false,
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });

    const stat = fs.statSync(outPath);
    console.log(`[${lang}] Wrote ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`);

    await context.close();
  }
} finally {
  await browser.close();
}

console.log('Done.');
