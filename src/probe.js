// Probes known ATS URL patterns against a list of company slugs to find live
// tenants on platforms whose customers cannot be guessed from an API.
import fs from 'node:fs/promises';
import { pool, UA } from './lib/util.js';

const SLUGS = [
  'ibm', 'cisco', 'oracle', 'sap', 'accenture', 'deloitte', 'kpmg', 'pwc', 'ey',
  'jpmorgan', 'jpmorganchase', 'citi', 'wellsfargo', 'bankofamerica', 'amex', 'visa',
  'mastercard', 'fidelity', 'schwab', 'blackrock', 'morganstanley', 'goldmansachs',
  'verizon', 'att', 'tmobile', 'comcast', 'charter', 'disney', 'warnerbros', 'paramount',
  'nbcuniversal', 'fox', 'sony', 'samsung', 'lg', 'panasonic', 'siemens', 'bosch',
  'ge', 'geaerospace', 'honeywell', 'raytheon', 'rtx', 'lockheedmartin', 'northropgrumman',
  'boeing', 'baesystems', 'leidos', 'saic', 'booz', 'boozallen', 'mitre', 'aerospace',
  'ford', 'gm', 'generalmotors', 'toyota', 'honda', 'nissan', 'stellantis', 'rivian',
  'johnsoncontrols', 'caterpillar', 'deere', 'johndeere', '3m', 'dupont', 'dow',
  'pfizer', 'merck', 'jnj', 'abbvie', 'amgen', 'gilead', 'moderna', 'biogen',
  'unitedhealth', 'cvshealth', 'cvs', 'cigna', 'humana', 'anthem', 'elevancehealth',
  'kaiserpermanente', 'hcahealthcare', 'mayoclinic', 'clevelandclinic',
  'walmart', 'target', 'costco', 'kroger', 'walgreens', 'homedepot', 'lowes', 'bestbuy',
  'nike', 'adidas', 'starbucks', 'mcdonalds', 'chipotle', 'pepsico', 'cocacola',
  'nestle', 'unilever', 'pg', 'procterandgamble', 'colgate', 'kimberlyclark',
  'fedex', 'ups', 'delta', 'united', 'americanairlines', 'southwest', 'marriott', 'hilton',
  'exxonmobil', 'chevron', 'shell', 'bp', 'conocophillips', 'schlumberger', 'halliburton',
  'nvidia', 'intel', 'amd', 'qualcomm', 'broadcom', 'micron', 'texasinstruments',
  'applied', 'appliedmaterials', 'lamresearch', 'analog', 'nxp', 'infineon', 'arm',
  'dell', 'hp', 'hpe', 'lenovo', 'westerndigital', 'seagate', 'netapp', 'pure',
  'vmware', 'citrix', 'redhat', 'nutanix', 'cloudera', 'teradata', 'informatica',
  'servicenow', 'workday', 'salesforce', 'adobe', 'autodesk', 'ansys', 'ptc', 'cadence',
  'synopsys', 'zoom', 'ringcentral', 'twilio', 'zendesk', 'hubspot', 'squarespace',
  'ebay', 'paypal', 'block', 'intuit', 'expedia', 'booking', 'tripadvisor', 'yelp',
  'zillow', 'redfin', 'opendoor', 'carvana', 'chewy', 'wayfair', 'etsy', 'shopify',
  'peloton', 'lululemon', 'gap', 'nordstrom', 'macys', 'kohls', 'dollargeneral',
  'progressive', 'geico', 'statefarm', 'allstate', 'travelers', 'metlife', 'prudential',
  'nasdaq', 'nyse', 'cme', 'ice', 'spglobal', 'moodys', 'thomsonreuters', 'nielsen',
];

