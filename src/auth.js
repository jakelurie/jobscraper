// Gets past the account walls that hide an application form. Many large
// employers (Workday, iCIMS, SuccessFactors, Oracle HCM, Taleo) will not render
// a single question until you have registered, so the form itself is invisible
// to a crawler that stops at the sign-in page.
//
// This registers a throwaway persona, answers an emailed verification code or
// link if one is demanded, and hands the page back sitting on the real form.
// It never submits an application.
import fs from 'node:fs/promises';
import path from 'node:path';
import { waitForVerification } from './mailbox.js';

const CREATE_ACCOUNT = /^(create (an? )?account|create account\/sign in|sign up|register|new user|create profile|join now|create an account to apply)/i;
const SUBMIT_REGISTRATION = /^(create account|create my account|create an account|sign up|register|submit|continue|next|save and continue|agree and continue)$/i;
const SIGN_IN_BTN = /^(sign in|log ?in|continue)$/i;
const CAPTCHA = /recaptcha\/api2\/(anchor|bframe)|hcaptcha|turnstile|captcha-delivery|px-captcha|funcaptcha|arkoselabs/i;

const visibleButtons = async (page) => {
  const out = [];
  for (const el of (await page.$$('button, a[role="button"], input[type="submit"], [role="button"]').catch(() => [])).slice(0, 120)) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const text = (
      (await el.innerText().catch(() => '')) ||
      (await el.getAttribute('value').catch(() => '')) ||
      (await el.getAttribute('aria-label').catch(() => '')) ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (text) out.push({ el, text });
  }
  return out;
};

async function clickByText(page, re, { timeout = 8000 } = {}) {
  for (const b of await visibleButtons(page)) {
    if (!re.test(b.text)) continue;
    await b.el.click({ timeout }).catch(() => {});
    return b.text;
  }
  return null;
}

