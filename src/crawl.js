// Fans job URLs out across a pool of Chrome instances and records each
// application form to data/forms/*.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { runWithBrowsers } from './browser.js';
import { captureForm } from './capture.js';
import * as status from './status.js';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const dirs = { screenshots: 'data/screenshots', html: 'data/html', forms: 'data/forms' };
for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });

const input = arg('input', 'data/targets.json');
const limit = Number(arg('limit', '0'));
const browsers = Number(arg('browsers', '6'));

let targets = JSON.parse(await fs.readFile(input, 'utf8'));
if (limit) targets = targets.slice(0, limit);

// Runs are additive: previously captured job URLs are skipped so the corpus can
// be grown in passes without redoing work.
const prior = new Map();
for (const f of await fs.readdir(dirs.forms).catch(() => [])) {
  if (!f.endsWith('.json')) continue;
  let rec = null;
  try {
    rec = JSON.parse(await fs.readFile(path.join(dirs.forms, f), 'utf8'));
  } catch {}
  if (rec?.seed?.startUrl) prior.set(rec.seed.startUrl, rec);
}
if (!argv.includes('--force')) {
  const before = targets.length;
  // Only successful captures are skipped. Ones that hit a wall are retried,
  // since each run tends to carry a fix aimed exactly at them.
  targets = targets.filter((t) => !prior.get(t.applyUrl || t.jobUrl)?.isApplicationForm);
  if (before !== targets.length) console.log(`skipping ${before - targets.length} already-captured URLs`);
}

console.log(`Capturing ${targets.length} application forms with ${browsers} Chrome instances...\n`);

// AUTH=1 opts into registering a throwaway account on portals that hide the
// form behind one. Never used to submit anything.
let identity = null;
if (process.env.AUTH === '1') {
  const { loadIdentity } = await import('./mailbox.js');
  identity = await loadIdentity();
  console.log(`auth enabled as ${identity.email}\n`);
}

const started = Date.now();
// The panel reads this; it is the only honest account of what is happening now.
status.startRun({
  input,
  total: targets.length,
  browsers: Math.min(browsers, targets.length),
  auth: !!identity,
});
const records = await runWithBrowsers(
  targets,
  browsers,
  async (page, seed, w) => {
    status.jobStart(w.id, seed);
    try {
      return await captureForm(page, seed, dirs, {
        identity,
        onStage: (stage) => status.jobStage(w.id, stage),
      });
    } finally {
      status.jobStage(w.id, 'wrapping up');
    }
  },
  (done, total, out, w) => {
    status.jobEnd(w?.id, out);
    const mark = out?.ok ? `${String(out.fieldCount).padStart(3)} fields` : ' FAILED   ';
    const who = `${out?.platform || out?.ats || '?'}/${out?.seed?.company || out?.company || ''}`;
    console.log(
      `[${String(done).padStart(3)}/${total}] ${mark}  ${who.padEnd(38).slice(0, 38)} ${(out?.error || out?.finalUrl || '').slice(0, 70)}`
    );
    // Written as each capture lands, so an interrupted run stays resumable.
    if (out?.id) {
      const dest = path.join(dirs.forms, `${out.id}.json`);
      const tmp = `${dest}.${process.pid}.tmp`;
      fs.writeFile(tmp, JSON.stringify(out, null, 2))
        .then(() => fs.rename(tmp, dest))
        .catch(() => fs.unlink(tmp).catch(() => {}));
    }
  }
);

// Rebuild the combined file from every record on disk, this run's and earlier ones'.
const all = [];
for (const f of await fs.readdir(dirs.forms)) {
  if (!f.endsWith('.json')) continue;
  // Tolerate a record another process is midway through writing rather than
  // throwing away a finished run's summary over it.
  let rec = null;
  try {
    rec = JSON.parse(await fs.readFile(path.join(dirs.forms, f), 'utf8'));
  } catch {}
  if (rec) all.push(rec);
}
await fs.writeFile('data/captures.json', JSON.stringify(all, null, 2));

const ok = records.filter((r) => r.isApplicationForm);
const totalOk = all.filter((r) => r.isApplicationForm);
status.endRun({ corpus: totalOk.length, platforms: new Set(totalOk.map((r) => r.platform)).size });
console.log(
  `\n${ok.length}/${records.length} forms this run in ${Math.round((Date.now() - started) / 1000)}s` +
    ` -- corpus now ${totalOk.length} forms across ${new Set(totalOk.map((r) => r.platform)).size} platforms`
);
