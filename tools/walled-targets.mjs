// Collects the captures that never reached a real form, so a second pass can
// retry them with account registration enabled. Each platform is only topped up
// to the corpus cap, so this cannot overshoot the 10-per-source budget.
import fs from 'node:fs/promises';

const CAP = Number(process.env.PER_PLATFORM || 10);
const records = [];
for (const f of await fs.readdir('data/forms').catch(() => [])) {
  if (!f.endsWith('.json')) continue;
  const r = JSON.parse(await fs.readFile(`data/forms/${f}`, 'utf8').catch(() => 'null'));
  if (r) records.push(r);
}

const reached = new Map();
for (const r of records.filter((x) => x.isApplicationForm)) {
  reached.set(r.platform, (reached.get(r.platform) || 0) + 1);
}

const budget = new Map();
const targets = [];
for (const r of records.filter((x) => !x.isApplicationForm)) {
  const key = r.platform;
  const have = reached.get(key) || 0;
  const taken = budget.get(key) || 0;
  if (have + taken >= CAP) continue;
  budget.set(key, taken + 1);
  targets.push({ ...r.seed, applyUrl: r.seed.startUrl, jobUrl: r.seed.jobUrl || r.seed.startUrl });
}

await fs.writeFile('data/walled-targets.json', JSON.stringify(targets, null, 2));
const by = {};
for (const t of targets) by[t.ats] = (by[t.ats] || 0) + 1;
console.log(`${targets.length} walled targets across ${Object.keys(by).length} platforms`, by);
