// Classifies every capture that did not reach an application form, so the gap
// can be worked on by cause rather than one site at a time.
import fs from 'node:fs/promises';

const recs = [];
for (const f of await fs.readdir('data/forms').catch(() => [])) {
  if (!f.endsWith('.json')) continue;
  const r = JSON.parse(await fs.readFile(`data/forms/${f}`, 'utf8').catch(() => 'null'));
  if (r) recs.push(r);
}

const SEARCHY = /search|keyword|location|city|distance|category|sort|filter|alert|how often/i;

function classify(r) {
  const title = `${r.pageTitle || ''}`;
  const text = `${title} ${(r.buttons || []).join(' ')}`;
  const fields = r.fields || [];
  if (r.error) return ['navigation error', r.error.slice(0, 60)];
  if (/career section unavailable|inactive career page|404 not found|not found \(shortname\)/i.test(title))
    return ['dead tenant', 'board no longer exists'];
  if (/403 forbidden|access denied/i.test(title)) return ['edge block', 'HTTP 403 from CDN'];
  if (/just a moment|checking your browser|security verification/i.test(title))
    return ['bot interstitial', 'Cloudflare-style challenge'];
  if (r.blocked || r.signals?.captcha) return ['captcha', 'challenge widget on page'];
  if (r.signals?.hasPasswordField || r.signals?.authWall || r.signals?.accountRequired)
    return ['account wall', 'must register or sign in first'];
  if (/sign in|log in|login|account/i.test(title) && fields.length < 6)
    return ['account wall', 'redirected to a sign-in page'];
  if (fields.length === 0) return ['nothing rendered', 'no controls and no links followed'];
  const searchy = fields.filter((f) => SEARCHY.test(`${f.label || ''} ${f.name || ''} ${f.placeholder || ''}`)).length;
  if (searchy >= Math.ceil(fields.length * 0.6)) return ['stuck on job board', 'only search boxes were found'];
  return ['partial form', `${fields.length} fields but not application-shaped`];
}

const blocked = recs.filter((r) => !r.isApplicationForm);
const groups = new Map();
for (const r of blocked) {
  const [cause, why] = classify(r);
  const g = groups.get(cause) || groups.set(cause, { why, rows: [] }).get(cause);
  g.rows.push(r);
}

console.log(`${recs.length} captures - ${recs.length - blocked.length} reached a form, ${blocked.length} did not\n`);
for (const [cause, g] of [...groups.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length)) {
  const plats = {};
  for (const r of g.rows) plats[r.platform] = (plats[r.platform] || 0) + 1;
  console.log(`${String(g.rows.length).padStart(4)}  ${cause.toUpperCase()}  -- ${g.why}`);
  console.log(
    '      ' +
      Object.entries(plats)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`)
        .join('  ')
  );
}
