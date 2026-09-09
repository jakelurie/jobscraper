// Opens each probed ATS tenant board in Chrome and harvests real job-detail
// URLs, since a board search page is not itself an application form.
import fs from 'node:fs/promises';
import { runWithBrowsers } from './browser.js';
import { isSeniorSWE } from './lib/util.js';

// How a job-detail link looks on each platform's board.
const JOB_LINK = {
  icims: /\/jobs\/\d+\/[\w%-]+\/job/i,
  jobvite: /jobs\.jobvite\.com\/[\w-]+\/job\/[\w-]+/i,
  avature: /\/careers\/JobDetail\/|\/JobDetail\?/i,
  taleo: /jobdetail\.ftl\?job=|\/careersection\/[^/]+\/jobdetail/i,
  successfactors: /\/job\/[\w%.-]+-\/\d+\/?$|\/job\/\d+/i,
  dayforce: /\/Posting\/View\/\d+|JobDetails/i,
  clearcompany: /\/careers\/jobs\/[\w-]{8,}/i,
  pinpoint: /\/postings\/[\w-]{8,}/i,
  jazzhr: /applytojob\.com\/apply\/[\w-]+/i,
  teamtailor: /\/jobs\/\d+/i,
  smartrecruiters: /smartrecruiters\.com\/[\w-]+\/\d{6,}/i,
};

const PER_TENANT = Number(process.env.PER_TENANT || 3);
const tenants = JSON.parse(await fs.readFile('data/tenants.json', 'utf8').catch(() => '[]'));

async function harvest(page, t) {
  const re = JOB_LINK[t.platform];
  if (!re) return { platform: t.platform, slug: t.slug, picked: [] };
  await page.goto(t.url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(2000);
    const hit = await page
      .evaluate((src) => [...document.querySelectorAll('a[href]')].some((a) => new RegExp(src, 'i').test(a.href)), re.source)
      .catch(() => false);
    if (hit) break;
    await page.mouse.wheel(0, 1500).catch(() => {});
  }
  const links = await page
    .evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((a) => ({
        href: a.href,
        text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      }))
    )
    .catch(() => []);

  const seen = new Set();
  const senior = [];
  const other = [];
  for (const l of links) {
    if (!re.test(l.href) || seen.has(l.href)) continue;
    seen.add(l.href);
    const rec = {
      ats: t.platform,
      atsLabel: t.platform,
      board: t.slug,
      company: t.slug,
      title: l.text || 'Software Engineer',
      location: '',
      jobUrl: l.href,
      applyUrl: l.href,
      source: 'tenant-crawl',
    };
    (isSeniorSWE(l.text) ? senior : other).push(rec);
  }
  return { platform: t.platform, slug: t.slug, found: seen.size, picked: [...senior, ...other].slice(0, PER_TENANT) };
}

const results = await runWithBrowsers(
  tenants,
  Number(process.env.BROWSERS || 6),
  harvest,
  (done, total, out) =>
    console.log(
      `[${String(done).padStart(3)}/${total}] ${String(out.platform).padEnd(16)} ${String(out.slug).padEnd(16)} links:${String(out.found ?? 0).padStart(3)} kept:${out.picked?.length ?? 0} ${out.error || ''}`
    )
);

const targets = results.flatMap((r) => r.picked || []);
await fs.writeFile('data/tenant-targets.json', JSON.stringify(targets, null, 2));
console.log(`\n${targets.length} job URLs from ${results.filter((r) => r.picked?.length).length}/${tenants.length} tenant boards`);
