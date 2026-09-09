#!/usr/bin/env node
// Archives the current corpus and starts a new epoch.
//
// The panel reports against data/epoch.json: anything captured or reported
// before that moment lives in data/_archive and is deliberately not counted, so
// a fresh start reads as a fresh start instead of showing a finished run's
// totals above an empty corpus.
import fs from 'node:fs';
import path from 'node:path';

process.chdir('/Users/jake/Projects/scrapeJobApplications');

const MOVE = ['forms', 'html', 'screenshots', 'runs', 'captures.json'];
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join('data/_archive', `run-${stamp}`);
fs.mkdirSync(dest, { recursive: true });

const moved = [];
for (const name of MOVE) {
  const from = path.join('data', name);
  if (!fs.existsSync(from)) continue;
  fs.renameSync(from, path.join(dest, name));
  moved.push(name);
  // The crawl expects these to exist; recreating them empty keeps a run that is
  // started immediately afterwards from failing on a missing directory.
  if (!name.endsWith('.json')) fs.mkdirSync(from, { recursive: true });
}

const countPngs = (d) => {
  try {
    return fs.readdirSync(d, { recursive: true }).filter((f) => String(f).endsWith('.png')).length;
  } catch {
    return 0;
  }
};
const archivedScreenshots = fs
  .readdirSync('data/_archive')
  .reduce((s, d) => s + countPngs(path.join('data/_archive', d, 'screenshots')), 0);

fs.writeFileSync(
  'data/epoch.json',
  JSON.stringify(
    {
      at: Date.now(),
      reason: process.argv[2] || 'wiped for a clean restart',
      archivedRuns: fs.readdirSync('data/_archive'),
      archivedScreenshots,
    },
    null,
    2
  )
);

console.log(`archived ${moved.join(', ') || 'nothing'} -> ${dest}`);
console.log(`new epoch stamped; ${archivedScreenshots} screenshots kept in data/_archive`);
