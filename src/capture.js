// Drives one page from a job URL to its actual application form, then records
// the form's structure, a screenshot and the raw HTML.
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractFromFrame } from './extract.js';
import { detectPlatform } from './detect.js';
import { fingerprint } from './fingerprint.js';
import { probeWidgets } from './probe-widgets.js';
import { passWall } from './auth.js';
import { captureFullForm } from './shot.js';
import { looksLikeBoard, findJobLinks, openBestJob, primeBoard } from './board.js';
import { slug } from './lib/util.js';

const COOKIE_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '.osano-cm-accept-all',
  '#hs-eu-confirmation-button',
  '#truste-consent-button',
  'button[data-testid="uc-accept-all-button"]',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '[aria-label="Accept cookies" i]',
  'button[id*="accept" i][id*="cookie" i]',
];
const COOKIE_TEXT = /^(accept( all)?( cookies)?|allow all|i agree|got it|ok)$/i;

// Never click social-auth handoffs (they leave the site) or navigation chrome.
const APPLY_AVOID = /with (linkedin|indeed|google|facebook|apple)|autofill with|referral|refer a friend|share|save (this )?job|job alert|back to|privacy|cookie|sign out|help|contact us|support|faq|how to apply|questions\?/i;
// Affordances that reveal a form that is present but collapsed behind a wall.
const APPLY_REVEAL = /sign in with email|continue with email|use email|create (an )?account|apply manually|register|next|continue/i;
// Deliberately excludes anything that submits: this crawler must never file a
// real application. Reaching the form is the whole job.
const APPLY_STRONG = /^(apply|apply now|apply for this job|apply to this job|apply manually|apply here|start application|i'?m interested|apply for job|apply online)$/i;
// Many vendors are European and serve the board in the employer's language, so
// an English-only match walks straight past the apply button. These are the
// exact words those buttons use, kept separate from the loose English matcher
// so a stray word in a paragraph cannot trigger them.
const APPLY_INTL =
  /^(ans[oö]k(?: nu| h[aä]r)?|s[oø]k(?: stillingen| n[aå])?|hae(?: nyt)?|bewerben|jetzt bewerben|bewerbung|postuler|je postule|candidatura|candidati|postularse|solicitar|inscreva-?se|candidatar-?se|solliciteer(?: nu)?|solliciteren|aplicar|s[oó]licitud|ap[pl]ly)$/i;
const NEVER_CLICK = /submit (your )?application|submit application|^submit$|send application|finish and submit/i;
const APPLY_WEAK = /(apply|application|interested|get started|continue)/i;
// Controls that merely contain the word "apply" while doing something else:
// applying a search filter, applying a date range. Clicking these navigates or
// mutates the listing instead of opening an application.
const APPLY_FALSE_FRIEND =
  /apply (filter|filters|search|changes|sort|date|selection)|filter|sort by|select (next|previous|this) (week|month|day)|clear all|reset/i;

// Cloudflare and friends serve an interstitial that clears itself after a few
// seconds. Treating that page as the final answer throws away sites that would
// have let us in if we had simply waited.
const INTERSTITIAL = /just a moment|checking your browser|performing security verification|verifying you are human|one moment please|ddos protection/i;

async function waitOutInterstitial(page, maxMs = 30000) {
  const deadline = Date.now() + maxMs;
  let waited = false;
  while (Date.now() < deadline) {
    const title = (await page.title().catch(() => '')) || '';
    const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400)).catch(() => '');
    if (!INTERSTITIAL.test(`${title} ${text}`)) return waited;
    waited = true;
    await page.waitForTimeout(3000);
  }
  return waited;
}

async function settle(page, ms = 9000) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await waitOutInterstitial(page);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  // SPA application flows (Workday, SmartRecruiters, Eightfold) paint the form
  // well after load, so wait on a visible control in any frame.
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const n = await countControls(page);
    if (n >= 3) break;
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(600);
}

async function countControls(page) {
  let n = 0;
  for (const f of page.frames()) {
    n += await f
      .evaluate(() => document.querySelectorAll('input:not([type=hidden]), select, textarea, [contenteditable="true"]').length)
      .catch(() => 0);
  }
  return n;
}

