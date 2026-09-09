// Finds live tenants on the ATS vendors we hold no forms for.
//
// Breadth is the goal here, not seniority: one Workable form looks like every
// other Workable form regardless of the job title on it, so the filter is
// simply "is this a real board with a real posting". These vendors all expose a
// public JSON board API, which makes probing hundreds of candidate slugs cheap.
import fs from 'node:fs/promises';
import { pool, UA, keepIfUS } from './lib/util.js';

// US employers only. The earlier list was seeded with European names, which is
// how a sweep of six vendors came back with Greek, German and Dutch boards --
// correct results for the wrong scope. Personio is dropped entirely: it is a
// German product whose customers are almost exclusively European.
const CANDIDATES = `
workable persado scalable hubstaff olo toast flywire klaviyo drift chewy wayfair peloton
casper warbyparker allbirds glossier away harrys quip ritual care-of thrive-market
instacart doordash grubhub postmates seamless caviar shipt gopuff getir-us
lyft bird lime veo spin getaround turo zipcar carvana vroom shift cazoo-us
opendoor compass redfin zillow trulia apartments homelight orchard knock-homes
betterment wealthfront acorns stash public robinhood sofi chime dave earnin
lemonade root hippo kin next-insurance pie-insurance clearcover branch
oscar-health devoted-health bright-health clover-health cityblock carbon-health
onemedical forward parsley hims ro curology nurx lemonaid thirty-madison
calm headspace noom whoop oura levels function-health
duolingo coursera udacity outschool masterclass skillshare brilliant quizlet
chegg course-hero varsity-tutors wyzant preply cambly
gusto rippling justworks trinet zenefits namely bamboohr paylocity paycom
lattice culture-amp fifteen-five leapsome betterup guild
greenhouse lever ashby gem dover findem seekout hiretual fetcher
zapier airtable notion coda monday asana clickup smartsheet wrike basecamp
loom miro figma canva-us invision framer-us abstract zeplin
calendly doodle savvycal cal-com clockwise reclaim motion
front intercom zendesk freshworks helpscout gorgias gladly kustomer
twilio sendgrid postmark mailgun sendbird pusher ably agora
segment amplitude mixpanel heap fullstory logrocket pendo posthog
datadog newrelic dynatrace sumologic splunk sentry rollbar bugsnag
pagerduty opsgenie incident-io firehydrant blameless
circleci buildkite harness codefresh jenkins-x argo
hashicorp pulumi terraform-cloud spacelift env0 scalr
snyk veracode checkmarx sonarsource semgrep endor
crowdstrike sentinelone tanium cybereason huntress arcticwolf expel redcanary
okta auth0 duo pingidentity cyberark beyondtrust delinea
onetrust osano transcend ketch securiti bigid
carta pulley ltse forge equityzen angellist
brex ramp divvy expensify navan tripactions center airbase
stripe square block adyen-us checkout-us marqeta lithic unit alloy
plaid finicity mx yodlee teller-io method-fi
modern-treasury moov dwolla astra increase column
airbyte fivetran matillion stitch hevo estuary
dbt-labs preset hex mode sigma-computing thoughtspot looker
snowflake databricks starburst dremio firebolt clickhouse-us
mongodb cockroachlabs planetscale neon-tech supabase-us xata turso
redis timescale influxdata questdb singlestore yugabyte
confluent redpanda upstash momento tigris
vercel netlify render railway flyio porter northflank
cloudflare fastly bunny akamai stackpath
docker mirantis rancher portainer civo linode digitalocean

mixmax lever-co apollo outreach salesloft chorus gong clari people-ai
grain fathom otter rev descript riverside streamyard restream
webflow squarespace wix duda weebly bigcommerce shopify-us volusion
klaviyo attentive postscript emotive yotpo okendo stamped junip
gorgias richpanel reamaze tidio crisp drift qualified
recharge bold smile loyaltylion swell antavo
shipbob shipmonk shipstation easypost shippo aftership route
stord flexe flowspace deliverr cart ryder convoy loadsmart project44
gembah jungle-scout helium10 sellerlabs teikametrics perpetua
buildium appfolio yardi entrata realpage rentmanager
procore plangrid buildertrend fieldwire raken bluebeam
servicetitan jobber housecallpro workiz skedulo fieldpulse
toast lightspeed clover-pos revel touchbistro upserve
opentable resy tock sevenrooms yelp-reservations
mindbody zenoti booker vagaro glossgenius boulevard
classpass peloton-interactive tonal mirror hydrow ergatta
strava whoop-inc trainerize truecoach everfit
kajabi teachable thinkific podia gumroad patreon substack ghost
convertkit mailchimp klaviyo-us drip activecampaign hubspot-us
`.trim().split(/\s+/);

