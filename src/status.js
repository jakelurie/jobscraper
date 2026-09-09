// Publishes what the crawl is doing *right now* to data/run-status.json.
//
// The monitor panel used to infer progress from the newest /tmp/crawl*.out log,
// which silently mixed a finished run's last line with a live process check --
// "running: yes, progress 10/10" described two different runs. Live state has
// to come from the live run, so the run itself writes it.
import fs from 'node:fs';
import path from 'node:path';

// One file per process, because several crawls are often in flight at once and
// a single shared file would have them overwriting each other's state.
const DIR = 'data/runs';
const FILE = path.join(DIR, `${process.pid}.json`);
let state = null;

function flush() {
  if (!state) return;
  state.updatedAt = Date.now();
  try {
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state));
    fs.renameSync(`${FILE}.tmp`, FILE); // atomic: the panel never reads a half-written file
  } catch {}
}

// Finished runs are worth keeping just long enough for the panel to report the
// last one; beyond that they are noise.
function sweep() {
  const cutoff = Date.now() - 6 * 3600 * 1000;
  for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const p = path.join(DIR, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch {}
  }
}

export function startRun(info = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  sweep();
  state = {
    pid: process.pid,
    startedAt: Date.now(),
    finishedAt: null,
    done: 0,
    reached: 0,
    failed: 0,
    workers: {},
    recent: [],
    ...info,
  };
  flush();
}

export function jobStart(id, seed) {
  if (!state) return;
  state.workers[id] = {
    company: seed.company || seed.board || '?',
    title: (seed.title || '').slice(0, 60),
    ats: seed.ats || '?',
    url: seed.applyUrl || seed.jobUrl || '',
    stage: 'starting',
    stageAt: Date.now(),
    jobAt: Date.now(),
  };
  flush();
}

// Every meaningful step the capture takes, as it takes it. Long-running stages
// are the whole point: a worker sitting in one for two minutes is the signal.
export function jobStage(id, stage) {
  const w = state?.workers?.[id];
  if (!w) return;
  w.stage = String(stage).slice(0, 90);
  w.stageAt = Date.now();
  flush();
}

export function jobEnd(id, out) {
  if (!state) return;
  const w = state.workers[id];
  delete state.workers[id];
  state.done++;
  if (out?.isApplicationForm) state.reached++;
  else state.failed++;
  state.recent.unshift({
    at: Date.now(),
    company: out?.seed?.company || w?.company || '?',
    platform: out?.platform || out?.seed?.ats || '?',
    reached: !!out?.isApplicationForm,
    fieldCount: out?.fieldCount || 0,
    why: (out?.error || out?.auth?.why || (out?.blocked ? 'blocked' : '') || '').slice(0, 80),
    ms: out?.ms || (w ? Date.now() - w.jobAt : 0),
  });
  state.recent = state.recent.slice(0, 8);
  flush();
}

export function endRun(summary = {}) {
  if (!state) return;
  state.finishedAt = Date.now();
  state.workers = {};
  Object.assign(state, summary);
  flush();
}
