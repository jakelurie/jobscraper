// Turns a job *board* into a job *posting*.
//
// A large share of our seeds are only ever a board root -- `/jobs/search`,
// `/careers/jobs`, a SearchJobs page -- because that is all the tenant probe
// could discover. Landing there, the crawler finds a keyword box and a location
// box, decides that is not an application form, and gives up. Nothing is walled;
// a hop is simply missing. This module supplies it: recognise the listing page,
// pick a plausible posting, and open it so the normal apply flow can continue.

// URL shapes that identify a single posting rather than a list of them.
const JOB_HREF = [
  /\/job\/[\w%-]{3,}/i,
  /\/jobs\/\d+/i,
  /\/jobs\/[\w-]*\d[\w-]*$/i,
  /\/position[s]?\/[\w-]+/i,
  /\/opening[s]?\/[\w-]+/i,
  /\/vacanc(y|ies)\/[\w-]+/i,
  /\/careers?\/[\w-]+-\d{3,}/i,
  /[?&](job|jobid|jobId|pid|req|reqid|requisition|gh_jid|jvi|id)=[\w-]{3,}/i,
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, // uuid-style posting ids
  /\/JobDetail/i,
  /\/ProjectDetail\//i,
  /\/jobdetails?\?/i,
  /\/job-detail/i,
];

// Links that look job-ish but lead somewhere useless.
const JOB_HREF_AVOID =
  /\/(search|results|browse|categor|department|discipline|location|team|alert|login|signin|sign-in|register|privacy|cookie|faq|help|support|benefits|culture|about)\b|mailto:/i;

// Share buttons and consent portals embed the job URL inside their own link, so
// they match every posting pattern while leading nowhere useful.
const OFFSITE =
  /facebook\.com|twitter\.com|x\.com\/intent|linkedin\.com|indeed\.com|glassdoor|reddit\.com|whatsapp|telegram|pinterest|sharer|\/share[?\/]|mailto|onetrust\.com|privacyportal|cookiepro|trustarc/i;

// Boxes that mean "you are on a search page", not "you are on a form".
const SEARCH_FIELD =
  /search|keyword|\bq\b|query|location|city|state|country|distance|radius|category|department|sort|filter|alert|how often|subscribe|email me|postal|zip/i;

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|distinguished|iii|iv)\b/i;
const ENGINEER = /\b(engineer|engineering|developer|swe|sde|programmer|architect)\b/i;

// Is what we are looking at a list of jobs rather than an application form?
// Deliberately conservative: a page only counts as a board when every control on
// it is search-shaped, so a real form is never mistaken for one.
export function looksLikeBoard(form, jobLinkCount) {
  if (jobLinkCount < 2) return false;
  const fields = form?.fields || [];
  if (!fields.length) return true; // links but no inputs at all: a plain listing
  if (fields.length > 12) return false;
  const searchy = fields.filter((f) =>
    SEARCH_FIELD.test(`${f.label || ''} ${f.name || ''} ${f.placeholder || ''}`)
  ).length;
  const hasApplyish = fields.some(
    (f) => f.type === 'file' || /resume|cv\b|cover letter|first name|last name|full name/i.test(f.label || '')
  );
  if (hasApplyish) return false;
  return searchy >= Math.ceil(fields.length * 0.6);
}

// Every plausible posting link on the page, best first.
export async function findJobLinks(page, wantTitle = '') {
  const perFrame = await Promise.all(
    page.frames().map((f) =>
      f
        .evaluate(() =>
          [...document.querySelectorAll('a[href]')]
            .map((a) => {
              const r = a.getBoundingClientRect();
              return {
                href: a.href,
                text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
                visible: r.width > 0 && r.height > 0,
                top: r.top,
              };
            })
            .filter((x) => x.href && /^https?:/.test(x.href))
        )
        .catch(() => [])
    )
  );

  const seen = new Set();
  const out = [];
  for (const link of perFrame.flat()) {
    const bare = link.href.split('#')[0];
    if (seen.has(bare)) continue;
    if (JOB_HREF_AVOID.test(link.href) || OFFSITE.test(link.href)) continue;
    if (!JOB_HREF.some((re) => re.test(link.href))) continue;
    seen.add(bare);

    let score = 0;
    if (link.visible) score += 5;
    if (link.text.length > 6) score += 3;
    if (ENGINEER.test(link.text)) score += 20;
    if (SENIOR.test(link.text)) score += 12;
    if (wantTitle && link.text && wantTitle.toLowerCase().slice(0, 24) === link.text.toLowerCase().slice(0, 24)) score += 30;
    if (/engineer|developer|software/i.test(link.href)) score += 6;
    // Prefer links near the top: boards list the freshest, most relevant first.
    score -= Math.min(6, Math.max(0, link.top) / 500);
    out.push({ ...link, href: bare, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// Boards that open empty ("We could not find any jobs based on your search")
// or behind a "View jobs" splash have no postings to link to until something is
// clicked. Nudging them is the difference between a dead page and a form.
const PRIME = /^(search jobs?|view (all )?jobs?|see all (jobs?|openings?|opportunities)|all jobs|browse jobs?|show all|view openings?|find jobs?|search)$/i;

// Priming navigates away from whatever is on screen, so it must only ever run
// on a page that really is an empty board. A single job posting also has no job
// links on it, and clicking "View jobs" there throws away the very posting we
// were sent to capture -- which is exactly how Meta's applications were being
// lost to the search page.
export async function looksLikePosting(page) {
  return page
    .evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const APPLY = /^(apply|apply now|apply for this job|apply to this job|apply here|submit application|start application|i'?m interested)$/i;
      for (const el of document.querySelectorAll('a, button, [role="button"]')) {
        if (!vis(el)) continue;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (APPLY.test(t)) return true;
      }
      return false;
    })
    .catch(() => false);
}

export async function primeBoard(page) {
  // An apply affordance means this is a posting, not a board with nothing on it.
  if (await looksLikePosting(page)) return null;
  for (const el of (await page.$$('a, button, [role="button"]').catch(() => [])).slice(0, 80)) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const t = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!PRIME.test(t)) continue;
    await el.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(3500);
    return t;
  }
  return null;
}

// Opens the most promising posting. Returns what it chose, or null if the page
// offers nothing that looks like one.
export async function openBestJob(page, { wantTitle = '', skip = new Set() } = {}) {
  const links = (await findJobLinks(page, wantTitle)).filter((l) => !skip.has(l.href));
  if (!links.length) return null;
  const pick = links[0];
  const before = page.url();
  await page.goto(pick.href, { waitUntil: 'domcontentloaded' }).catch(() => {});
  if (page.url() === before) return null;
  return { href: pick.href, title: pick.text, candidates: links.length };
}