// [platform, url from slug, extract postings from the response]
const APIS = [
  [
    'workable',
    (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`,
    (d, s) =>
      (d.jobs || []).map((x) => ({
        title: x.title,
        location: [x.city, x.country].filter(Boolean).join(', '),
        jobUrl: x.url,
        applyUrl: x.application_url || `${x.url}/apply`,
      })),
  ],
  [
    'recruitee',
    (s) => `https://${s}.recruitee.com/api/offers/`,
    (d) =>
      (d.offers || []).map((x) => ({
        title: x.title,
        location: x.location || '',
        jobUrl: x.careers_url,
        applyUrl: x.careers_apply_url || `${x.careers_url}/apply`,
      })),
  ],
  [
    'breezy',
    (s) => `https://${s}.breezy.hr/json`,
    (d) =>
      (Array.isArray(d) ? d : []).map((x) => ({
        title: x.name,
        location: x.location?.name || '',
        jobUrl: x.url,
        applyUrl: `${x.url}/applicant/new`,
      })),
  ],
  [
    'bamboohr',
    (s) => `https://${s}.bamboohr.com/careers/list`,
    (d, s) =>
      (d.result || []).map((x) => ({
        title: x.jobOpeningName,
        location: [x.location?.city, x.location?.state].filter(Boolean).join(', '),
        jobUrl: `https://${s}.bamboohr.com/careers/${x.id}`,
        applyUrl: `https://${s}.bamboohr.com/careers/${x.id}`,
      })),
  ],
  [
    'smartrecruiters',
    (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=20`,
    (d, s) =>
      (d.content || []).map((x) => ({
        title: x.name,
        location: [x.location?.city, x.location?.country].filter(Boolean).join(', '),
        jobUrl: `https://jobs.smartrecruiters.com/${x.company?.identifier || s}/${x.id}`,
        applyUrl: `https://jobs.smartrecruiters.com/${x.company?.identifier || s}/${x.id}`,
      })),
  ],
];

const ENGINEERING = /engineer|developer|software|technical|data|platform|infrastructure|devops|sre|architect|programmer|qa|test/i;

const tasks = [];
for (const [platform, url, pick] of APIS) {
  for (const slug of CANDIDATES) {
    tasks.push(async () => {
      const res = await fetch(url(slug), {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data) return null;
      const all = pick(data, slug).filter((j) => j.title && j.jobUrl);
      // Out of scope unless the posting is in the United States. Unknown
      // locations are dropped too here: a vendor with a European customer base
      // produces enough false positives that guessing is not worth it.
      const jobs = all.filter((j) => keepIfUS(j.location, '', { allowUnknown: false }));
      if (!jobs.length) return null;
      return { platform, slug, jobs, foreign: all.length - jobs.length };
    });
  }
}

console.log(`Probing ${tasks.length} candidate boards across ${APIS.length} ATS vendors (US postings only)...`);
const results = await pool(tasks, 24, (d, n) => {
  if (d % 100 === 0) process.stdout.write(`  ${d}/${n}\r`);
});

const hits = results.filter((r) => r.ok && r.value).map((r) => r.value);
const PER_BOARD = Number(process.env.PER_BOARD || 4);
const PER_PLATFORM = Number(process.env.PER_PLATFORM || 26);

const targets = [];
const spent = new Map();
for (const h of hits.sort((a, b) => b.jobs.length - a.jobs.length)) {
  const used = spent.get(h.platform) || 0;
  if (used >= PER_PLATFORM) continue;
  // Prefer engineering roles, but any posting proves the form out.
  const eng = h.jobs.filter((j) => ENGINEERING.test(j.title));
  const chosen = (eng.length ? eng : h.jobs).slice(0, PER_BOARD);
  spent.set(h.platform, used + chosen.length);
  for (const j of chosen) {
    targets.push({
      ats: h.platform,
      atsLabel: h.platform,
      board: h.slug,
      company: h.slug,
      title: j.title,
      location: j.location,
      jobUrl: j.jobUrl,
      applyUrl: j.applyUrl,
      source: 'breadth-api',
    });
  }
}

await fs.writeFile('data/breadth-api-targets.json', JSON.stringify(targets, null, 2));
const boards = {};
for (const h of hits) (boards[h.platform] ||= []).push(`${h.slug}(${h.jobs.length})`);
console.log(`\n${hits.length} live boards found:\n`);
for (const [p, v] of Object.entries(boards)) console.log(`  ${p.padEnd(16)} ${v.slice(0, 12).join(' ')}`);
const by = {};
for (const t of targets) by[t.ats] = (by[t.ats] || 0) + 1;
console.log(`\n${targets.length} postings queued:`, by);
