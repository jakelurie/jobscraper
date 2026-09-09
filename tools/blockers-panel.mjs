// Phone-friendly view of where the corpus stands and what is standing in the
// way, grouped by cause so the next fix is obvious at a glance.
import { execSync } from 'node:child_process';

const raw = execSync('node tools/blockers.mjs', { cwd: '/Users/jake/Projects/scrapeJobApplications' }).toString();
const head = raw.match(/(\d+) captures - (\d+) reached a form, (\d+) did not/) || [];
const total = +head[1] || 0, reached = +head[2] || 0, blocked = +head[3] || 0;
const pct = total ? Math.round((reached / total) * 100) : 0;

const groups = [];
const lines = raw.split('\n');
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s*(\d+)\s{2}([A-Z ]+?)\s+--\s+(.+)$/);
  if (!m) continue;
  groups.push({ n: +m[1], name: m[2].trim(), why: m[3].trim(), plats: (lines[i + 1] || '').trim() });
}

// Causes we know how to attack, versus ones that need a human or are dead ends.
const FIXABLE = /STUCK ON JOB BOARD|NOTHING RENDERED|PARTIAL FORM/;
const HARD = /CAPTCHA|BOT INTERSTITIAL|EDGE BLOCK/;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const out = [];
out.push('<div style="font:12.5px -apple-system,BlinkMacSystemFont,sans-serif;line-height:1.45">');
out.push(
  `<div style="display:flex;justify-content:space-between;align-items:baseline">` +
    `<div><b style="font-size:16px">${reached}</b><span class="muted"> forms captured</span></div>` +
    `<div class="muted">${pct}% of ${total} job URLs</div></div>`
);
out.push(
  `<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.10);margin:7px 0 12px">` +
    `<div style="width:${pct}%;background:#22c55e"></div><div style="width:${100 - pct}%;background:#ef4444"></div></div>`
);
out.push(`<div class="muted" style="margin:0 0 5px;font-size:11px;letter-spacing:.4px">${blocked} BLOCKED, BY CAUSE</div>`);
out.push('<table style="border-collapse:collapse;width:100%">');
for (const g of groups) {
  const cls = HARD.test(g.name) ? 'bad' : FIXABLE.test(g.name) ? 'warn' : 'muted';
  const bar = Math.max(3, Math.round((g.n / Math.max(1, blocked)) * 100));
  out.push(
    `<tr style="border-top:1px solid rgba(255,255,255,.07)">` +
      `<td style="padding:5px 8px 5px 0;white-space:nowrap;vertical-align:top"><b class="${cls}">${g.n}</b> ${esc(g.name.toLowerCase())}</td>` +
      `<td style="padding:5px 0;width:99%"><div style="background:rgba(255,255,255,.13);height:6px;border-radius:3px"><div style="width:${bar}%;height:6px;border-radius:3px;background:${HARD.test(g.name) ? '#ef4444' : '#f59e0b'}"></div></div>` +
      `<div class="muted" style="font-size:11px;margin-top:2px">${esc(g.plats).slice(0, 150)}</div></td></tr>`
  );
}
out.push('</table>');
out.push(`<div class="muted" style="margin-top:9px;font-size:11px">amber = crawler can still be taught this &middot; red = needs a human or is a hard block</div>`);
out.push('</div>');
console.log(out.join(''));
