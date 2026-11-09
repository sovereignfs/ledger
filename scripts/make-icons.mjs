// Draws the app's icons as PNG from `public/icons/icon.svg`, with the browser the tests already use (`pnpm exec playwright install chromium` once):
//
//   node scripts/make-icons.mjs
//
// The installable app (DESIGN.md §14.6) needs PNGs of 192 and 512 pixels, one the platform may cut to its own shape (the picture in the middle 80%, on the page's own
// colour all the way out), and one for an iPhone's home screen. The PNGs are committed; this is how they were made, so that they can be made again.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..', 'public', 'icons');
const svg = readFileSync(resolve(root, 'icon.svg'), 'utf8');
const BACKGROUND = '#18181b';

const browser = await chromium.launch();
const page = await browser.newPage();
async function draw(name, size, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // The picture is the svg inline; a maskable icon has it at 80% on the colour of its own background, so that a platform's cut never takes any of it.
  const inner = maskable ? Math.round(size * 0.8) : size;
  await page.setContent(
    `<!doctype html><body style="margin:0;background:${maskable ? BACKGROUND : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">` +
      svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `) +
      '</body>',
  );
  writeFileSync(
    resolve(root, name),
    await page.screenshot({ omitBackground: !maskable, type: 'png' }),
  );
}
await draw('icon-192.png', 192);
await draw('icon-512.png', 512);
await draw('maskable-512.png', 512, { maskable: true });
await draw('apple-touch-icon.png', 180);
await browser.close();
