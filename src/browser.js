// A pool of real Chrome instances driven over CDP by playwright-core.
import { chromium } from 'playwright-core';

export const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1512, height: 982 },
  { width: 1366, height: 850 },
];

// Chrome's own UA string is used; we only smooth over the obvious automation tells.
const STEALTH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = window.chrome || { runtime: {} };
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
`;

export async function launchBrowser(i = 0) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: process.env.HEADED !== '1',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-position=${(i % 4) * 380},${Math.floor(i / 4) * 260}`,
    ],
  });
  const context = await browser.newContext({
    viewport: VIEWPORTS[i % VIEWPORTS.length],
    locale: 'en-US',
    timezoneId: 'America/New_York',
    deviceScaleFactor: 1,
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
  });
  await context.addInitScript(STEALTH);
  context.setDefaultTimeout(30000);
  context.setDefaultNavigationTimeout(45000);
  return { browser, context, id: i };
}

// Launches `n` browsers and hands pages to `run(page, job)` for each queued job.
export async function runWithBrowsers(jobs, n, run, onProgress) {
  const queue = [...jobs];
  const results = [];
  let done = 0;
  const workers = await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, (_, i) => launchBrowser(i))
  );
  await Promise.all(
    workers.map(async (worker) => {
      let w = worker;
      while (queue.length) {
        const job = queue.shift();

        // A browser can die mid-run -- Chrome runs out of tabs, or the process
        // is killed under memory pressure. Opening a page was outside the try
        // block, so one dead browser rejected its worker and took the whole
        // run down with it. Replace the browser instead and keep going.
        let page = await w.context.newPage().catch(() => null);
        if (!page) {
          await w.browser.close().catch(() => {});
          const fresh = await launchBrowser(w.id).catch(() => null);
          if (!fresh) {
            // This worker cannot be revived; hand the job back so another takes it.
            queue.push(job);
            return;
          }
          w = fresh;
          page = await w.context.newPage().catch(() => null);
          if (!page) {
            queue.push(job);
            return;
          }
        }

        let out;
        try {
          out = await run(page, job, w);
        } catch (err) {
          out = { ...job, ok: false, error: String(err?.message || err).slice(0, 300) };
        } finally {
          await page.close().catch(() => {});
        }
        results.push(out);
        done++;
        // The worker rides along so progress reporting can say which one finished.
        if (onProgress) onProgress(done, jobs.length, out, w);
      }
      await w.context.close().catch(() => {});
      await w.browser.close().catch(() => {});
    })
  );
  return results;
}
