// Resolves the thing static inspection cannot tell us about a dropdown or a
// calendar: how its options actually arrive, and therefore how an automation
// has to drive it. The distinctions matter -- "click and pick from a list that
// is already there" and "type, wait for a server round trip, then pick" look
// identical in the DOM but need completely different code to fill.
//
// Every candidate is opened, read, typed into, and read again, so a widget that
// shows a list on open *and* re-queries on keystroke is recorded as both.

const OPTION_SEL = [
  '[role="option"]',
  '[role="listbox"] li',
  '[class*="select__option"]',
  '[class*="-option"]',
  '[class*="menu"] li',
  '[class*="dropdown"] li',
  'li[id*="option"]',
  '[class*="suggestion"]',
  '[class*="autocomplete"] li',
  'ul[class*="results"] li',
].join(',');

const CALENDAR_SEL =
  '[role="dialog"] [role="grid"], [role="grid"][aria-label*="calend" i], .react-datepicker, [class*="calendar"], [class*="Calendar"], [class*="datepicker"], [class*="DayPicker"]';

// Telemetry and asset traffic, which must not be mistaken for an options lookup.
const NOISE =
  /google-analytics|googletagmanager|segment\.(io|com)|sentry|datadog|newrelic|hotjar|fullstory|doubleclick|facebook|clarity\.ms|intercom|beacon|collect\?|\.(png|jpe?g|gif|svg|woff2?|css|ico)(\?|$)/i;
const LOOKUP =
  /search|query|typeahead|autocomplete|suggest|option|lookup|complete|location|cities|geo|school|univers|graphql|\/api\//i;

// What is on screen right now: which options are visible, and whether a
// calendar grid has appeared.
async function readOpen(frame) {
  return frame
    .evaluate(
      ([optSel, calSel]) => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return false;
          const s = getComputedStyle(el);
          return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
        };
        const seen = new Set();
        const opts = [];
        let roleHint = '';
        for (const el of document.querySelectorAll(optSel)) {
          if (!vis(el)) continue;
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          if (!t || seen.has(t)) continue;
          seen.add(t);
          if (!roleHint) {
            roleHint = el.getAttribute('role')
              ? `[role="${el.getAttribute('role')}"]`
              : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : '');
          }
          opts.push(t);
        }
        return {
          optionCount: opts.length,
          all: opts.slice(0, 400),
          optionSelector: roleHint,
          calendarOpen: [...document.querySelectorAll(calSel)].some(vis),
        };
      },
      [OPTION_SEL, CALENDAR_SEL]
    )
    .catch(() => ({ optionCount: 0, all: [], optionSelector: '', calendarOpen: false }));
}

// A probe string that is a plausible prefix for the common typeahead subjects
// (cities, schools, countries) so a real search returns something.
function probeText(field) {
  const l = `${field.label || ''} ${field.name || ''}`.toLowerCase();
  if (/location|city|address|where/.test(l)) return 'San';
  if (/school|university|college|education/.test(l)) return 'Stan';
  if (/country|nation/.test(l)) return 'Uni';
  if (/degree|major|discipline/.test(l)) return 'Bach';
  if (/company|employer|organi/.test(l)) return 'Goo';
  return 'a';
}

