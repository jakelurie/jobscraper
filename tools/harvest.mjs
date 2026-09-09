// Collects many distinct postings from a board, so depth can be filled with ten
// different applications rather than the same one reached ten ways.
//
// The tenant probes only ever kept a single posting per board, which is why the
// enterprise platforms stalled at two or three forms. This opens each board in a
// real browser and takes the top N engineering-ish postings it links to.
import fs from 'node:fs/promises';
import { runWithBrowsers } from '../src/browser.js';
import { findJobLinks } from '../src/board.js';

const boards = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const PER_BOARD = Number(process.env.PER_BOARD || 6);
const out = process.argv[3] || 'data/topup-targets.json';

async function harvest(page, board) {
  await page.goto(board.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  // Listings hydrate late and often need a nudge to render past the first rows.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500);
    const links = await findJobLinks(page, 'engineer');
    if (links.length >= PER_BOARD) break;
    await page.mouse.wheel(0, 1400).catch(() => {});
  }
  const links = await findJobLinks(page, 'engineer');
  const picked = links.slice(0, PER_BOARD).map((l) => ({
    ats: board.platform,
    atsLabel: board.platform,
    board: board.slug,
    company: board.slug,
    title: l.text || 'Software Engineer',
    location: '',
    jobUrl: l.href,
    applyUrl: l.href,
    source: 'board-harvest',
  }));
  return { platform: board.platform, slug: board.slug, found: links.length, picked };
}

const results = await runWithBrowsers(boards, Number(process.env.BROWSERS || 6), harvest, (done, total, out) =>
  console.log(
    `[${String(done).padStart(2)}/${total}] ${String(out.platform || '?').padEnd(16)} ${String(out.slug || '').padEnd(20)} ` +
      `links:${String(out.found ?? 0).padStart(3)} kept:${String(out.picked?.length ?? 0).padStart(2)} ${out.error || ''}`
  )
);

const targets = results.flatMap((r) => r.picked || []);
const seen = new Set();
const unique = targets.filter((t) => !seen.has(t.jobUrl) && seen.add(t.jobUrl));
await fs.writeFile(out, JSON.stringify(unique, null, 2));
const by = {};
for (const t of unique) by[t.ats] = (by[t.ats] || 0) + 1;
console.log(`\n${unique.length} postings harvested ->  ${out}`);
console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
