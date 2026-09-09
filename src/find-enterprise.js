// Finds live tenants on the enterprise ATS platforms -- the ones with no public
// API, whose customers therefore cannot be enumerated.
//
// The earlier probe only asked "does this URL return 200?", which let through a
// pile of vendor 404 pages, demo tenants and "Career Section Unavailable"
// notices. The test here is the one that actually matters for our purpose: does
// the page link to individual job postings? A board with no postings on it is
// useless to us no matter what status code it returns.
import fs from 'node:fs/promises';
import { pool, UA } from './lib/util.js';

const JOB_HREF = [
  /\/job\/[\w%-]{3,}/i,
  /\/jobs\/\d+/i,
  /\/position[s]?\/[\w-]+/i,
  /[?&](job|jobid|pid|req|reqid|requisition|jvi|rid)=[\w-]{3,}/i,
  /\/JobDetail/i,
  /\/ProjectDetail\//i,
  /\/job-detail/i,
  /careersection\/.*\/jobdetail/i,
];
const DEAD =
  /career section unavailable|inactive career page|404 not found|page (not|cannot be) found|no longer (available|active)|account (suspended|closed|disabled)|coming soon|under construction|fillyourhandle|acme-/i;

const SLUGS = `
att verizon tmobile comcast charter cox dish lumen frontier
boeing lockheedmartin northropgrumman rtx raytheon l3harris generaldynamics huntingtoningalls
textron spirit howmet moog curtisswright mercury kratos aerovironment
pfizer merck abbvie amgen gilead biogen regeneron vertex moderna bristolmyers lilly astrazeneca
gsk sanofi novartis roche bayer takeda baxter becton stryker medtronic zimmer edwards boston
unitedhealth cvshealth cigna humana centene molina elevance hcahealthcare tenethealth
walmart target costco kroger publix albertsons walgreens riteaid dollargeneral dollartree
homedepot lowes bestbuy autozone oreilly advanceauto tractorsupply
nike adidas underarmour lululemon gap nordstrom macys kohls tjx ross burlington
starbucks mcdonalds chipotle yum darden dominos wendys papajohns dunkin
pepsico cocacola kraftheinz generalmills kellogg conagra campbells hormel tyson smithfield
mondelez hershey mars nestle danone unilever colgate kimberlyclark clorox churchdwight
ford gm stellantis toyota honda nissan hyundai subaru tesla rivian lucid paccar navistar
caterpillar deere cnh agco terex oshkosh doosan komatsu
ge honeywell emerson eaton parker rockwell abb siemens schneider danaher fortive dover
3m dupont dow lyondell ppg sherwinwilliams ecolab airproducts linde celanese eastman
exxonmobil chevron conocophillips marathon valero phillips66 oxy devon pioneer halliburton
schlumberger bakerhughes nov weatherford transocean
jpmorgan citi wellsfargo bankofamerica usbank pnc truist regions keybank fifththird huntington
amex discover capitalone synchrony ally schwab fidelity vanguard blackrock statestreet northerntrust
progressive geico statefarm allstate travelers libertymutual nationwide farmers usaa
metlife prudential principal lincoln unum aflac cigna guardian massmutual newyorklife
fedex ups xpo jbhunt schneider werner knight landstar chrobinson expeditors
delta united american southwest alaska jetblue spirit hawaiian
marriott hilton hyatt ihg wyndham choicehotels mgm caesars wynn lasvegassands
disney comcast paramount warnerbros sony netflix lionsgate amc cinemark
ibm cisco oracle sap accenture deloitte kpmg ey pwc cognizant infosys wipro tcs capgemini
dxc leidos saic caci booz mitre mantech peraton parsons jacobs aecom fluor bechtel kbr
`.trim().split(/\s+/);

