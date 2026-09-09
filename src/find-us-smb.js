// Finds live US boards on the vendors we still hold no form for.
//
// These are all US-market products (JazzHR, ClearCompany, Dayforce, Workable's
// US customers), so the constraint is not scope but guessing a tenant slug that
// exists. The test is the same one that matters everywhere else: does the page
// actually link to individual postings, rather than merely return a 200 from a
// vendor's marketing or "career page inactive" template.
import fs from 'node:fs/promises';
import { pool, UA } from './lib/util.js';

const JOB_HREF = [
  /\/job\/[\w%-]{3,}/i,
  /\/jobs\/\d+/i,
  /\/apply\/[\w-]{4,}/i,
  /\/position[s]?\/[\w-]+/i,
  /[?&](job|jobid|pid|req|reqid|requisition|jvi|rid)=[\w-]{3,}/i,
  /\/JobDetail/i,
  /\/careers\/jobs\/[\w-]+/i,
];
const DEAD =
  /inactive career page|career section unavailable|404 not found|page (not|cannot be) found|no longer (available|active)|account (suspended|closed|disabled)|coming soon|under construction|no (open )?(positions|jobs|openings)/i;

// US employers of the size these vendors sell to.
const SLUGS = `
acme aerotek insight cdw connection shi zones softchoice presidio worldwide-tech
carvana vroom shift cargurus cars truecar edmunds autotrader carmax
wayfair overstock chewy petco zulily thredup poshmark mercari offerup
grubhub doordash instacart shipt gopuff drizly saucey minibar
compass redfin opendoor offerpad zillow apartments homelight orchard
sofi chime dave earnin brigit moneylion varo current
lemonade hippo kin branch clearcover root policygenius insurify
oscar devoted clover bright cityblock carbonhealth onemedical forward
hims ro curology nurx lemonaid thirtymadison wisp
noom calm headspace whoop oura levels
coursera udacity outschool masterclass skillshare brilliant quizlet chegg
gusto rippling justworks trinet zenefits namely paycor paycom
lattice cultureamp betterup guild
zapier airtable notion coda monday asana clickup smartsheet wrike
loom miro figma invision abstract zeplin
calendly doodle savvycal clockwise reclaim
front intercom zendesk freshworks helpscout gorgias gladly kustomer
twilio sendgrid postmark mailgun sendbird pusher agora
segment amplitude mixpanel heap fullstory logrocket pendo posthog
datadog newrelic dynatrace sumologic splunk sentry rollbar bugsnag
pagerduty opsgenie firehydrant blameless
circleci buildkite harness codefresh
hashicorp pulumi spacelift env0 scalr
snyk veracode checkmarx sonarsource semgrep endor
crowdstrike sentinelone tanium cybereason huntress arcticwolf expel redcanary
okta auth0 duo pingidentity cyberark beyondtrust delinea
onetrust osano transcend ketch securiti bigid
carta pulley ltse forge equityzen
brex ramp divvy expensify navan center airbase
marqeta lithic unit alloy plaid finicity mx yodlee
moderntreasury moov dwolla astra increase column
airbyte fivetran matillion stitch hevo estuary
dbtlabs preset hex mode sigmacomputing thoughtspot
snowflake databricks starburst dremio firebolt
mongodb cockroachlabs planetscale neon supabase xata turso
redis timescale influxdata questdb singlestore yugabyte
confluent redpanda upstash momento tigris
vercel netlify render railway flyio porter northflank
cloudflare fastly bunny akamai stackpath
docker mirantis rancher portainer civo linode digitalocean
mirantis justworks seekout hiretual namely brilliant coda
sonatype nomadhealth workwave fullscript
`.trim().split(/\s+/);

const TEMPLATES = [
  ['jazzhr', (s) => `https://${s}.applytojob.com/apply`],
  ['clearcompany', (s) => `https://${s}.clearcompany.com/careers/jobs`],
  ['dayforce', (s) => `https://jobs.dayforcehcm.com/en-US/${s}/CANDIDATEPORTAL/jobs`],
  ['workable', (s) => `https://apply.workable.com/${s}/`],
  ['teamtailor', (s) => `https://${s}.teamtailor.com/jobs`],
  ['breezy', (s) => `https://${s}.breezy.hr/`],
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

console.log(`Probing ${targets.length} candidate US boards for real job postings...`);

const tasks = targets.map((t) => async () => {
  const res = await fetch(t.url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(14000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.text().catch(() => '')).slice(0, 200000);
  if (!body || DEAD.test(body.slice(0, 8000))) return null;
  const hrefs = [...body.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const postings = new Set(hrefs.filter((h) => JOB_HREF.some((re) => re.test(h))));
  if (postings.size < 2) return null;
  return { platform: t.platform, slug: t.slug, url: res.url, postings: postings.size };
});

const results = await pool(tasks, 24, (d, n) => {
  if (d % 200 === 0) process.stdout.write(`  ${d}/${n}\r`);
});
const hits = results.filter((r) => r.ok && r.value).map((r) => r.value);
await fs.writeFile('data/us-smb-boards.json', JSON.stringify(hits, null, 2));
const by = {};
for (const h of hits) (by[h.platform] ||= []).push(`${h.slug}(${h.postings})`);
console.log(`\n${hits.length} live US boards:\n`);
for (const [p, v] of Object.entries(by)) console.log(`  ${p.padEnd(16)} ${v.slice(0, 14).join(' ')}`);
