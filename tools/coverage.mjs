// Answers one question across the corpus: does each screenshot contain the
// entire application form, or did it stop short?
import fs from 'node:fs/promises';

const rows = [];
for (const f of await fs.readdir('data/forms').catch(() => [])) {
  if (!f.endsWith('.json')) continue;
  const r = JSON.parse(await fs.readFile(`data/forms/${f}`, 'utf8').catch(() => 'null'));
  if (!r?.isApplicationForm) continue;
  rows.push(r);
}

const full = rows.filter((r) => r.shot?.coversAllFields);
const short = rows.filter((r) => r.shot && r.shot.coversAllFields === false);
const unknown = rows.filter((r) => !r.shot);

console.log(`forms captured:      ${rows.length}`);
console.log(`whole form in image: ${full.length}`);
console.log(`image stops short:   ${short.length}`);
console.log(`no coverage data:    ${unknown.length}  (captured before the check existed)`);

const expanded = rows.filter((r) => (r.shot?.expandedContainers || 0) > 0);
const overlays = rows.filter((r) => (r.shot?.hiddenOverlays || 0) > 0);
console.log(`\nneeded a scroll container expanded to fit: ${expanded.length}`);
console.log(`had an overlay hidden off the form:        ${overlays.length}`);

if (short.length) {
  console.log('\nstill short:');
  for (const r of short.slice(0, 20)) {
    console.log(
      `  ${r.platform.padEnd(18)} ${String(r.fieldCount).padStart(3)}f  ` +
        `captured ${r.shot.docHeight}px, form reaches ${Math.round(r.shot.lowestField)}px` +
        `${r.shot.viewportOnly ? ' [viewport-only fallback]' : ''}${r.shot.clipped ? ' [exceeds 30000px]' : ''}`
    );
  }
}
