// Breadth and depth against the goal: a whole-form screenshot of each platform,
// ten distinct applications deep.
import fs from 'node:fs/promises';

// A record may be mid-write by a crawl running alongside this tool; a partial
// file is skipped rather than allowed to abort the whole pass.
async function readRecord(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

const recs = [];
for (const f of await fs.readdir('data/forms')) {
  if (!f.endsWith('.json')) continue;
  const r = await readRecord(`data/forms/${f}`);
  if (r) recs.push(r);
}
const kept = recs.filter((r) => r.isApplicationForm && !r.duplicateOfSameForm && !r.overCap && !r.nonUS);

const byPlatform = new Map();
for (const r of kept) {
  const v = byPlatform.get(r.platform) || byPlatform.set(r.platform, []).get(r.platform);
  v.push(r);
}
const rows = [...byPlatform.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

const TARGET = 10;
const bar = (n) => '#'.repeat(Math.min(TARGET, n)) + '-'.repeat(Math.max(0, TARGET - n));
console.log('PLATFORM'.padEnd(26) + 'DEPTH        FULL-FORM SHOTS');
console.log('-'.repeat(64));
let short = 0;
for (const [p, v] of rows) {
  const full = v.filter((r) => r.shot?.coversAllFields).length;
  if (full < v.length) short += v.length - full;
  console.log(
    p.replace(/^custom:/, '').padEnd(26) +
      `${String(v.length).padStart(2)}/${TARGET} ${bar(v.length)}  ${full}/${v.length}`
  );
}
console.log('-'.repeat(64));
const at = rows.filter((r) => r[1].length >= TARGET).length;
console.log(`platforms with a form: ${rows.length}   distinct applications: ${kept.length}`);
console.log(`at depth ${TARGET}: ${at}   |  below: ${rows.length - at}   |  slots to fill: ${rows.reduce((n, r) => n + Math.max(0, TARGET - r[1].length), 0)}`);
console.log(`screenshots missing part of the form: ${short}`);
const extra = recs.filter((r) => r.overCap).length;
const nonus = recs.filter((r) => r.nonUS).length;
const dupes = recs.filter((r) => r.duplicateOfSameForm).length;
const walled = recs.filter((r) => !r.isApplicationForm).length;
console.log(`set aside: ${dupes} duplicates, ${extra} over the cap, ${nonus} non-US, ${walled} never reached a form`);
