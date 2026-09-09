// Summarizes the captured corpus: platform coverage, field vocabulary, widget
// styles and walls -- the inputs a universal form-filler needs to plan against.
import fs from 'node:fs/promises';

const records = JSON.parse(await fs.readFile('data/captures.json', 'utf8'));
const good = records.filter((r) => r.isApplicationForm);

const count = (arr, f) => {
  const m = new Map();
  for (const x of arr) for (const k of [].concat(f(x) ?? [])) if (k) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '0%');

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

say('# Job Application Form Corpus');
say();
say(`Captured **${records.length}** application URLs; **${good.length}** reached a real application form.`);
say(`Distinct platforms with a usable form: **${new Set(good.map((r) => r.platform)).size}**`);
say(`Distinct form layouts (uiSig): **${new Set(good.map((r) => r.fingerprint?.uiSig)).size}**`);
say();

say('## Platform coverage');
say();
say('| Platform | Forms | Median fields | Iframe | Multi-step | Account wall | Captcha |');
say('|---|---|---|---|---|---|---|');
const byPlatform = new Map();
for (const r of good) (byPlatform.get(r.platformLabel) || byPlatform.set(r.platformLabel, []).get(r.platformLabel)).push(r);
for (const [label, rs] of [...byPlatform.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const med = rs.map((r) => r.fieldCount).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
  const s = (f) => rs.filter(f).length;
  say(
    `| ${label} | ${rs.length} | ${med} | ${s((r) => r.inIframe)} | ${s((r) => r.signals?.multiStep)} | ` +
      `${s((r) => r.signals?.authWall || r.signals?.accountRequired)} | ${s((r) => r.signals?.captcha)} |`
  );
}
say();

say('## Canonical field vocabulary');
say();
say('How often each semantic field appears, across all captured forms.');
say();
say('| Canonical key | Forms | Share | Example labels seen |');
say('|---|---|---|---|');
const examples = new Map();
for (const r of good) {
  for (const f of r.fields || []) {
    if (!f.canonical || !f.label) continue;
    const set = examples.get(f.canonical) || examples.set(f.canonical, new Set()).get(f.canonical);
    if (set.size < 4) set.add(f.label.slice(0, 40));
  }
}
for (const [key, n] of count(good, (r) => [...new Set((r.fields || []).map((f) => f.canonical))])) {
  say(`| \`${key}\` | ${n} | ${pct(n, good.length)} | ${[...(examples.get(key) || [])].join(' · ')} |`);
}
say();

say('## Input mechanics');
say();
say('| Trait | Forms | Share |');
say('|---|---|---|');
const traits = [
  ['native <select>', (r) => r.fingerprint?.hasNativeSelect],
  ['custom dropdown (react-select / combobox)', (r) => r.fingerprint?.hasCustomDropdown],
  ['file upload input', (r) => r.fingerprint?.hasFileUpload],
  ['drag-and-drop dropzone', (r) => r.fingerprint?.hasDropzone],
  ['form inside an iframe', (r) => r.inIframe],
  ['multi-step wizard', (r) => r.signals?.multiStep],
  ['requires an account', (r) => r.signals?.authWall || r.signals?.accountRequired],
  ['offers OAuth apply (LinkedIn etc.)', (r) => r.signals?.oauthApply],
  ['captcha present', (r) => r.signals?.captcha],
  ['EEO / demographic section', (r) => r.signals?.eeoSection],
  ['cover letter requested', (r) => r.signals?.coverLetter],
];
for (const [name, f] of traits) {
  const n = good.filter(f).length;
  say(`| ${name} | ${n} | ${pct(n, good.length)} |`);
}
say();

say('## Label sourcing');
say();
say('Where a filler must look to know what a field means.');
say();
say('| Label source | Fields | Share |');
say('|---|---|---|');
const allFields = good.flatMap((r) => r.fields || []);
for (const [src, n] of count(allFields, (f) => f.labelSource)) {
  say(`| ${src} | ${n} | ${pct(n, allFields.length)} |`);
}
say();

say('## Custom questions');
say();
const customs = count(
  good.flatMap((r) => (r.fields || []).filter((f) => f.canonical === 'custom_question')),
  (f) => f.normLabel
).filter(([, n]) => n > 1);
say(`${customs.length} custom questions appear on more than one form:`);
say();
for (const [q, n] of customs.slice(0, 40)) say(`- (${n}×) ${q}`);
say();

say('## Hardest targets');
say();
say('Captures that did not reach a fillable form -- the cases a universal filler must handle specially.');
say();
say('| Platform | Company | Why | Final URL |');
say('|---|---|---|---|');
for (const r of records.filter((x) => !x.isApplicationForm)) {
  const why = r.blocked ? 'bot wall' : r.signals?.authWall || r.signals?.accountRequired ? 'account required'
    : r.error ? `error: ${String(r.error).slice(0, 50)}` : `only ${r.fieldCount} fields`;
  say(`| ${r.platformLabel || r.platform} | ${r.seed?.company || ''} | ${why} | ${String(r.finalUrl || '').slice(0, 70)} |`);
}

await fs.writeFile('data/REPORT.md', lines.join('\n'));
console.log('\nwrote data/REPORT.md');
