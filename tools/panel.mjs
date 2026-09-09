#!/usr/bin/env node
// The monitor panel for the job-form corpus.
//
// The harness replaces #panel-body via innerHTML every 3 seconds, so a gallery
// rendered as ordinary panel HTML would lose its scroll position, its open
// group and anything typed into a search box on every tick. This script
// therefore does two small things instead of drawing the gallery itself:
//
//   1. maintains data/gallery.json, the index of what has been captured;
//   2. prints a bootstrap that mounts tools/gallery-app.js into #jf-app, a
//      sibling of the panel body that the harness never rewrites.
//
// Static fallback markup ships alongside the bootstrap so the panel still says
// something true if the app never boots; the app hides it once it is up.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = '/Users/jake/Projects/scrapeJobApplications';
process.chdir(ROOT);
const NOW = Date.now();

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null; // mid-write, or a record that did not survive a crash
  }
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fileUrl = (rel) => `/api/file?path=${encodeURIComponent(path.join(ROOT, rel))}`;
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// Previews are made out-of-band: sizing images inline would blow the refresh
// budget, and the panel is content to show whatever is ready this tick.
try {
  spawn(process.execPath, [path.join(ROOT, 'tools/thumbs.mjs')], { detached: true, stdio: 'ignore' }).unref();
} catch {}

const NICE = {
  ashby: 'Ashby',
  avature: 'Avature',
  bamboohr: 'BambooHR',
  breezy: 'Breezy',
  eightfold: 'Eightfold',
  greenhouse: 'Greenhouse',
  icims: 'iCIMS',
  janestreet: 'Jane Street',
  lever: 'Lever',
  meta: 'Meta',
  'oracle-hcm': 'Oracle HCM',
  phenom: 'Phenom',
  pinpoint: 'Pinpoint',
  rippling: 'Rippling',
  successfactors: 'SAP SuccessFactors',
  taleo: 'Taleo',
  teamtailor: 'Teamtailor',
  workable: 'Workable',
  workday: 'Workday',
};
const label = (n) => NICE[n] || (n.startsWith('custom-') ? n.slice(7).replace(/-/g, '.') : n);

// ---- the index ---------------------------------------------------------------
// Built from the screenshots on disk rather than the capture records: forms get
// curated afterwards (duplicates, non-US and stale ones moved into underscore
// buckets), and the files that survived that pass are the corpus. Each record is
// parsed once and cached against its screenshot's mtime, so a refresh every few
// seconds does not re-read hundreds of JSON files.
const SHOTS = 'data/screenshots';
const CACHE = 'data/runs/.gallery-cache.json';
const cache = readJson(CACHE) || {};
const next = {};
const forms = [];
const groups = [];
const aside = {};

const countPngs = (dir) => {
  try {
    return fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.png')).length;
  } catch {
    return 0;
  }
};

