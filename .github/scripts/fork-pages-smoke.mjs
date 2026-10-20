import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || path.resolve('target/pages-smoke/node_modules/playwright/index.mjs')));
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error); });
page.on('console', message => {
  if (message.type() === 'error') console.error(message.text());
});
const output = process.env.SCREENSHOTS || 'target/pages-evidence';
await mkdir(output, { recursive: true });

try {
  await page.goto(process.env.SITE_URL || 'http://127.0.0.1:8781/?webgl');
  console.log('Page opened; waiting for the SolidCraft command API.');
  await page.waitForFunction(() => !!window.solidcraft && !document.getElementById('solidcraft_loading'), null, { timeout: 240_000 });
  console.log('SolidCraft is ready.');
  const request = (method, params) => page.evaluate(([method, params]) => window.solidcraft.request(method, params), [method, params]);
  await request('ui.home', { open: false });
  await request('engine.execute', { command: 'sketch.create', params: { plane: 'XY' } });
  for (const language of ['en', 'ru']) {
    const prefs = await request('ui.prefs', { open: 'General', language, theme: 'light' });
    assert.equal(prefs.language, language);
    // Fonts are applied on the following frame; let the dialog animation settle too.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(output, `${language}.png`) });
    console.log(`Captured ${language}.`);
  }
  // Loading a CJK face replaces the web font definitions. Returning to Russian must
  // retain the bundled Cyrillic fallback after that asynchronous installation.
  const loaded = page.waitForResponse(response => response.url().includes('BIZUDPGothic-Regular.ttf') && response.ok());
  await request('ui.prefs', { language: 'ja' });
  await loaded;
  await page.waitForTimeout(1500);
  await request('ui.prefs', { language: 'ru' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, 'ru-after-ja.png') });
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: English, Russian, and Russian after CJK font loading.');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 15_000 }).catch(() => {});
  console.error(await page.locator('body').innerText().catch(() => 'Unable to read the failed page.'));
  throw error;
} finally {
  await browser.close();
}