async function dismissOverlays(page) {
  for (const sel of COOKIE_SELECTORS) {
    const el = await page.$(sel).catch(() => null);
    if (el && (await el.isVisible().catch(() => false))) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    }
  }
  const buttons = await page.$$('button, a[role="button"]').catch(() => []);
  for (const b of buttons.slice(0, 40)) {
    const t = ((await b.innerText().catch(() => '')) || '').trim();
    if (COOKIE_TEXT.test(t) && (await b.isVisible().catch(() => false))) {
      await b.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    }
  }
  return false;
}

// Finds the most plausible "apply" affordance and clicks it. Returns its label.
async function clickApply(page, clicked = new Set()) {
  const candidates = [];
  const els = await page.$$('a, button, [role="button"], input[type="submit"]').catch(() => []);
  for (const el of els.slice(0, 200)) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const text = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const aria = (await el.getAttribute('aria-label').catch(() => '')) || '';
    const href = (await el.getAttribute('href').catch(() => '')) || '';
    const label = (text || aria).slice(0, 80);
    const hay = `${label} ${href}`;
    if (!label && !/apply/i.test(href)) continue;
    if (clicked.has(label)) continue;
    if (APPLY_AVOID.test(label) || NEVER_CLICK.test(label) || APPLY_FALSE_FRIEND.test(label)) continue;
    // Identity-provider handoffs (GitHub, Google, LinkedIn) leave the ATS entirely.
    if (/github\.com|gitlab\.com|accounts\.google\.com|linkedin\.com|facebook\.com|appleid\.apple\.com|signup/i.test(href)) continue;
    let score = 0;
    if (APPLY_STRONG.test(label) || APPLY_INTL.test(label)) score = 100;
    else if (/apply/i.test(href) && label.length < 40) score = 80;
    else if (APPLY_WEAK.test(label) && label.length < 40) score = 40;
    else if (APPLY_REVEAL.test(label)) score = 70; // e.g. Workday's email-vs-OAuth gate
    if (!score) continue;
    if (/manually/i.test(label)) score += 20; // Workday: skip the resume-parse path
    if (/autofill|use my last application/i.test(label)) score -= 30;
    candidates.push({ el, label: label || href, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  const before = page.url();
  // Goldman, Snap and others open the application in a new tab, which the
  // original page never learns about -- the crawler would sit on the job
  // description forever. Watch for the popup, then carry on in this page so the
  // rest of the flow keeps working with a single page object.
  const popup = page.context().waitForEvent('page', { timeout: 12000 }).catch(() => null);
  await Promise.all([
    best.el.click({ timeout: 8000 }).catch(() => {}),
    page.waitForNavigation({ timeout: 12000 }).catch(() => {}),
  ]);
  await page.waitForTimeout(1200);

  const opened = await popup;
  let viaPopup = false;
  if (opened && !opened.isClosed()) {
    await opened.waitForLoadState('domcontentloaded').catch(() => {});
    await opened.waitForTimeout(1500);
    const url = opened.url();
    await opened.close().catch(() => {});
    if (url && url !== 'about:blank' && url !== before) {
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      viaPopup = true;
    }
  }
  return {
    label: best.label + (viaPopup ? ' (new tab)' : ''),
    navigated: page.url() !== before,
    url: page.url(),
  };
}

// Extract from every frame; the frame with the richest form wins.
async function extractBest(page) {
  const frames = page.frames();
  const results = [];
  for (const f of frames) {
    try {
      const r = await f.evaluate(extractFromFrame);
      // The frame handle rides along so widgets can be probed later; it is not
      // enumerated into the saved record.
      if (r) results.push({ ...r, isMain: f === page.mainFrame(), frameRef: f });
    } catch {}
  }
  if (!results.length) return null;
  results.sort((a, b) => b.fieldCount - a.fieldCount || (b.isMain ? -1 : 1));
  const best = results[0];
  const main = results.find((r) => r.isMain) || best;
  // Signals worth keeping even when the form lives in an iframe.
  best.signals = { ...main.signals, ...best.signals };
  best.scripts = [...new Set([...(main.scripts || []), ...(best.scripts || [])])];
  best.frames = [...new Set([...(main.frames || []), ...(best.frames || [])])];
  best.inIframe = !best.isMain;
  return best;
}

// A search page with a keyword box is not an application form: require the
// hallmarks of one (an email/name field or a resume upload) before stopping.
export function looksLikeApplication(form) {
  if (!form || form.fieldCount < 3) return false;
  const fields = form.fields || [];
  const label = (f) => `${f.label || ''} ${f.name || ''} ${f.placeholder || ''}`;
  const any = (re) => fields.some((f) => re.test(label(f)));

  const hasFile = fields.some((f) => f.type === 'file');
  const hasPassword = fields.some((f) => f.type === 'password');
  const hasEmail = fields.some((f) => f.type === 'email') || any(/e-?mail/i);
  const hasName = any(/first name|last name|full name|your name|given name|surname|legal name/i);
  const hasContact = any(/address|phone|mobile|city|state|province|postal|zip|country\/region/i);
  const hasHistory =
    any(/resume|cv\b|cover letter|work experience|employer|job title|university|school|degree|education|years of/i);
  const hasScreening =
    any(/authorized to work|sponsor|visa|relocat|salary|compensation|start date|notice period|how did you hear|why do you want|veteran|disability|gender|ethnic/i);

  // Registration screens: a confirmed password and nothing an employer would
  // actually evaluate. These sit in front of the form, they are not the form.
  const confirms = fields.filter((f) => /retype|confirm|verify|re-?enter/i.test(label(f))).length;
  if (hasPassword && !hasFile && !hasHistory && !hasScreening && (confirms >= 1 || form.fieldCount < 10)) {
    return false;
  }

  // Help desks and contact forms ask for a name, an email and a free-text box,
  // which is enough to look like an application if you only count fields. What
  // gives them away is where they live and what they call themselves.
  const where = `${form.url || ''} ${form.title || ''} ${(form.sections || []).slice(0, 4).join(' ')}`;
  if (/\b(help|support|contact us|customer service|feedback|faq)\b/i.test(where) && !hasFile && !hasScreening) {
    return false;
  }

  // Search pages: every box is a filter.
  const searchy = fields.filter((f) =>
    /search|keyword|\bq\b|query|distance|radius|category|department|sort|filter|alert|how often|subscribe/i.test(label(f))
  ).length;
  if (searchy >= Math.ceil(fields.length * 0.6)) return false;

  // What is left is judged on how much of a candidate profile it collects. Any
  // two independent signals is enough, which lets a wizard step that only asks
  // for name and address count without inventing an email field it never had.
  const signals = [hasFile, hasName, hasHistory, hasScreening, hasEmail && form.fieldCount >= 5, hasContact].filter(
    Boolean
  ).length;
  return signals >= 2;
}

// Tally of how many fields of each interaction type a form has -- the shape an
// automation has to be able to drive.
function controlSummary(fields) {
  const byControl = {};
  const byAction = {};
  const byOptionsSource = {};
  for (const f of fields) {
    const c = f.control || 'unknown';
    byControl[c] = (byControl[c] || 0) + 1;
    const a = f.fill?.action || 'unknown';
    byAction[a] = (byAction[a] || 0) + 1;
    if (f.fill?.optionsFrom) byOptionsSource[f.fill.optionsFrom] = (byOptionsSource[f.fill.optionsFrom] || 0) + 1;
  }
  return { byControl, byAction, byOptionsSource };
}

// Moves a wizard to its next screen. Anything that files the application is
// excluded by NEVER_CLICK, so the walk always stops short of submitting.
async function clickNext(page) {
  const NEXT = /^(save and continue|save & continue|continue|next|next step|save and next)$/i;
  for (const el of (await page.$$('button, [role="button"], input[type="submit"]').catch(() => [])).slice(0, 80)) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const text = ((await el.innerText().catch(() => '')) || (await el.getAttribute('value').catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!NEXT.test(text) || NEVER_CLICK.test(text)) continue;
    const before = page.url();
    await el.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return text + (page.url() === before ? '' : ' (navigated)');
  }
  return null;
}

// Some boards put a gate in front of the form: a single dropdown asking which
// country or language you are applying under (Jobvite's DATA CONSENT screen is
// the common one), with no button -- choosing an option is what renders the
// application. To a crawler this looks like a one-field page and the form is
// never seen at all.
//
// Only fires when the page is clearly not the form yet, and only touches
// dropdowns, so a real question is never answered on the candidate's behalf.
async function passPreFormGate(page) {
  const frame = page.mainFrame();
  const selects = await frame.$$('select').catch(() => []);
  if (!selects.length || selects.length > 2) return null;

  for (const el of selects) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const info = await el
      .evaluate((n) => ({
        label: `${n.name || ''} ${n.id || ''} ${n.getAttribute('aria-label') || ''} ${n.closest('div,label,fieldset')?.innerText || ''}`.slice(0, 200),
        value: n.value,
        options: [...n.options].map((o) => ({ v: o.value, t: (o.textContent || '').trim().slice(0, 60) })),
      }))
      .catch(() => null);
    if (!info || info.options.length < 2) continue;
    // A gate asks where you are, not anything about you.
    if (!/consent|country|location|residence|region|language|locale|privacy/i.test(info.label)) continue;

    const pick = info.options.find(
      (o) => o.v && !/^(0|-1)$/.test(o.v) && !/^(select|please|choose|--)/i.test(o.t)
    );
    if (!pick) continue;
    await el.selectOption(pick.v, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return `gate: ${pick.t}`;
  }
  return null;
}

export async function captureForm(page, seed, dirs, opts = {}) {
  const trail = [];
  // `say` reports a stage live to the monitor without recording it; `step` does
  // both, for the steps that belong in the saved trail.
  const say = opts.onStage || (() => {});
  const step = (s) => {
    trail.push(s);
    say(s);
  };
  const tried = new Set();
  const t0 = Date.now();
  const startUrl = seed.applyUrl || seed.jobUrl;
  say('loading page');
  const resp = await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch((e) => {
    throw new Error(`goto failed: ${e.message.split('\n')[0]}`);
  });
  say('waiting for form to render');
  await settle(page);
  await dismissOverlays(page);

  say('reading fields');
  let form = await extractBest(page);

  // Many seeds are only a board root, so the first thing on screen is a search
  // page. Walk it to an actual posting before hunting for an apply button --
  // otherwise the keyword and location boxes get mistaken for the whole story.
  const visitedJobs = new Set();
  for (let boardHop = 0; boardHop < 3; boardHop++) {
    if (looksLikeApplication(form)) break;
    let links = await findJobLinks(page, seed.title || '');
    if (!links.length) {
      // An empty or splash-screen board lists nothing until it is nudged.
      const primed = await primeBoard(page);
      if (primed) {
        step(`primed board: ${primed}`);
        await settle(page);
        links = await findJobLinks(page, seed.title || '');
      }
    }
    if (!looksLikeBoard(form, links.length)) break;
    say(`on a job board (${links.length} postings) - opening one`);
    const opened = await openBestJob(page, { wantTitle: seed.title || '', skip: visitedJobs });
    if (!opened) break;
    visitedJobs.add(opened.href);
    step(`opened posting: ${opened.title || opened.href.slice(0, 60)}`);
    await settle(page);
    await dismissOverlays(page);
    form = await extractBest(page);
  }

  let hops = 0;
  while (!looksLikeApplication(form) && hops < 4) {
    say('looking for the apply button');
    const clicked = await clickApply(page, tried);
    if (!clicked) break;
    tried.add(clicked.label);
    step(`clicked: ${clicked.label}`);
    hops++;
    await settle(page);
    await dismissOverlays(page);
    // Give slow SPA forms a few extra beats before giving up on this hop.
    for (let i = 0; i < 4; i++) {
      const next = await extractBest(page);
      if (next && (!form || next.fieldCount > form.fieldCount)) form = next;
      if (looksLikeApplication(form)) break;
      await page.waitForTimeout(1500);
    }
    // Some boards route "apply" back to a listing (or the posting turned out to
    // be a dead link); if we are staring at a board again, step through it.
    if (!looksLikeApplication(form)) {
      const links = await findJobLinks(page, seed.title || '');
      if (looksLikeBoard(form, links.length)) {
        const opened = await openBestJob(page, { wantTitle: seed.title || '', skip: visitedJobs });
        if (opened) {
          visitedJobs.add(opened.href);
          step(`opened posting: ${opened.title || opened.href.slice(0, 60)}`);
          await settle(page);
          await dismissOverlays(page);
          form = await extractBest(page);
        }
      }
    }
  }

  // Still nothing that looks like a form? It may be sitting behind a consent or
  // locale gate rather than a login.
  if (!looksLikeApplication(form)) {
    const gate = await passPreFormGate(page).catch(() => null);
    if (gate) {
      step(gate);
      await settle(page, 8000);
      const next = await extractBest(page);
      if (next && next.fieldCount > (form?.fieldCount || 0)) form = next;
    }
  }

  // Sign-in walls (Workday, Oracle, iCIMS) hide the real first step behind
  // "Create Account" -- that registration form is part of applying, so take it.
  if (form && form.signals?.hasPasswordField && form.fieldCount < 6) {
    const els = await page.$$('a, button, [role="button"]').catch(() => []);
    for (const el of els.slice(0, 120)) {
      const t = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (!/^create (an )?account$/i.test(t)) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.click({ timeout: 6000 }).catch(() => {});
      step(`clicked: ${t}`);
      await settle(page, 6000);
      const next = await extractBest(page);
      if (next && next.fieldCount > form.fieldCount) form = next;
      break;
    }
  }

  // Last resort for portals that render nothing until you have an account:
  // register a throwaway persona, clear any emailed verification, and try again.
  let auth = null;
  if (!looksLikeApplication(form) && opts.identity) {
    say('behind a sign-in wall, registering');
    auth = await passWall(page, seed, opts.identity, { profileDir: 'data/profiles', onStage: say }).catch((e) => ({
      ok: false,
      why: String(e?.message || e).slice(0, 140),
      trail: [],
    }));
    trail.push(...(auth.trail || []));
    if (auth.ok) {
      await settle(page, 12000);
      await dismissOverlays(page);
      const before = form;
      form = await extractBest(page);
      let hops2 = 0;
      while (!looksLikeApplication(form) && hops2 < 3) {
        say('signed in, looking for the form');
        const clicked = await clickApply(page, tried);
        if (!clicked) break;
        tried.add(clicked.label);
        step(`clicked: ${clicked.label}`);
        hops2++;
        await settle(page, 9000);
        const next = await extractBest(page);
        if (next && (!form || next.fieldCount > form.fieldCount)) form = next;
      }
      if (!form) form = before;
    }
  }

  const finalUrl = page.url();
  const { platform, platformLabel } = detectPlatform(finalUrl, {
    scripts: form?.scripts || [],
    frames: form?.frames || [],
  });

  const reached = looksLikeApplication(form);
  // Artifacts are grouped by platform so forms from the same vendor can be
  // reviewed side by side; captures that never reached a form are set aside.
  // Grouping is what the reviewer actually sees, so a vendor's forms must land
  // in the vendor's folder even when the employer has white-labelled the host.
  const VENDORS = new Set([
    'greenhouse', 'lever', 'ashby', 'workday', 'icims', 'taleo', 'successfactors', 'oracle-hcm',
    'jobvite', 'avature', 'eightfold', 'phenom', 'smartrecruiters', 'workable', 'recruitee',
    'breezy', 'bamboohr', 'rippling', 'dayforce', 'clearcompany', 'jazzhr', 'pinpoint',
    'teamtailor', 'personio', 'paylocity', 'adp', 'ukg', 'gem', 'dover',
  ]);
  const seedVendor = String(seed.ats || '').toLowerCase();
  const effective = platform.startsWith('custom:') && VENDORS.has(seedVendor) ? seedVendor : platform;
  const group = effective.replace(/[^a-z0-9]+/gi, '-');
  const base = `${slug(seed.company || seed.board || 'unknown')}__${slug(seed.title).slice(0, 40)}`;
  const shotDir = path.join(dirs.screenshots, reached ? group : path.join('_unreached', group));
  const htmlDir = path.join(dirs.html, reached ? group : path.join('_unreached', group));
  await fs.mkdir(shotDir, { recursive: true });
  await fs.mkdir(htmlDir, { recursive: true });
  const shotPath = path.join(shotDir, `${base}.png`);
  const htmlPath = path.join(htmlDir, `${base}.html`);

  say(reached ? 'screenshotting the whole form' : 'screenshotting (no form reached)');
  const shot = await captureFullForm(page, form?.frameRef, shotPath).catch(() => ({ ok: false }));
  if (shot.coversAllFields === false) {
    say(`screenshot may be short (${Math.round(shot.lowestField || 0)}px of form, ${shot.docHeight || 0}px captured)`);
  }
  const html = await page.content().catch(() => '');
  await fs.writeFile(htmlPath, html).catch(() => {});

  // Probing opens dropdowns and calendars, so it runs after the screenshot to
  // keep the reviewable image of the form pristine.
  let probe = { probed: 0 };
  if (reached && process.env.PROBE_WIDGETS !== '0' && form?.frameRef) {
    say('probing dropdowns and calendars');
    probe = await probeWidgets(page, form.frameRef, form, {
      budgetMs: Number(process.env.PROBE_BUDGET_MS || 120000),
      maxWidgets: Number(process.env.PROBE_MAX_WIDGETS || 40),
    }).catch(() => ({ probed: 0, error: true }));
  }

  // Wizards (Workday, iCIMS, Oracle) spread the application over several
  // screens that look nothing alike, so each one is captured in its own right.
  // Advancing only ever uses "next"-style buttons; submitting is never clicked.
  const steps = [];
  if (reached && form?.signals?.multiStep && process.env.CAPTURE_STEPS !== '0') {
    const maxSteps = Number(process.env.MAX_STEPS || 6);
    for (let n = 2; n <= maxSteps; n++) {
      const advanced = await clickNext(page);
      if (!advanced) break;
      await settle(page, 9000);
      await dismissOverlays(page);
      const next = await extractBest(page);
      if (!next || next.fieldCount === 0) break;
      const sig = (f) => (f.fields || []).map((x) => x.label).join('|');
      if (sig(next) === sig(form) && next.fieldCount === form.fieldCount) break; // validation blocked us
      const stepShot = path.join(shotDir, `${base}__step${n}.png`);
      const stepShotInfo = await captureFullForm(page, next.frameRef, stepShot).catch(() => ({ ok: false }));
      if (process.env.PROBE_WIDGETS !== '0' && next.frameRef) {
        await probeWidgets(page, next.frameRef, next, { budgetMs: 25000, maxWidgets: 12 }).catch(() => {});
      }
      say(`step ${n}: ${next.fieldCount} fields (${advanced})`);
      steps.push({
        step: n,
        via: advanced,
        url: page.url(),
        heading: (next.sections || [])[2] || (next.sections || [])[0] || '',
        fieldCount: next.fieldCount,
        fields: next.fields,
        controls: controlSummary(next.fields || []),
        screenshot: stepShot,
        shot: stepShotInfo,
      });
      form.fields = [...(form.fields || []), ...(next.fields || [])];
    }
  }

  const blocked =
    /captcha-delivery|hcaptcha|recaptcha\/api2\/bframe|cf-challenge|perimeterx|px-captcha/i.test(
      (form?.frames || []).join(' ')
    ) || /access denied|verify you are (a )?human|unusual traffic|are you a robot/i.test(form?.title || '');

  const record = {
    id: `${group}__${base}`,
    group,
    ok: !!form && form.fieldCount > 0,
    isApplicationForm: reached,
    blocked,
    status: resp?.status() ?? null,
    seed: {
      ats: seed.ats,
      atsLabel: seed.atsLabel,
      company: seed.company,
      board: seed.board,
      title: seed.title,
      location: seed.location,
      jobUrl: seed.jobUrl,
      startUrl,
    },
    platform: effective,
    detectedPlatform: platform,
    platformLabel: effective === platform ? platformLabel : `${platformLabel} (${seedVendor})`,
    finalUrl,
    applyTrail: trail,
    steps,
    stepCount: steps.length ? steps.length + 1 : 1,
    auth: auth ? { ok: auth.ok, why: auth.why || null, via: auth.verification?.via || null } : null,
    inIframe: form?.inIframe || false,
    pageTitle: form?.title || (await page.title().catch(() => '')),
    fieldCount: form?.fieldCount || 0,
    fields: form?.fields || [],
    controls: controlSummary(form?.fields || []),
    widgetsProbed: probe.probed,
    widgetsSkipped: probe.skipped || 0,
    widgets: form?.widgets || [],
    sections: form?.sections || [],
    buttons: form?.buttons || [],
    resumeUpload: form?.resumeUpload || [],
    signals: form?.signals || {},
    artifacts: { screenshot: shotPath, html: htmlPath },
    // Whether the image actually contains the whole form, and what had to be
    // done to make that true.
    shot,
    ms: Date.now() - t0,
  };
  record.fingerprint = fingerprint(record);
  return record;
}