export async function probeWidgets(page, frame, form, opts = {}) {
  const budgetMs = opts.budgetMs ?? 120000;
  const maxWidgets = opts.maxWidgets ?? 40;
  const deadline = Date.now() + budgetMs;

  const candidates = (form.fields || []).filter(
    (f) => /^combobox/.test(f.control || '') || f.control === 'date-picker' || f.control === 'phone-intl'
  );
  if (!candidates.length) return { probed: 0, skipped: 0 };

  const requests = [];
  const onRequest = (req) => {
    const u = req.url();
    if (!NOISE.test(u)) requests.push(u);
  };
  page.on('request', onRequest);

  let probed = 0;
  let skipped = 0;
  try {
    for (const f of candidates.slice(0, maxWidgets)) {
      if (Date.now() > deadline) {
        f.fill.optionsFrom = 'unprobed-budget';
        skipped++;
        continue;
      }
      const handle = await frame.$(f.selector).catch(() => null);
      if (!handle) {
        f.fill.optionsFrom = 'unresolved-selector';
        skipped++;
        continue;
      }
      probed++;

      // A menu left open by the previous probe would be toggled *shut* by this
      // field's click, so start from a clean, unfocused page.
      await frame.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);

      const baseline = await readOpen(frame);
      await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await handle.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800);
      let opened = await readOpen(frame);
      if (opened.optionCount - baseline.optionCount <= 0) {
        // Some widgets need the click to land on the control after focus, so
        // give it one more attempt before concluding nothing opens.
        await handle.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(900);
        const second = await readOpen(frame);
        if (second.optionCount > opened.optionCount) opened = second;
      }

      // Forms like Ashby's keep every dropdown's options in the DOM, so only the
      // options that are new relative to the baseline belong to this widget.
      const base = new Set(baseline.all);
      const newOnOpen = opened.all.filter((o) => !base.has(o));
      const onOpen = newOnOpen.length;
      const calendar = opened.calendarOpen && !baseline.calendarOpen;

      // Type regardless of what opening produced: a list that is already
      // present may still re-query the server on each keystroke, and that is
      // the difference between "click the option" and "type, wait, click".
      const mark = requests.length;
      const text = probeText(f);
      let typed = { optionCount: 0, all: [], optionSelector: '' };
      let lookups = [];
      if (!calendar) {
        await page.keyboard.type(text, { delay: 70 }).catch(() => {});
        await page.waitForTimeout(1800);
        typed = await readOpen(frame);
        typed.newOnes = typed.all.filter((o) => !base.has(o));
        typed.optionCount = typed.newOnes.length;
        lookups = requests.slice(mark).filter((u) => LOOKUP.test(u));
      }

      // Everything observed, recorded plainly so the recipe can be re-derived.
      f.probe = {
        optionsOnOpen: onOpen,
        optionsAfterTyping: typed.optionCount,
        typedProbe: calendar ? null : text,
        networkOnType: lookups.length > 0,
        calendarOpened: calendar,
        sampleOnOpen: newOnOpen.slice(0, 8),
        sampleAfterTyping: (typed.newOnes || []).slice(0, 8),
      };
      if (lookups.length) f.fill.optionsRequest = lookups[0].slice(0, 200);
      if (opened.optionSelector || typed.optionSelector) {
        f.fill.optionSelector = opened.optionSelector || typed.optionSelector;
      }

      if (calendar || f.control === 'date-picker') {
        f.control = 'date-picker';
        f.fill.action = 'click-open-calendar-pick-day';
        f.fill.optionsFrom = 'calendar-widget';
        f.fill.typeToFilter = false;
        f.fill.waitForOptions = true;
      } else if (lookups.length && typed.optionCount > 0) {
        // The nuance that matters most: options are fetched per keystroke, so
        // the filler must type, wait for the response, then choose.
        f.fill.action = 'click-type-wait-pick';
        f.fill.optionsFrom = 'network-on-type';
        f.fill.typeToFilter = true;
        f.fill.waitForOptions = true;
        f.optionCount = typed.optionCount;
        f.options = (typed.newOnes || []).slice(0, 40);
      } else if (onOpen > 0 && typed.optionCount > 0) {
        // List is present immediately; typing only narrows it client-side.
        f.fill.action = 'click-type-pick';
        f.fill.optionsFrom = 'dom-on-open';
        f.fill.typeToFilter = true;
        f.fill.waitForOptions = false;
        f.optionCount = onOpen;
        f.options = newOnOpen.slice(0, 40);
      } else if (onOpen > 0) {
        f.fill.action = 'click-pick';
        f.fill.optionsFrom = 'dom-on-open';
        f.fill.typeToFilter = false;
        f.fill.waitForOptions = false;
        f.optionCount = onOpen;
        f.options = newOnOpen.slice(0, 40);
      } else if (typed.optionCount > 0) {
        f.fill.action = 'click-type-wait-pick';
        f.fill.optionsFrom = 'dom-on-type';
        f.fill.typeToFilter = true;
        f.fill.waitForOptions = true;
        f.optionCount = typed.optionCount;
        f.options = (typed.newOnes || []).slice(0, 40);
      } else if (f.control === 'phone-intl') {
        // The number types normally; the country flag is a separate picker that
        // this probe does not drive, so leave the compound recipe intact.
        f.fill.optionsFrom = 'country-picker-unprobed';
      } else {
        // Opened and typed and nothing appeared: it behaves as a plain text box.
        f.fill.optionsFrom = 'none-observed';
        f.fill.action = 'type';
        f.fill.typeToFilter = false;
        f.fill.waitForOptions = false;
      }

      // Leave the field as found so the next probe starts clean.
      await page.keyboard.press('Escape').catch(() => {});
      for (let i = 0; i < text.length; i++) await page.keyboard.press('Backspace').catch(() => {});
      await page.waitForTimeout(250);
    }
  } finally {
    page.off('request', onRequest);
  }
  return { probed, skipped, candidates: candidates.length };
}