// Each entry: [platform, url template, optional success test on body]
// [platform, url template, body test, host test for the *final* URL]
const TEMPLATES = [
  ['icims', (s) => `https://careers-${s}.icims.com/jobs/search?ss=1`, /icims/i, /icims\.com/i],
  ['icims', (s) => `https://us-careers-${s}.icims.com/jobs/search?ss=1`, /icims/i, /icims\.com/i],
  ['icims', (s) => `https://uscareers-${s}.icims.com/jobs/search?ss=1`, /icims/i, /icims\.com/i],
  ['jobvite', (s) => `https://jobs.jobvite.com/${s}/search`, /jobvite/i, /jobs\.jobvite\.com\/.+/i],
  ['avature', (s) => `https://${s}.avature.net/careers/SearchJobs`, /searchjobs|job/i, /avature\.net|careers\./i],
  ['teamtailor', (s) => `https://${s}.teamtailor.com/jobs`, /teamtailor/i, /teamtailor\.com|\.\w+\/jobs/i],
  ['jazzhr', (s) => `https://${s}.applytojob.com/apply`, /applytojob/i, /applytojob\.com/i],
  ['pinpoint', (s) => `https://${s}.pinpointhq.com/`, /pinpoint|vacanc|job/i, /pinpointhq\.com/i],
  ['clearcompany', (s) => `https://${s}.clearcompany.com/careers/jobs`, /clearcompany/i, /\w+\.clearcompany\.com/i],
  ['dayforce', (s) => `https://${s}.dayforcehcm.com/CandidatePortal/en-US/${s}`, /dayforce|candidate/i, /dayforcehcm\.com/i],
  ['successfactors', (s) => `https://jobs.${s}.com/search/?q=software%20engineer`, /successfactors|rmkcdn/i, /\/search/i],
  ['taleo', (s) => `https://${s}.taleo.net/careersection/2/jobsearch.ftl`, /taleo/i, /taleo\.net/i],
  ['smartrecruiters', (s) => `https://careers.smartrecruiters.com/${s}`, /smartrecruiters/i, /smartrecruiters\.com\/\w+/i],
];

// Some vendors serve an identical marketing/landing page for *any* subdomain,
// so a 200 proves nothing. Fetch a nonsense slug per template first and reject
// any real hit whose response matches that control.
const CONTROL_SLUG = 'zzq-not-a-real-company-x9';

async function get(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) return null;
    return { url: res.url, body: (await res.text()).slice(0, 60000) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// A page's identity, ignoring per-request noise (tokens, timestamps, ids).
const shapeOf = (r) =>
  r &&
  [
    r.url.replace(CONTROL_SLUG, '<slug>'),
    (r.body.match(/<title[^>]*>([^<]*)/i) || [])[1] || '',
    Math.round(r.body.length / 500),
  ].join('|');

console.log('Fetching control baselines...');
const controls = new Map();
await Promise.all(
  TEMPLATES.map(async ([platform, tpl]) => {
    const r = await get(tpl(CONTROL_SLUG));
    if (r) controls.set(tpl(CONTROL_SLUG), shapeOf(r));
  })
);

const targets = [];
for (const [platform, tpl, test, hostTest] of TEMPLATES) {
  const control = controls.get(tpl(CONTROL_SLUG));
  for (const s of SLUGS) targets.push({ platform, url: tpl(s), slug: s, test, hostTest, control });
}

console.log(`Probing ${targets.length} candidate ATS tenant URLs...`);

const tasks = targets.map((t) => async () => {
  {
    const res = await get(t.url);
    if (!res) return null;
    const { body } = res;
    // Indistinguishable from the nonsense-slug response => not a real tenant.
    if (t.control && shapeOf(res) === t.control) return null;
    if (t.test && !t.test.test(body) && !t.test.test(res.url)) return null;
    // Vendors redirect unknown tenants to marketing or support pages; reject those.
    if (t.hostTest && !t.hostTest.test(res.url)) return null;
    if (/\/(support|job-seekers?|pricing|customers|contact|invalid)/i.test(res.url)) return null;
    if (/page not found|no longer available|account (is )?(suspended|closed)|invalid=1/i.test(body.slice(0, 4000))) return null;
    // A real board mentions openings; marketing pages do not.
    if (!/\b(job|position|opening|vacanc|requisition|career)/i.test(body)) return null;
    return { platform: t.platform, slug: t.slug, url: res.url, bytes: body.length };
  }
});

const results = await pool(tasks, 24, (d, n) => {
  if (d % 200 === 0) process.stdout.write(`  ${d}/${n}\r`);
});

const hits = results.filter((r) => r.ok && r.value).map((r) => r.value);
// One tenant per platform+slug, and cap each platform so probing stays balanced.
const perPlatform = {};
const kept = [];
for (const h of hits) {
  perPlatform[h.platform] = (perPlatform[h.platform] || 0) + 1;
  if (perPlatform[h.platform] > 6) continue;
  kept.push(h);
}
await fs.writeFile('data/tenants.json', JSON.stringify(kept, null, 2));
const summary = {};
for (const k of kept) (summary[k.platform] ||= []).push(k.slug);
console.log(`\n${kept.length} live tenants found:`);
for (const [p, s] of Object.entries(summary)) console.log(`  ${p.padEnd(16)} ${s.join(', ')}`);
