#!/usr/bin/env node
// Makes the two JPEG sizes the corpus browser needs out of each captured PNG.
//
// A full-page capture averages half a megabyte and the harness serves files
// with `Cache-Control: no-store`, so showing originals in a grid would
// re-download megabytes constantly. A 260px card thumbnail is ~20KB and a
// 760px lightbox preview ~100KB; the original PNG stays one tap away.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

process.chdir('/Users/jake/Projects/scrapeJobApplications');

const SRC = 'data/screenshots';
const SIZES = [
  { dir: 'data/thumbs', width: '260', quality: '50' },
  { dir: 'data/large', width: '760', quality: '62' },
];
const LOCK = 'data/runs/.thumbs.lock';

fs.mkdirSync('data/runs', { recursive: true });
for (const s of SIZES) fs.mkdirSync(s.dir, { recursive: true });

// Only one thumbnailer at a time: the panel fires this off on every refresh.
try {
  process.kill(+fs.readFileSync(LOCK, 'utf8'), 0);
  process.exit(0);
} catch {}
fs.writeFileSync(LOCK, String(process.pid));
process.on('exit', () => {
  try {
    fs.unlinkSync(LOCK);
  } catch {}
});

const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.png')) out.push(p);
  }
  return out;
};

let made = 0;
const pngs = fs.existsSync(SRC) ? walk(SRC) : [];
for (const png of pngs) {
  // Underscore buckets (_unreached, _duplicates, _nonus, _stale...) are the
  // piles things were set aside into, not the corpus, so they are never sized.
  const rel = path.relative(SRC, png);
  if (rel.split(path.sep).some((seg) => seg.startsWith('_'))) continue;
  for (const s of SIZES) {
    const jpg = path.join(s.dir, rel.replace(/\.png$/, '.jpg'));
    try {
      if (fs.statSync(jpg).mtimeMs >= fs.statSync(png).mtimeMs) continue;
    } catch {}
    fs.mkdirSync(path.dirname(jpg), { recursive: true });
    try {
      execFileSync(
        '/usr/bin/sips',
        ['--resampleWidth', s.width, '-s', 'format', 'jpeg', '-s', 'formatOptions', s.quality, png, '--out', jpg],
        { stdio: 'ignore' }
      );
      made++;
    } catch {}
  }
}

// Sizes for captures that have since been moved or deleted are dead weight.
const live = new Set(pngs.map((p) => path.relative(SRC, p).replace(/\.png$/, '.jpg')));
for (const s of SIZES) {
  if (!fs.existsSync(s.dir)) continue;
  for (const f of walk2(s.dir)) if (!live.has(path.relative(s.dir, f))) fs.unlinkSync(f);
}
function walk2(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk2(p));
    else if (e.name.endsWith('.jpg')) out.push(p);
  }
  return out;
}

if (process.stdout.isTTY) console.log(`${made} previews made`);
