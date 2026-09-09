// Re-scores saved captures against the current definition of "reached a real
// application form", and moves their artifacts to match.
import fs from 'node:fs/promises';
import path from 'node:path';
import { looksLikeApplication } from '../src/capture.js';

let moved = 0;
let changed = 0;
for (const f of await fs.readdir('data/forms')) {
  if (!f.endsWith('.json')) continue;
  const p = path.join('data/forms', f);
  const rec = JSON.parse(await fs.readFile(p, 'utf8'));
  const now = looksLikeApplication({ fieldCount: rec.fieldCount, fields: rec.fields });
  if (now === rec.isApplicationForm) continue;
  changed++;
  rec.isApplicationForm = now;
  rec.reclassified = true;
  await fs.writeFile(p, JSON.stringify(rec, null, 2));

  for (const [dir, ext] of [['data/screenshots', '.png'], ['data/html', '.html']]) {
    const base = rec.id.replace(`${rec.group}__`, '');
    const from = path.join(dir, now ? path.join('_unreached', rec.group) : rec.group, base + ext);
    const toDir = path.join(dir, now ? rec.group : path.join('_unreached', rec.group));
    await fs.mkdir(toDir, { recursive: true });
    await fs.rename(from, path.join(toDir, base + ext)).then(() => moved++).catch(() => {});
  }
}
console.log(`reclassified ${changed} records, moved ${moved} artifacts`);
