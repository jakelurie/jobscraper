// Brings the corpus on disk in line with the current rules, without re-crawling:
//
//   * re-scores every capture against today's definition of an application form,
//     so pages that turned out to be help desks stop counting as forms;
//   * re-files white-labelled vendors into the vendor's folder, so all the
//     SuccessFactors forms sit together however the employer branded the host;
//   * separates captures that are literally the same application page reached
//     from different postings, which inflate depth without adding a form.
//
// Depth is meant to mean "ten different applications", so only the first
// capture of a given application page stays in the platform folder.
import fs from 'node:fs/promises';
import path from 'node:path';
import { looksLikeApplication } from '../src/capture.js';
import { isUSLocation } from '../src/lib/util.js';

// A record may be mid-write by a crawl running alongside this tool; a partial
// file is skipped rather than allowed to abort the whole pass.
async function readRecord(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

const VENDORS = new Set([
  'greenhouse', 'lever', 'ashby', 'workday', 'icims', 'taleo', 'successfactors', 'oracle-hcm',
  'jobvite', 'avature', 'eightfold', 'phenom', 'smartrecruiters', 'workable', 'recruitee',
  'breezy', 'bamboohr', 'rippling', 'dayforce', 'clearcompany', 'jazzhr', 'pinpoint',
  'teamtailor', 'personio', 'paylocity', 'adp', 'ukg', 'gem', 'dover',
]);

// Two URLs name the same application when they differ only by tracking noise.
const normUrl = (u = '') => {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|src|source|ref|referrer|trk|gh_src|sessionid|jsessionid|_ga|lang|locale)/i.test(k)) {
        url.searchParams.delete(k);
      }
    }
    url.hash = '';
    return `${url.host}${url.pathname}?${[...url.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&')}`.toLowerCase();
  } catch {
    return String(u).split('#')[0].toLowerCase();
  }
};

const records = [];
for (const f of await fs.readdir('data/forms')) {
  if (!f.endsWith('.json')) continue;
  const p = path.join('data/forms', f);
  const rec = await readRecord(p);
  if (rec) records.push({ file: p, rec });
}
// Oldest first, so the capture that is kept is the one that got there first.
records.sort((a, b) => (a.rec.capturedAt || '').localeCompare(b.rec.capturedAt || '') || a.file.localeCompare(b.file));

const seenForm = new Set();
let rescored = 0;
let regrouped = 0;
let deduped = 0;
let moved = 0;

for (const { file, rec } of records) {
  const detected = rec.detectedPlatform || rec.platform || 'unknown';
  const seedVendor = String(rec.seed?.ats || '').toLowerCase();
  const platform = detected.startsWith('custom:') && VENDORS.has(seedVendor) ? seedVendor : detected;
  const group = platform.replace(/[^a-z0-9]+/gi, '-');

  const isForm = looksLikeApplication({
    fieldCount: rec.fieldCount,
    fields: rec.fields,
    url: rec.finalUrl,
    title: rec.pageTitle,
    sections: rec.sections,
  });

  // Out of scope: the corpus is United States only. An explicitly foreign
  // posting is set aside rather than deleted, and stops counting toward depth
  // so the slot it occupied gets refilled with a US application.
  const scope = isUSLocation(rec.seed?.location || '', `${rec.seed?.title || ''} ${rec.pageTitle || ''}`);
  const nonUS = scope === false;

  const key = `${platform}|${normUrl(rec.finalUrl)}`;
  let duplicate = false;
  if (isForm) {
    if (seenForm.has(key)) duplicate = true;
    else seenForm.add(key);
  }

  const bucket = !isForm
    ? path.join('_unreached', group)
    : nonUS
      ? path.join('_nonus', group)
      : duplicate
        ? path.join('_duplicates', group)
        : group;
  const oldGroup = rec.platform.replace(/[^a-z0-9]+/gi, '-');
  const wasBucket = !rec.isApplicationForm
    ? path.join('_unreached', oldGroup)
    : rec.nonUS
      ? path.join('_nonus', oldGroup)
      : rec.overCap
        ? path.join('_extra', oldGroup)
        : rec.duplicateOfSameForm
          ? path.join('_duplicates', oldGroup)
          : oldGroup;

  if (isForm !== rec.isApplicationForm) rescored++;
  if (platform !== rec.platform) regrouped++;
  if (duplicate) deduped++;

  if (bucket !== wasBucket) {
    const oldBase = rec.id.replace(/^.*?__/, '');
    for (const [dir, ext] of [['data/screenshots', '.png'], ['data/html', '.html']]) {
      const from = path.join(dir, wasBucket, oldBase + ext);
      const toDir = path.join(dir, bucket);
      await fs.mkdir(toDir, { recursive: true });
      if (await fs.rename(from, path.join(toDir, oldBase + ext)).then(() => true).catch(() => false)) moved++;
      // Wizard steps ride along with their parent capture.
      for (let n = 2; n <= 8; n++) {
        await fs
          .rename(path.join(dir, wasBucket, `${oldBase}__step${n}${ext}`), path.join(toDir, `${oldBase}__step${n}${ext}`))
          .catch(() => {});
      }
    }
  }

  rec.platform = platform;
  rec.detectedPlatform = detected;
  rec.isApplicationForm = isForm;
  rec.duplicateOfSameForm = duplicate;
  rec.nonUS = nonUS;
  rec.id = `${group}__${rec.id.replace(/^.*?__/, '')}`;
  rec.artifacts = {
    screenshot: path.join('data/screenshots', bucket, rec.id.replace(/^.*?__/, '') + '.png'),
    html: path.join('data/html', bucket, rec.id.replace(/^.*?__/, '') + '.html'),
  };
  await fs.writeFile(file, JSON.stringify(rec, null, 2));
}

