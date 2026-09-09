// One job URL can leave several records behind: a retry that finally reached the
// form lands under a different platform (Goldman becomes Oracle, Snap becomes
// Workday), so the earlier blocked record is never overwritten and keeps
// counting against us. Keep the best outcome per job URL and drop the rest.
import fs from 'node:fs/promises';
import path from 'node:path';

const byUrl = new Map();
for (const f of await fs.readdir('data/forms')) {
  if (!f.endsWith('.json')) continue;
  const p = path.join('data/forms', f);
  const r = JSON.parse(await fs.readFile(p, 'utf8').catch(() => 'null'));
  if (!r?.seed?.startUrl) continue;
  const list = byUrl.get(r.seed.startUrl) || byUrl.set(r.seed.startUrl, []).get(r.seed.startUrl);
  list.push({ file: p, rec: r });
}

const better = (a, b) => {
  if (a.rec.isApplicationForm !== b.rec.isApplicationForm) return a.rec.isApplicationForm ? a : b;
  return (a.rec.fieldCount || 0) >= (b.rec.fieldCount || 0) ? a : b;
};

let dropped = 0;
for (const [, list] of byUrl) {
  if (list.length < 2) continue;
  const keep = list.reduce(better);
  for (const item of list) {
    if (item === keep) continue;
    await fs.unlink(item.file).catch(() => {});
    for (const a of [item.rec.artifacts?.screenshot, item.rec.artifacts?.html]) {
      if (a) await fs.unlink(a).catch(() => {});
    }
    dropped++;
  }
}
console.log(`${byUrl.size} distinct job URLs, dropped ${dropped} superseded records`);
