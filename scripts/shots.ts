// README screenshots. Desktop title and a phone-sized flight with the fake microphone.
// Usage: node --experimental-strip-types scripts/shots.ts [base-url]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = process.argv[2] ?? 'https://hum-pilot.pages.dev';
const OUT = resolve('docs/screenshots');
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve('../video/node_modules/playwright/index.mjs')).href);
const wav = resolve('test/fixtures/flight-warm.wav');
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'];

const browser = await chromium.launch({ channel: 'msedge', args });
// Desktop title + the testing section
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(BASE);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/title.png` });
  await page.locator('#tests').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.locator('#tests').screenshot({ path: `${OUT}/testing.png` });
  await page.close();
}
// Phone: title, warm-up, flight, result
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(String(e)));
  await page.goto(`${BASE}/?seed=e2e&gates=12`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phone-title.png` });
  await page.click('[data-act=fly]');
  await page.waitForFunction(() => (window as any).__hum.calibStep === 'high', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/phone-warmup.png` });
  await page.waitForFunction(() => (window as any).__hum.flightT > 7, null, { timeout: 30000 });
  await page.screenshot({ path: `${OUT}/phone-flight.png` });
  await page.waitForFunction(() => (window as any).__hum.mode === 'result', null, { timeout: 40000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/phone-result.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(JSON.stringify({ threaded: await page.evaluate(() => (window as any).__hum.threaded), overflow, errors }));
  await ctx.close();
}
await browser.close();