// Each: [platform, url builder]. Misses cost one request, so breadth is cheap.
const TEMPLATES = [
  ['icims', (s) => `https://careers-${s}.icims.com/jobs/search?ss=1`],
  ['icims', (s) => `https://${s}.icims.com/jobs/search?ss=1`],
  ['icims', (s) => `https://careers.${s}.com/jobs/search?ss=1`],
  ['taleo', (s) => `https://${s}.taleo.net/careersection/2/jobsearch.ftl`],
  ['taleo', (s) => `https://${s}.taleo.net/careersection/ex/jobsearch.ftl`],
  ['taleo', (s) => `https://${s}.taleo.net/careersection/external/jobsearch.ftl`],
  ['successfactors', (s) => `https://jobs.${s}.com/search/?q=engineer`],
  ['successfactors', (s) => `https://careers.${s}.com/search/?q=engineer`],
  ['jobvite', (s) => `https://jobs.jobvite.com/${s}/search`],
  ['jobvite', (s) => `https://jobs.jobvite.com/careers/${s}/jobs`],
  ['avature', (s) => `https://${s}.avature.net/careers/SearchJobs`],
  ['avature', (s) => `https://careers.${s}.com/careers/SearchJobs`],
  ['jazzhr', (s) => `https://${s}.applytojob.com/apply`],
  ['clearcompany', (s) => `https://${s}.clearcompany.com/careers/jobs`],
  ['dayforce', (s) => `https://jobs.dayforcehcm.com/en-US/${s}/CANDIDATEPORTAL/jobs`],
  ['phenom', (s) => `https://jobs.${s}.com/global/en/search-results`],
  ['phenom', (s) => `https://careers.${s}.com/global/en/search-results`],
  ['brassring', (s) => `https://sjobs.brassring.com/TGnewUI/Search/home/home?partnerid=25240&siteid=5016`],
  ['oracle-hcm', (s) => `https://${s}.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/requisitions`],
  ['ukg', (s) => `https://recruiting.ultipro.com/${s}/JobBoard`],
  ['paylocity', (s) => `https://recruiting.paylocity.com/recruiting/jobs/All/${s}`],
  ['smartrecruiters', (s) => `https://careers.smartrecruiters.com/${s}`],
  ['workday', (s) => `https://${s}.wd1.myworkdayjobs.com/en-US/External`],
  ['workday', (s) => `https://${s}.wd5.myworkdayjobs.com/en-US/External`],
];

const targets = [];
const seenUrl = new Set();
for (const [platform, tpl] of TEMPLATES) {
  for (const s of SLUGS) {
    const url = tpl(s);
    if (seenUrl.has(url)) continue;
    seenUrl.add(url);
    targets.push({ platform, slug: s, url });
  }
}

console.log(`Probing ${targets.length} candidate boards for real job postings...`);

const tasks = targets.map((t) => async () => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 14000);
  try {
    const res = await fetch(t.url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) return null;
    const body = (await res.text()).slice(0, 400000);
    if (DEAD.test(body.slice(0, 6000))) return null;

    // The decisive test: links that point at individual postings.
    const hrefs = [...body.matchAll(/href=["']([^"']{6,300})["']/gi)].map((m) => m[1]);
    const postings = new Set(hrefs.filter((h) => JOB_HREF.some((re) => re.test(h))));
    if (postings.size < 2) return null;
    return {
      platform: t.platform,
      slug: t.slug,
      url: res.url,
      postings: postings.size,
      sample: [...postings].slice(0, 2),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
});

let done = 0;
const results = await pool(tasks, 30, (d, n) => {
  done = d;
  if (d % 200 === 0) process.stdout.write(`  ${d}/${n}\r`);
});

const hits = results.filter((r) => r.ok && r.value).map((r) => r.value);
// One board per platform+company, and a generous per-platform cap so the crawl
// still has spares when some turn out to be walled.
const bySlug = new Set();
const perPlatform = new Map();
const kept = [];
for (const h of hits.sort((a, b) => b.postings - a.postings)) {
  const k = `${h.platform}/${h.slug}`;
  if (bySlug.has(k)) continue;
  bySlug.add(k);
  const n = perPlatform.get(h.platform) || 0;
  if (n >= 12) continue;
  perPlatform.set(h.platform, n + 1);
  kept.push(h);
}

await fs.writeFile('data/enterprise-boards.json', JSON.stringify(kept, null, 2));
const summary = {};
for (const k of kept) (summary[k.platform] ||= []).push(`${k.slug}(${k.postings})`);
console.log(`\n${kept.length} boards with real postings, from ${done} probes:\n`);
for (const [p, v] of Object.entries(summary)) console.log(`  ${p.padEnd(16)} ${v.join(' ')}`);