// Depth is capped: ten forms characterise a platform's style, and more than
// that is effort spent where it buys nothing. Overshoot is kept but moved
// aside, preferring to retain forms that look different from each other so the
// ten that stay show the platform's range rather than ten copies of one layout.
const TARGET = Number(process.env.TARGET || 10);
const keptByPlatform = new Map();
for (const { rec } of records) {
  if (!rec.isApplicationForm || rec.duplicateOfSameForm || rec.nonUS) continue;
  const v = keptByPlatform.get(rec.platform) || keptByPlatform.set(rec.platform, []).get(rec.platform);
  v.push(rec);
}
let trimmed = 0;
let promoted = 0;
for (const [platform, all] of keptByPlatform) {
  if (all.length <= TARGET) continue;
  const seenSig = new Set();
  const ranked = [...all].sort((a, b) => (b.fieldCount || 0) - (a.fieldCount || 0));
  const keep = [];
  // First pass takes one of each distinct layout, second fills the remainder.
  for (const r of ranked) {
    const sig = r.fingerprint?.labelSig || r.id;
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    if (keep.length < TARGET) keep.push(r);
  }
  for (const r of ranked) {
    if (keep.length >= TARGET) break;
    if (!keep.includes(r)) keep.push(r);
  }
  const group = platform.replace(/[^a-z0-9]+/gi, '-');
  // Promotion matters as much as demotion: when forms leave the count (a
  // duplicate is spotted, a posting turns out to be foreign) a form parked
  // earlier should come back and take the free slot, so the flag has to be
  // cleared, not just set.
  for (const r of keep) {
    if (!r.overCap) continue;
    r.overCap = false;
    promoted++;
    const base = r.id.replace(/^.*?__/, '');
    for (const [dir, ext] of [['data/screenshots', '.png'], ['data/html', '.html']]) {
      await fs.mkdir(path.join(dir, group), { recursive: true });
      await fs.rename(path.join(dir, '_extra', group, base + ext), path.join(dir, group, base + ext)).catch(() => {});
    }
    r.artifacts = {
      screenshot: path.join('data/screenshots', group, base + '.png'),
      html: path.join('data/html', group, base + '.html'),
    };
  }
  for (const r of all) {
    if (keep.includes(r)) continue;
    if (r.overCap) continue;
    r.overCap = true;
    trimmed++;
    const base = r.id.replace(/^.*?__/, '');
    for (const [dir, ext] of [['data/screenshots', '.png'], ['data/html', '.html']]) {
      const toDir = path.join(dir, '_extra', group);
      await fs.mkdir(toDir, { recursive: true });
      await fs.rename(path.join(dir, group, base + ext), path.join(toDir, base + ext)).catch(() => {});
    }
    r.artifacts = {
      screenshot: path.join('data/screenshots', '_extra', group, base + '.png'),
      html: path.join('data/html', '_extra', group, base + '.html'),
    };
  }
}
// Persist the cap decisions alongside everything else.
for (const { file, rec } of records) await fs.writeFile(file, JSON.stringify(rec, null, 2));

// Re-crawling a target rewrites its record under a new id, which strands the
// image from the previous attempt. Those strays make a platform folder look
// deeper than the corpus really is, so move them out of the way rather than
// leaving the folders disagreeing with the count.
const known = new Set(records.map(({ rec }) => rec.artifacts?.screenshot).filter(Boolean));
const walk = async (d) => {
  const out = [];
  for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
};
let stale = 0;
for (const f of await walk('data/screenshots')) {
  if (!f.endsWith('.png') || known.has(f) || /__step\d/.test(f) || f.includes('_stale')) continue;
  const to = path.join('data/screenshots/_stale', path.relative('data/screenshots', f));
  await fs.mkdir(path.dirname(to), { recursive: true });
  if (await fs.rename(f, to).then(() => true).catch(() => false)) stale++;
}

// Prune folders emptied by the moves.
for (const dir of ['data/screenshots', 'data/html']) {
  for (const sub of await fs.readdir(dir).catch(() => [])) {
    const p = path.join(dir, sub);
    if (!(await fs.stat(p)).isDirectory()) continue;
    if (!(await fs.readdir(p)).length) await fs.rmdir(p).catch(() => {});
  }
}

console.log(`re-scored:  ${rescored}`);
console.log(`re-grouped: ${regrouped}`);
console.log(`non-US, set aside: ${records.filter(({ rec }) => rec.nonUS).length}`);
console.log(`duplicates: ${deduped}  (same application page reached from different postings)`);
console.log(`artifacts moved: ${moved}`);
console.log(`over the ${TARGET}-per-platform cap, set aside: ${trimmed}  (promoted back into the count: ${promoted})`);
console.log(`stale images from re-crawled targets: ${stale}`);
