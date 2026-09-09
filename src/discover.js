// Queries every Tier A vendor API in parallel and writes a de-duplicated list of
// senior software engineering postings to data/seeds.json.
import fs from 'node:fs/promises';
import { VENDORS } from './vendors.js';
import { pool, isSeniorSWE } from './lib/util.js';

// Boards confirmed live by find-boards.js are folded in alongside the curated
// tenant lists, so a validation pass permanently widens discovery.
const found = JSON.parse(await fs.readFile('data/boards.json', 'utf8').catch(() => '[]'));
for (const v of VENDORS) {
  const extra = found.filter((f) => f.vendor === v.id).map((f) => f.slug);
  if (extra.length) v.tenants = [...new Set([...v.tenants, ...extra])];
}

const tasks = [];
for (const v of VENDORS) {
  for (const t of v.tenants) {
    const key = v.key ? v.key(t) : t;
    tasks.push(async () => {
      const jobs = await v.jobs(t);
      return { vendor: v, key, jobs };
    });
  }
}

console.log(`Querying ${tasks.length} job boards across ${VENDORS.length} platforms...`);
const results = await pool(tasks, 20);

const seeds = [];
const failures = [];
for (const r of results) {
  if (!r.ok) { failures.push(String(r.error.message)); continue; }
  const { vendor, key, jobs } = r.value;
  const senior = jobs.filter((x) => isSeniorSWE(x.title) && x.jobUrl);
  for (const x of senior) {
    seeds.push({ ats: vendor.id, atsLabel: vendor.label, board: key, ...x });
  }
  const tag = senior.length ? '' : '  (no senior SWE match)';
  if (jobs.length === 0) failures.push(`${vendor.id}/${key}: empty`);
  else console.log(`  ${vendor.id.padEnd(16)} ${String(key).padEnd(28)} ${String(senior.length).padStart(3)}/${jobs.length}${tag}`);
}

// De-duplicate on URL, then cap per board so no single company floods the corpus.
const PER_BOARD = Number(process.env.PER_BOARD || 2);
const seen = new Set();
const perBoard = new Map();
const kept = [];
for (const s of seeds) {
  if (seen.has(s.jobUrl)) continue;
  seen.add(s.jobUrl);
  const n = perBoard.get(s.board) || 0;
  if (n >= PER_BOARD) continue;
  perBoard.set(s.board, n + 1);
  kept.push(s);
}

await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/seeds.json', JSON.stringify(kept, null, 2));

const byAts = {};
for (const s of kept) byAts[s.ats] = (byAts[s.ats] || 0) + 1;
console.log(`\nfailures: ${failures.length}`);
console.log(`${kept.length} seeds across ${Object.keys(byAts).length} platforms:`, byAts);
