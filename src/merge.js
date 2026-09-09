// Combines every discovery channel into one crawl list, capped so the corpus
// favors breadth of platforms over depth on any single company.
import fs from 'node:fs/promises';

const read = async (p) => JSON.parse(await fs.readFile(p, 'utf8').catch(() => '[]'));

const seeds = await read('data/seeds.json');
const siteTargets = await read('data/site-targets.json');
const tenants = await read('data/tenants.json');
const tenantTargetsCrawled = await read('data/tenant-targets.json');

// Probed tenants have no job URL yet; the crawler resolves the board itself.
const tenantTargets = tenants.map((t) => ({
  ats: t.platform,
  atsLabel: t.platform,
  board: t.slug,
  company: t.slug,
  title: 'Software Engineer',
  location: '',
  jobUrl: t.url,
  applyUrl: t.url,
  source: 'tenant-probe',
}));

// Breadth beats depth: ~10 forms per source is enough to characterize a
// platform's form style, so the budget is a corpus-wide ceiling rather than a
// per-run one. Already-captured forms count against it, which starves the
// vendors we have over-sampled and spends every new run on thin platforms.
const PER_PLATFORM = Number(process.env.PER_PLATFORM || 10);
const PER_COMPANY = Number(process.env.PER_COMPANY || 2);

const already = new Map();
for (const f of await fs.readdir('data/forms').catch(() => [])) {
  if (!f.endsWith('.json')) continue;
  const rec = JSON.parse(await fs.readFile(`data/forms/${f}`, 'utf8').catch(() => 'null'));
  if (!rec?.isApplicationForm) continue;
  for (const key of new Set([rec.seed?.ats, rec.platform].filter(Boolean))) {
    already.set(key, (already.get(key) || 0) + 1);
  }
}

const all = [...seeds, ...siteTargets, ...tenantTargetsCrawled, ...tenantTargets];
const seenUrl = new Set();
const perPlatform = new Map(already);
const perCompany = new Map();
const kept = [];

// Interleave sources so the per-platform cap is not spent on whichever
// channel happens to come first.
all.sort((a, b) => String(a.ats).localeCompare(String(b.ats)));

// On a multi-tenant ATS the per-company cap keeps one employer from spending
// the platform's whole budget. On an in-house career site the platform *is* the
// company, so that cap would pointlessly starve it -- let those fill up.
const companiesPerPlatform = new Map();
for (const t of all) {
  if (!t.jobUrl) continue;
  const set = companiesPerPlatform.get(t.ats) || companiesPerPlatform.set(t.ats, new Set()).get(t.ats);
  set.add(t.company);
}

for (const t of all) {
  if (!t.jobUrl || seenUrl.has(t.jobUrl)) continue;
  const p = perPlatform.get(t.ats) || 0;
  const c = perCompany.get(t.company) || 0;
  const companyCap = companiesPerPlatform.get(t.ats)?.size === 1 ? PER_PLATFORM : PER_COMPANY;
  if (p >= PER_PLATFORM || c >= companyCap) continue;
  seenUrl.add(t.jobUrl);
  perPlatform.set(t.ats, p + 1);
  perCompany.set(t.company, c + 1);
  kept.push(t);
}

// Round-robin the final list across platforms. Consecutive targets then hit
// different hosts, which keeps eight parallel browsers from dogpiling one
// employer and spreads any rate limiting across the whole run.
const queues = new Map();
for (const t of kept) {
  const q = queues.get(t.ats) || queues.set(t.ats, []).get(t.ats);
  q.push(t);
}
const interleaved = [];
while (queues.size) {
  for (const [ats, q] of [...queues.entries()]) {
    interleaved.push(q.shift());
    if (!q.length) queues.delete(ats);
  }
}

await fs.writeFile('data/targets.json', JSON.stringify(interleaved, null, 2));
const bySrc = {};
for (const k of kept) bySrc[k.source || 'api'] = (bySrc[k.source || 'api'] || 0) + 1;
const newPerPlatform = {};
for (const k of kept) newPerPlatform[k.ats] = (newPerPlatform[k.ats] || 0) + 1;
console.log(`${kept.length} new targets across ${Object.keys(newPerPlatform).length} platforms (cap ${PER_PLATFORM}/source)`, bySrc);
console.log(
  Object.entries(newPerPlatform)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:+${v}(have ${already.get(k) || 0})`)
    .join(' ')
);
const maxed = [...already.entries()].filter(([, n]) => n >= PER_PLATFORM);
if (maxed.length) console.log(`at cap, no new targets: ${maxed.map(([k, n]) => `${k}(${n})`).join(' ')}`);