for (const d of fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS, { withFileTypes: true }) : []) {
  if (!d.isDirectory()) continue;
  const dir = path.join(SHOTS, d.name);
  if (d.name.startsWith('_')) {
    const n = countPngs(dir);
    if (n) aside[d.name.slice(1)] = n;
    continue;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  if (!files.length) continue;
  groups.push({ name: d.name, label: label(d.name), count: files.length });
  for (const f of files) {
    const rel = path.join(dir, f);
    const base = f.replace(/\.png$/, '');
    const key = `${d.name}/${base}`;
    let at = 0;
    try {
      at = Math.round(fs.statSync(rel).mtimeMs);
    } catch {}
    if (cache[key]?.at === at) {
      next[key] = cache[key];
      forms.push(cache[key].e);
      continue;
    }
    const rec = readJson(path.join('data/forms', `${d.name}__${base}.json`));
    const e = {
      g: d.name,
      c: rec?.seed?.company || base.split('__')[0],
      t: rec?.seed?.title || base.split('__').slice(1).join(' ').replace(/-/g, ' '),
      loc: rec?.seed?.location || '',
      n: rec?.fieldCount || 0,
      act: rec?.controls?.byAction || {},
      url: rec?.seed?.jobUrl || rec?.finalUrl || '',
      full: rel,
      thumb: path.join('data/thumbs', d.name, `${base}.jpg`),
      big: path.join('data/large', d.name, `${base}.jpg`),
      cov: rec?.shot?.coversAllFields !== false,
      at,
    };
    next[key] = { at, e };
    forms.push(e);
  }
}
if (JSON.stringify(next) !== JSON.stringify(cache)) {
  try {
    fs.mkdirSync('data/runs', { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(next));
  } catch {}
}

// ---- is a crawl adding to it right now? --------------------------------------
const aliveP = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const live = (fs.existsSync('data/runs') ? fs.readdirSync('data/runs') : [])
  .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
  .map((f) => readJson(path.join('data/runs', f)))
  .filter((r) => r && !r.finishedAt && aliveP(r.pid));

groups.sort((a, b) => b.count - a.count);
forms.sort((a, b) => b.at - a.at);

const index = {
  at: NOW,
  root: ROOT,
  totals: {
    forms: forms.length,
    companies: new Set(forms.map((f) => f.c)).size,
    platforms: groups.length,
  },
  newest: forms[0]?.at || 0,
  live: live.length
    ? {
        runs: live.length,
        done: live.reduce((s, r) => s + (r.done || 0), 0),
        total: live.reduce((s, r) => s + (r.total || 0), 0),
        startedAt: Math.min(...live.map((r) => r.startedAt)),
      }
    : null,
  groups,
  forms,
  aside,
};
// Written atomically: the app fetches this file on its own schedule and must
// never catch it half-written.
try {
  fs.writeFileSync('data/gallery.json.tmp', JSON.stringify(index));
  fs.renameSync('data/gallery.json.tmp', 'data/gallery.json');
} catch {}

// ---- the bootstrap -----------------------------------------------------------
// innerHTML never executes an injected <script>, but it does fire inline event
// handlers, so a 1px image whose src cannot load is what starts the app. The
// version stamp is the app file's mtime: editing tools/gallery-app.js swaps the
// running copy instead of stacking a second one on top of it.
let v = 0;
try {
  v = Math.round(fs.statSync('tools/gallery-app.js').mtimeMs);
} catch {}
const boot =
  `(function(){var w=window,V=${v};` +
  `w.__jfCfg={data:'${fileUrl('data/gallery.json')}',app:'${fileUrl('tools/gallery-app.js')}',v:V};` +
  `if(w.__jfApp){if(w.__jfApp.v===V){w.__jfApp.tick();return}w.__jfApp.destroy();w.__jfApp=null}` +
  `if(w.__jfL===V)return;w.__jfL=V;` +
  `fetch(w.__jfCfg.app).then(function(r){return r.text()}).then(function(t){(0,eval)(t)})` +
  `.catch(function(){w.__jfL=0})})()`;

const out = [];
out.push(
  `<img src="jf:boot" alt="" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none" onerror="${esc(boot)}">`
);

// The panel body keeps what has to be current -- the totals and whatever crawl
// is running -- because the harness re-renders it every 3 seconds and wires the
// stop buttons here. Everything below it, the browsable corpus, belongs to the
// app, which must not be thrown away that often.
out.push(
  '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">' +
    `<b style="font-size:24px">${index.totals.forms}</b><span>application forms</span>` +
    `<span class="muted">&middot; ${index.totals.companies} companies &middot; ${index.totals.platforms} platforms</span></div>`
);
const asideBits = Object.entries(aside).map(([k, n]) => `${n} ${k}`);
out.push(
  '<div class="muted" style="margin-top:3px;font-size:11.5px">' +
    (index.live
      ? `<span class="ok">crawling</span> &middot; ${index.live.done} of ${index.live.total} tried &middot; ${ago(NOW - index.live.startedAt)} in`
      : `idle${index.newest ? ` &middot; newest capture ${ago(NOW - index.newest)} ago` : ''}`) +
    (asideBits.length ? ` &middot; set aside: ${asideBits.join(', ')}` : '') +
    '</div>'
);
for (const r of live) {
  out.push(
    `<div class="row" style="margin-top:6px"><button class="ghost" data-stop="${r.pid}">stop crawl ${r.pid}</button></div>`
  );
}

// Fallback: what the panel says while the app loads, or if it never does.
out.push('<div id="jf-fallback">');
out.push('<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">');
for (const g of groups) {
  out.push(
    '<span style="background:rgba(255,255,255,.09);border-radius:9px;padding:2px 8px;font-size:11.5px">' +
      `${esc(g.label)} <b>${g.count}</b></span>`
  );
}
out.push('</div>');
out.push('<div class="muted" style="margin-top:8px;font-size:11px">loading the browser&hellip;</div>');
out.push('</div>');

console.log(out.join(''));
