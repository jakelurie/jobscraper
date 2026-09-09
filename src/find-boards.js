// Validates candidate company slugs against the public board APIs of the
// self-serve ATS vendors, and writes the ones that resolve to data/boards.json.
import fs from 'node:fs/promises';
import { pool, fetchJson, isSeniorSWE } from './lib/util.js';
import { candidateSlugs } from './companies.js';

const BOARD_APIS = [
  ['greenhouse', (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, (d) => d.jobs],
  ['lever', (s) => `https://api.lever.co/v0/postings/${s}?mode=json`, (d) => (Array.isArray(d) ? d : null)],
  ['ashby', (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`, (d) => d.jobs],
  ['workable', (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`, (d) => d.jobs],
  ['recruitee', (s) => `https://${s}.recruitee.com/api/offers/`, (d) => d.offers],
];

const titleOf = (v, j) =>
  ({ greenhouse: j.title, lever: j.text, ashby: j.title, workable: j.title, recruitee: j.title }[v] || '');

const slugs = candidateSlugs();
const tasks = [];
for (const [vendor, url, pick] of BOARD_APIS) {
  for (const s of slugs) {
    tasks.push(async () => {
      const d = await fetchJson(url(s), { timeout: 10000, retries: 0 }).catch(() => null);
      const jobs = d && pick(d);
      if (!Array.isArray(jobs) || jobs.length === 0) return null;
      const senior = jobs.filter((j) => isSeniorSWE(titleOf(vendor, j))).length;
      return { vendor, slug: s, jobs: jobs.length, senior };
    });
  }
}

console.log(`Testing ${slugs.length} slugs against ${BOARD_APIS.length} board APIs (${tasks.length} requests)...`);
const results = await pool(tasks, 40, (d, n) => {
  if (d % 500 === 0) process.stdout.write(`  ${d}/${n}\r`);
});

const hits = results.filter((r) => r.ok && r.value).map((r) => r.value);
// Keep only boards that actually carry senior engineering roles.
const useful = hits.filter((h) => h.senior > 0);
await fs.writeFile('data/boards.json', JSON.stringify(useful, null, 2));

const by = {};
for (const h of useful) (by[h.vendor] ||= []).push(h.slug);
console.log(`\n${useful.length} live boards with senior SWE roles (of ${hits.length} live boards):`);
for (const [v, s] of Object.entries(by)) console.log(`  ${v.padEnd(14)} ${s.length}: ${s.slice(0, 20).join(', ')}`);