// Legacy portals (SuccessFactors, Taleo) validate on real keystrokes and on
// blur, so a value assigned straight into the field is rejected as empty even
// though it is plainly visible. Typing it, then moving focus away, is what makes
// the validator see it.
async function enter(el, value) {
  const ok = await el
    .click({ timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return false;
  await el.press('Control+a').catch(() => {});
  await el.press('Meta+a').catch(() => {});
  await el.press('Delete').catch(() => {});
  await el.type(value, { delay: 25, timeout: 15000 }).catch(() => {});
  let got = await el.inputValue().catch(() => '');
  if (got !== value) {
    // Fields that refuse synthesised keystrokes (retype-email boxes often block
    // paste and autofill) still accept an assignment, as long as the events a
    // validator listens for are raised by hand afterwards.
    await el
      .evaluate((n, v) => {
        const setter = Object.getOwnPropertyDescriptor(n.constructor.prototype, 'value')?.set;
        setter ? setter.call(n, v) : (n.value = v);
        n.dispatchEvent(new Event('input', { bubbles: true }));
        n.dispatchEvent(new Event('keyup', { bubbles: true }));
      }, value)
      .catch(() => {});
    got = await el.inputValue().catch(() => '');
  }
  // Blur so change/validate handlers run before the next field is touched.
  await el.evaluate((n) => n.dispatchEvent(new Event('change', { bubbles: true }))).catch(() => {});
  await el.press('Tab').catch(() => {});
  return got.length > 0;
}

async function fillFirst(scope, selectors, value) {
  for (const sel of selectors) {
    const el = await scope.$(sel).catch(() => null);
    if (!el) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    await enter(el, value);
    return sel;
  }
  return null;
}

// Where the form lives: usually the main frame, occasionally an embedded one.
async function authFrame(page) {
  for (const f of page.frames()) {
    const n = await f.evaluate(() => document.querySelectorAll('input[type="password"]').length).catch(() => 0);
    if (n) return f;
  }
  return page.mainFrame();
}

async function hasCaptcha(page) {
  const inFrames = page.frames().some((f) => CAPTCHA.test(f.url()));
  if (inFrames) return true;
  return page
    .evaluate((re) => new RegExp(re, 'i').test(document.documentElement.outerHTML.slice(0, 300000)), CAPTCHA.source)
    .catch(() => false);
}

// Fills whatever registration form is on screen with the persona's details.
async function fillRegistration(page, frame, identity) {
  const filled = [];
  const emails = await frame.$$('input[type="email"], input[name*="email" i], input[id*="email" i], input[data-automation-id*="email" i]').catch(() => []);
  let i = 0;
  for (const el of emails) {
    if (!(await el.isVisible().catch(() => false))) continue;
    if (!(await enter(el, identity.email))) continue;
    filled.push(i++ === 0 ? 'email' : 'email-confirm');
  }

  const passwords = await frame.$$('input[type="password"]').catch(() => []);
  let p = 0;
  for (const el of passwords) {
    if (!(await el.isVisible().catch(() => false))) continue;
    if (!(await enter(el, identity.portalPassword))) continue;
    filled.push(p++ === 0 ? 'password' : 'password-confirm');
  }

  const first = await fillFirst(frame, ['input[name*="first" i]', 'input[id*="first" i]', 'input[data-automation-id*="firstName" i]', 'input[autocomplete="given-name"]'], identity.firstName);
  if (first) filled.push('first-name');
  const last = await fillFirst(frame, ['input[name*="last" i]', 'input[id*="last" i]', 'input[data-automation-id*="lastName" i]', 'input[autocomplete="family-name"]'], identity.lastName);
  if (last) filled.push('last-name');

  // Registration screens vary in what else they demand -- a phone number, a
  // country, a security question. Anything still required and still empty gets
  // a sensible answer, because one blank required field blocks the whole form.
  for (const el of (await frame.$$('select').catch(() => [])).slice(0, 12)) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const info = await el
      .evaluate((n) => ({
        label: `${n.name || ''} ${n.id || ''} ${n.getAttribute('aria-label') || ''} ${n.closest('div,tr,label')?.innerText || ''}`.slice(0, 160),
        value: n.value,
        options: [...n.options].map((o) => ({ t: (o.textContent || '').trim().slice(0, 40), v: o.value })),
      }))
      .catch(() => null);
    if (!info || info.options.length < 2) continue;
    if (info.value && !/^(|0|-1|select|please)$/i.test(info.value)) continue;
    const want = /country|region|nation/i.test(info.label)
      ? /united states|usa|^us$/i
      : /state|province/i.test(info.label)
        ? /california/i
        : null;
    const pick =
      (want && info.options.find((o) => want.test(o.t))) ||
      info.options.find((o) => o.v && !/^(|0|-1)$/.test(o.v) && !/^(select|please|choose)/i.test(o.t));
    if (!pick) continue;
    await el.selectOption(pick.v, { timeout: 4000 }).catch(() => {});
    filled.push('select');
  }

  for (const el of (await frame.$$('input[type="text"], input[type="tel"], input:not([type])').catch(() => [])).slice(0, 20)) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const info = await el
      .evaluate((n) => ({
        required: n.required || n.getAttribute('aria-required') === 'true' || /\*/.test(n.closest('div,tr,label')?.innerText || ''),
        empty: !n.value,
        label: `${n.name || ''} ${n.id || ''} ${n.getAttribute('aria-label') || ''} ${n.placeholder || ''} ${n.closest('div,tr,label')?.innerText || ''}`.slice(0, 160),
      }))
      .catch(() => null);
    if (!info || !info.required || !info.empty) continue;
    const l = info.label;
    if (/captcha|verification code|security code/i.test(l)) continue; // cannot be guessed
    const value = /phone|mobile|telephone/i.test(l)
      ? identity.phone
      : /city/i.test(l)
        ? identity.city
        : /postal|zip/i.test(l)
          ? identity.postalCode
          : /address|street/i.test(l)
            ? identity.address
            : /state|province/i.test(l)
              ? identity.state
              : /country/i.test(l)
                ? identity.country
                : /first|given/i.test(l)
                  ? identity.firstName
                  : /last|family|surname/i.test(l)
                    ? identity.lastName
                    : null;
    if (!value) continue;
    if (await enter(el, value)) filled.push('required-field');
  }

  // Some portals track that the privacy statement was *opened*, not merely
  // agreed to, and reject the registration otherwise. Opening it costs nothing
  // when it is not required, so do it before touching the consent boxes.
  for (const link of (await frame.$$('a[href], button').catch(() => [])).slice(0, 60)) {
    const t = ((await link.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!/data privacy (statement|policy)|privacy statement|data protection notice/i.test(t)) continue;
    if (!(await link.isVisible().catch(() => false))) continue;
    const popup = page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await link.click({ timeout: 4000 }).catch(() => {});
    const opened = await popup;
    if (opened) await opened.close().catch(() => {});
    await page.waitForTimeout(1200);
    // A modal may now be covering the form; dismiss it before carrying on.
    for (const close of (await page.$$('button, [role="button"]').catch(() => [])).slice(0, 40)) {
      const ct = ((await close.innerText().catch(() => '')) || '').trim();
      if (!/^(close|ok|i agree|agree|accept|done|got it|×|x)$/i.test(ct)) continue;
      if (!(await close.isVisible().catch(() => false))) continue;
      await close.click({ timeout: 3000 }).catch(() => {});
      break;
    }
    filled.push('opened-privacy-statement');
    break;
  }

  // Terms / privacy consent. The visible copy sometimes sits far from the box
  // (Workday labels its only checkbox purely by automation id), so the
  // attributes count as evidence too, and a required box is always ticked.
  for (const box of (await frame.$$('input[type="checkbox"]').catch(() => [])).slice(0, 8)) {
    if (!(await box.isVisible().catch(() => false))) continue;
    const info = await box
      .evaluate((el) => ({
        near: (el.closest('label, div, li')?.innerText || '').slice(0, 200),
        attrs: `${el.getAttribute('data-automation-id') || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`,
        required: el.required || el.getAttribute('aria-required') === 'true',
      }))
      .catch(() => null);
    if (!info) continue;
    const wanted =
      /agree|terms|privacy|consent|acknowledge|policy/i.test(info.near) ||
      /agree|terms|privacy|consent|acknowledge|createaccount/i.test(info.attrs) ||
      info.required;
    if (!wanted) continue;
    let ticked = await box.check({ timeout: 4000 }).then(() => true).catch(() => false);
    if (!ticked) {
      // Some employers keep the consent box disabled until the policy has been
      // opened ("click here to read... once reviewed, check the box"), so open
      // it, dismiss whatever tab it spawns, and try the box again.
      const handle = await box
        .evaluateHandle((el) => {
          let n = el;
          for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
            const a = [...n.querySelectorAll('a[href], button')].find((x) =>
              /here|privacy|statement|policy|terms|agreement/i.test(x.innerText || '')
            );
            if (a) return a;
          }
          return null;
        })
        .catch(() => null);
      const link = handle && handle.asElement();
      if (link) {
        const popup = page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
        await link.click({ timeout: 4000 }).catch(() => {});
        const opened = await popup;
        if (opened) await opened.close().catch(() => {});
        await page.waitForTimeout(1500);
        ticked = await box.check({ timeout: 4000 }).then(() => true).catch(() => false);
        if (ticked) filled.push('opened-policy');
      }
    }
    if (ticked) filled.push('consent');
  }
  return filled;
}

