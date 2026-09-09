// Opens each Tier B listing page in Chrome and harvests senior SWE job links.
import fs from 'node:fs/promises';
import { runWithBrowsers } from './browser.js';
import { SITES } from './sites.js';
import { isSeniorSWE } from './lib/util.js';

const PER_SITE = Number(process.env.PER_SITE || 2);

async function harvest(page, site) {
  await page.goto(site.listUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // Listing pages hydrate late and often lazy-render on scroll.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1800);
    const n = await page.evaluate(() => document.querySelectorAll('a[href]').length).catch(() => 0);
    if (n > 40) break;
    await page.mouse.wheel(0, 1200).catch(() => {});
  }
  const links = await page
    .evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((a) => ({
        href: a.href,
        text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      }))
    )
    .catch(() => []);

  const re = new RegExp(site.jobLink.source, site.jobLink.flags);
  const seen = new Set();
  const senior = [];
  const other = [];
  for (const l of links) {
    if (!re.test(l.href) || seen.has(l.href)) continue;
    seen.add(l.href);
    const rec = {
      ats: site.id,
      atsLabel: site.label,
      board: site.id,
      company: site.company,
      title: l.text || 'Software Engineer',
      location: '',
      jobUrl: l.href,
      applyUrl: l.href,
      source: 'site-crawl',
    };
    (isSeniorSWE(l.text) ? senior : other).push(rec);
  }
  const picked = [...senior, ...other].slice(0, PER_SITE);
  return { site: site.id, found: seen.size, senior: senior.length, picked };
}

// `--only a,b` re-harvests just those sites; results merge into the existing
// list rather than replacing it, so one site can be topped up in isolation.
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? process.argv[onlyArg + 1].split(',') : null;
const chosen = only ? SITES.filter((s) => only.includes(s.id)) : SITES;

const results = await runWithBrowsers(
  chosen,
  Number(process.env.BROWSERS || 6),
  (page, site) => harvest(page, site),
  (done, total, out) =>
    console.log(
      `[${String(done).padStart(2)}/${total}] ${String(out.site || out.id).padEnd(16)} links:${String(out.found ?? 0).padStart(3)} senior:${String(out.senior ?? 0).padStart(3)} ${out.error || ''}`
    )
);

const fresh = results.flatMap((r) => r.picked || []);
const prior = JSON.parse(await fs.readFile('data/site-targets.json', 'utf8').catch(() => '[]'));
const kept = only ? prior.filter((t) => !only.includes(t.ats)) : [];
const seen = new Set();
const targets = [...kept, ...fresh].filter((t) => !seen.has(t.jobUrl) && seen.add(t.jobUrl));
await fs.writeFile('data/site-targets.json', JSON.stringify(targets, null, 2));
console.log(`\n${fresh.length} job URLs from ${results.filter((r) => r.picked?.length).length}/${chosen.length} sites (list now ${targets.length})`);
