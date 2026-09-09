// Builds the crawl list needed to bring every claimed platform to ten distinct
// applications. Only platforms that are short get targets, and each gets more
// attempts than it has slots because roughly half of any batch hits a wall or
// lands on a page that turns out not to be a form.
import fs from 'node:fs/promises';
import { keepIfUS } from '../src/lib/util.js';

// A record may be mid-write by a crawl running alongside this tool; a partial
// file is skipped rather than allowed to abort the whole pass.
async function readRecord(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

const TARGET = Number(process.env.TARGET || 10);
const OVERSHOOT = Number(process.env.OVERSHOOT || 2.5);

const read = async (p) => JSON.parse(await fs.readFile(p, 'utf8').catch(() => '[]'));

const recs = [];
for (const f of await fs.readdir('data/forms').catch(() => [])) {
  if (!f.endsWith('.json')) continue;
  const r = await readRecord(`data/forms/${f}`);
  if (r) recs.push(r);
}
// Depth counts distinct applications, so duplicates do not pay down the deficit.
const have = new Map();
for (const r of recs.filter((x) => x.isApplicationForm && !x.duplicateOfSameForm && !x.nonUS && !x.overCap)) {
  have.set(r.platform, (have.get(r.platform) || 0) + 1);
}
// Anything already visited is not worth spending an attempt on again.
const visited = new Set(recs.map((r) => r.seed?.startUrl).filter(Boolean));

const pools = [
  ...(await read('data/topup-targets.json')),
  ...(await read('data/enterprise-targets.json')),
  ...(await read('data/site-targets.json')),
  ...(await read('data/seeds.json')),
];

// A capture is filed under a platform, but targets are labelled with the seed's
// `ats`, and the two diverge whenever an employer white-labels the vendor's
// hostname (deshaw, shopify). The corpus already records which seed produced
// which platform, so read the mapping off it rather than guessing.
const atsFor = new Map();
for (const r of recs) {
  const a = String(r.seed?.ats || '').toLowerCase();
  if (!a || !r.platform) continue;
  const set = atsFor.get(r.platform) || atsFor.set(r.platform, new Set()).get(r.platform);
  set.add(a);
}
// One seed source can land in several platforms (an iCIMS seed sometimes ends
// up on the employer's own site), so keep every platform a seed has produced
// and spend the target against whichever of them still needs depth.
const platformsOfAts = new Map();
for (const [platform, all] of atsFor) {
  for (const a of all) {
    const set = platformsOfAts.get(a) || platformsOfAts.set(a, new Set()).get(a);
    set.add(platform);
  }
}
// Prefer the platform whose name is the seed source itself; that is the vendor
// the target was discovered on and where it will almost certainly be filed.
const candidatesFor = (a) => {
  const set = platformsOfAts.get(a);
  if (!set) return [a];
  return [...set].sort((x, y) => (x === a ? -1 : y === a ? 1 : 0));
};

const deficit = new Map();
for (const [p, n] of have) if (n < TARGET) deficit.set(p, TARGET - n);
// Platforms we hold zero forms for are not "claimed" yet; breadth work covers
// those separately, so this only tops up what we already have a footing on.

const budget = new Map();
for (const [p, d] of deficit) budget.set(p, Math.ceil(d * OVERSHOOT));

const seen = new Set();
const picked = [];
for (const t of pools) {
  const a = String(t.ats || '').toLowerCase();
  const p = candidatesFor(a).find((c) => budget.get(c) > 0);
  if (!p) continue;
  const url = t.applyUrl || t.jobUrl;
  if (!url || seen.has(url) || visited.has(url)) continue;
  // United States only. Postings whose location the board never stated are
  // still worth a try -- many boards omit it on the listing page -- but an
  // explicitly foreign one is skipped outright.
  if (!keepIfUS(t.location || '', t.title || '')) continue;
  seen.add(url);
  budget.set(p, budget.get(p) - 1);
  picked.push({ ...t, forPlatform: p });
}

await fs.writeFile('data/topup-crawl.json', JSON.stringify(picked, null, 2));
const by = {};
for (const t of picked) by[t.forPlatform] = (by[t.forPlatform] || 0) + 1;
console.log('current depth:', Object.fromEntries([...have].sort((a, b) => b[1] - a[1])));
console.log(`\nshort on ${deficit.size} platforms, ${[...deficit.values()].reduce((a, b) => a + b, 0)} slots`);
console.log(`${picked.length} attempts queued:`, by);
const dry = [...deficit.keys()].filter((p) => !by[p]);
if (dry.length) console.log(`no untried postings available for: ${dry.join(', ')}`);