// Answers an emailed code box, or follows an emailed confirmation link.
async function satisfyVerification(page, identity, since, step, say) {
  const frame = await authFrame(page);
  // "code" is a trap: postal code, country phone code, promo code and area code
  // all match a naive selector, and on an application form they are everywhere.
  // Only accept boxes that are unambiguously a one-time verification code.
  const codeInputs = await frame
    .$$('input[autocomplete="one-time-code"], input[name*="code" i], input[id*="code" i], input[data-automation-id*="code" i], input[placeholder*="code" i]')
    .catch(() => []);
  const visibleCode = [];
  for (const el of codeInputs) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const ok = await el
      .evaluate((n) => {
        const hay = `${n.getAttribute('autocomplete') || ''} ${n.name || ''} ${n.id || ''} ${n.getAttribute('data-automation-id') || ''} ${n.placeholder || ''} ${n.getAttribute('aria-label') || ''} ${n.closest('label,div')?.innerText || ''}`;
        if (/postal|zip|country|area|promo|discount|referral|dial|region|state|coupon/i.test(hay)) return false;
        return /one-?time-?code|verification|verify|otp|security code|confirmation code|access code|passcode|enter code/i.test(hay);
      })
      .catch(() => false);
    if (ok) visibleCode.push(el);
  }

  const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 3000)).catch(() => '');
  // "Check your email" appears on plenty of pages that are not asking for a
  // code, and waiting 150s on each of them wastes the whole run.
  const wantsCode =
    visibleCode.length > 0 ||
    /enter the (verification |security )?code|we (sent|emailed) you a (verification |security )?code|verification code (was|has been) sent/i.test(bodyText);
  if (!wantsCode) return { needed: false };

  step('awaiting-email-verification');
  say('waiting up to 150s for the verification email');
  const found = await waitForVerification(identity, { since, timeoutMs: 150000 });
  if (!found) return { needed: true, ok: false, why: 'no verification email arrived' };

  if (found.code && visibleCode.length) {
    if (visibleCode.length > 1) {
      // Segmented one-digit-per-box inputs.
      const digits = found.code.split('');
      for (let i = 0; i < Math.min(digits.length, visibleCode.length); i++) {
        await visibleCode[i].fill(digits[i], { timeout: 3000 }).catch(() => {});
      }
    } else {
      await visibleCode[0].fill(found.code, { timeout: 5000 }).catch(() => {});
    }
    step(`code:${found.code}`);
    await clickByText(page, /^(verify|submit|continue|next|confirm)$/i);
    await page.waitForTimeout(4000);
    return { needed: true, ok: true, via: 'code' };
  }

  if (found.link) {
    await page.goto(found.link, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3000);
    step('followed-verification-link');
    return { needed: true, ok: true, via: 'link' };
  }
  return { needed: true, ok: false, why: 'email had neither code nor link' };
}

// Main entry point. Returns what happened so the capture record can explain
// itself, including honest failures like "captcha".
export async function passWall(page, seed, identity, opts = {}) {
  const trail = [];
  // Registration is the slowest part of a capture and the part most likely to
  // stall, so each step is reported live as well as recorded.
  const say = opts.onStage || (() => {});
  const step = (t) => {
    trail.push(t);
    say(t);
  };
  const startedAt = Date.now();

  if (await hasCaptcha(page)) return { ok: false, why: 'captcha', trail };

  // What is on screen decides what to do. A confirm-password box means this is
  // a registration form; a lone password box means it is a sign-in form.
  const screenOf = async () => {
    const frame = await authFrame(page);
    const info = await frame
      .evaluate(() => {
        const vis = (el) => el.getBoundingClientRect().width > 0;
        const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
        const confirm = pw.filter((el) =>
          /verify|confirm|again|retype/i.test(
            `${el.getAttribute('data-automation-id') || ''} ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.closest('div,label')?.innerText || ''}`
          )
        );
        return { passwords: pw.length, confirms: confirm.length, text: (document.body?.innerText || '').slice(0, 3000) };
      })
      .catch(() => ({ passwords: 0, confirms: 0, text: '' }));
    return {
      frame,
      ...info,
      kind: info.passwords === 0 ? 'none' : info.confirms > 0 || info.passwords > 1 ? 'register' : 'signin',
    };
  };

  const signIn = async (frame) => {
    await fillFirst(
      frame,
      ['input[data-automation-id="email"]', 'input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]'],
      identity.email
    );
    await fillFirst(frame, ['input[data-automation-id="password"]', 'input[type="password"]'], identity.portalPassword);
    let clicked = false;
    for (const sel of ['button[data-automation-id="signInSubmitButton"]', 'button[type="submit"]:not([disabled])']) {
      const el = await page.$(sel).catch(() => null);
      if (!el || !(await el.isVisible().catch(() => false))) continue;
      const ok = await el.click({ timeout: 6000 }).then(() => true).catch(() => false);
      if (!ok) await el.click({ timeout: 4000, force: true }).catch(() => {});
      clicked = true;
      break;
    }
    if (!clicked) await clickByText(page, SIGN_IN_BTN);
    await page.waitForTimeout(7000);
  };

  const register = async (frame) => {
    const filled = await fillRegistration(page, frame, identity);
    if (!filled.length) return { filled };
    step(`filled:${filled.join('+')}`);
    if (await hasCaptcha(page)) return { filled, captcha: true };
    let clicked = null;
    for (const sel of [
      'button[data-automation-id="createAccountSubmitButton"]',
      'button[data-automation-id*="submit" i]',
      'button[type="submit"]:not([disabled])',
      'input[type="submit"]',
    ]) {
      const el = await page.$(sel).catch(() => null);
      if (!el || !(await el.isVisible().catch(() => false))) continue;
      const ok = await el.click({ timeout: 6000 }).then(() => true).catch(() => false);
      if (!ok) await el.click({ timeout: 4000, force: true }).catch(() => {});
      clicked = sel;
      break;
    }
    if (!clicked) clicked = await clickByText(page, SUBMIT_REGISTRATION);
    step(`submit:${clicked || 'none-found'}`);
    await page.waitForTimeout(7000);
    return { filled, clicked };
  };

  // The persona is reused across runs, so a tenant we have seen before only
  // needs a sign-in. Attempts alternate until the credential screen is gone.
  const since = Date.now();
  let last = null;
  let triedRegister = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    let screen = await screenOf();

    if (screen.kind === 'none') {
      // Not on a credential screen yet -- step onto the registration path.
      const chose = await clickByText(page, CREATE_ACCOUNT);
      if (!chose) break;
      step(chose);
      await page.waitForTimeout(3000);
      screen = await screenOf();
      if (screen.kind === 'none') break;
    }

    if (screen.kind === 'signin' && !triedRegister) {
      // A sign-in screen usually carries a "Create Account" link, and the
      // persona has no account on this tenant yet -- registering is the only
      // path that leads anywhere. Signing in first just burns an attempt on
      // credentials that cannot exist.
      const toRegister = await clickByText(page, CREATE_ACCOUNT);
      if (toRegister) {
        step(`${toRegister}->register`);
        await page.waitForTimeout(3000);
        screen = await screenOf();
      }
    }

    if (screen.kind === 'signin') {
      step('sign-in');
      await signIn(screen.frame);
    } else if (screen.kind === 'none') {
      break;
    } else {
      triedRegister = true;
      last = await register(screen.frame);
      if (last.captcha) return { ok: false, why: 'captcha on registration', trail };
      if (!last.filled.length) return { ok: false, why: 'no registration fields found', trail };
      const after = await screenOf();
      if (/already (exists|in use|registered)|account with (this|that) email/i.test(after.text)) {
        step('account-exists');
      }
    }

    const now = await screenOf();
    if (now.kind === 'none') break; // credentials accepted
    if (attempt === 2) {
      const errors = await page
        .evaluate(() =>
          [...document.querySelectorAll('[role="alert"], [class*="error" i], [aria-live]')]
            .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 3)
        )
        .catch(() => []);
      return {
        ok: false,
        why: `stuck on ${now.kind} screen: ${errors.join(' | ').slice(0, 140) || 'no error shown'}`,
        trail,
      };
    }
  }

  const verified = await satisfyVerification(page, identity, since, step, say);
  if (verified.needed && !verified.ok) return { ok: false, why: verified.why, trail, verification: verified };

  // Persist the session so a later run on the same tenant can skip all of this.
  if (opts.profileDir) {
    await fs.mkdir(opts.profileDir, { recursive: true }).catch(() => {});
    const name = `${seed.ats || 'unknown'}__${seed.board || seed.company || 'unknown'}.json`.replace(/[^\w.@-]+/g, '-');
    await page
      .context()
      .storageState({ path: path.join(opts.profileDir, name) })
      .catch(() => {});
    step(`saved-session:${name}`);
  }

  return { ok: true, trail, ms: Date.now() - startedAt, verification: verified };
}
