// Screenshots the *whole* application form, not just the first viewport of it.
//
// `fullPage: true` only grows to the document's scroll height, so a form that
// lives inside its own scrolling panel (Meta, some Workday and Oracle screens)
// is silently cut off after one screenful. Anything below the fold never makes
// it into the image that gets reviewed later.
//
// So before the shot we force every scroll container that holds part of the
// form to its natural height, push overlays out of the way, and afterwards
// verify that every field actually landed inside the captured area.

const CTRL =
  'input:not([type=hidden]),select,textarea,[contenteditable="true"],[role="combobox"],[role="listbox"],[role="radiogroup"]';

const CONSENT =
  /cookie|consent|gdpr|privacy|onetrust|osano|truste|cookiebot|usercentrics|didomi|banner/i;

// Renders lazily-mounted rows and expands inner scrollers. Original inline
// styles are stashed on each touched element so the page can be put back.
function expandInPage([ctrlSel, consentSrc]) {
  const CONSENT_RE = new RegExp(consentSrc, 'i');
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const controls = [...document.querySelectorAll(ctrlSel)].filter(vis);
  const mark = (el) => {
    if (!el.hasAttribute('data-shot-prev')) el.setAttribute('data-shot-prev', el.getAttribute('style') || '');
  };

  // Elements that scroll internally and contain part of the form.
  const scrollers = new Set();
  for (const c of controls) {
    for (let n = c.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      if (scrollers.has(n)) continue;
      const s = getComputedStyle(n);
      if (/(auto|scroll|hidden)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 24) scrollers.add(n);
    }
  }

  // Scroll each one end to end first: virtualized lists only mount rows that
  // have been on screen, and an unmounted row cannot be photographed.
  for (const el of scrollers) {
    for (let y = 0; y <= el.scrollHeight; y += Math.max(200, el.clientHeight - 60)) el.scrollTop = y;
    el.scrollTop = 0;
  }
  const winSteps = Math.ceil(document.documentElement.scrollHeight / Math.max(200, innerHeight - 60));
  for (let i = 0; i <= winSteps; i++) scrollTo(0, i * Math.max(200, innerHeight - 60));
  scrollTo(0, 0);

  // Expanding the scroller alone is not enough: its ancestors are usually the
  // things pinned to the viewport (a 100vh flex column, a fixed dialog), and
  // while they stay fixed the document never grows and the shot stays cropped.
  // So every ancestor that constrains height gets relaxed too.
  const chain = new Set(scrollers);
  for (const c of controls) {
    for (let n = c.parentElement; n && n !== document.documentElement; n = n.parentElement) chain.add(n);
  }

  let expanded = 0;
  for (const el of chain) {
    const s = getComputedStyle(el);
    const constrains =
      scrollers.has(el) ||
      /(auto|scroll|hidden)/.test(s.overflowY) ||
      s.position === 'fixed' ||
      (s.position === 'absolute' && s.bottom !== 'auto') ||
      (s.maxHeight !== 'none' && parseFloat(s.maxHeight) < el.scrollHeight) ||
      (s.height !== 'auto' && parseFloat(s.height) + 2 < el.scrollHeight);
    if (!constrains) continue;
    mark(el);
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('min-height', '0', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
    if (s.position === 'fixed' || (s.position === 'absolute' && s.bottom !== 'auto')) {
      el.style.setProperty('position', 'static', 'important');
    }
    expanded++;
  }
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    mark(el);
    el.style.setProperty('overflow', 'visible', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
  }

  // Overlays: consent banners get hidden outright because they sit on top of
  // fields; other pinned chrome is dropped into normal flow so it stops
  // covering content but still shows up in the image.
  let hiddenOverlays = 0;
  let unpinned = 0;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) continue;
    const holdsForm = el.querySelector(ctrlSel);
    const looksConsent = CONSENT_RE.test(`${el.className || ''} ${el.id || ''}`) || CONSENT_RE.test((el.innerText || '').slice(0, 300));
    if (looksConsent && !holdsForm) {
      mark(el);
      el.style.setProperty('display', 'none', 'important');
      hiddenOverlays++;
    } else if (!holdsForm) {
      mark(el);
      el.style.setProperty('position', 'static', 'important');
      unpinned++;
    }
  }
  return { expanded, hiddenOverlays, unpinned, controls: controls.length };
}

// Where the form actually sits once the page has been expanded.
function measureInPage(ctrlSel) {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const rects = [...document.querySelectorAll(ctrlSel)].filter(vis).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + scrollY, bottom: r.bottom + scrollY, right: r.right + scrollX };
  });
  const docHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0
  );
  return {
    docHeight,
    docWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    fieldCount: rects.length,
    lowestField: rects.length ? Math.max(...rects.map((r) => r.bottom)) : 0,
    widestField: rects.length ? Math.max(...rects.map((r) => r.right)) : 0,
  };
}

function restoreInPage() {
  for (const el of document.querySelectorAll('[data-shot-prev]')) {
    const prev = el.getAttribute('data-shot-prev');
    if (prev) el.setAttribute('style', prev);
    else el.removeAttribute('style');
    el.removeAttribute('data-shot-prev');
  }
}

// Chrome refuses to rasterize past this, so a form taller than it would come
// back clipped without warning.
const MAX_PX = 30000;

export async function captureFullForm(page, frame, filePath, opts = {}) {
  const target = frame || page.mainFrame();
  let prep = { expanded: 0, hiddenOverlays: 0, unpinned: 0 };
  try {
    prep = await target.evaluate(expandInPage, [CTRL, CONSENT.source]).catch(() => prep);

    // A form inside an iframe needs the frame element itself grown too, or the
    // parent document still only reserves the old height for it.
    if (target !== page.mainFrame()) {
      const inner = await target.evaluate(measureInPage, CTRL).catch(() => null);
      const el = await target.frameElement().catch(() => null);
      if (el && inner) {
        await el
          .evaluate((node, h) => {
            node.setAttribute('data-shot-prev', node.getAttribute('style') || '');
            node.style.setProperty('height', `${Math.min(h + 40, 30000)}px`, 'important');
            node.style.setProperty('max-height', 'none', 'important');
          }, inner.docHeight)
          .catch(() => {});
        await page.mainFrame().evaluate(expandInPage, [CTRL, CONSENT.source]).catch(() => {});
      }
    }
    await page.waitForTimeout(500);

    const measure = (await target.evaluate(measureInPage, CTRL).catch(() => null)) || {};
    const pageBox =
      (await page.mainFrame().evaluate(measureInPage, CTRL).catch(() => null)) || {};
    const needed = Math.max(measure.docHeight || 0, pageBox.docHeight || 0);
    const clipped = needed > MAX_PX;

    let ok = await page
      .screenshot({ path: filePath, fullPage: true, timeout: opts.timeout || 40000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      // A slow full-page rasterize is worth one more try: falling back to a
      // viewport shot would quietly hand back a cropped form.
      ok = await page
        .screenshot({ path: filePath, fullPage: true, timeout: 25000 })
        .then(() => true)
        .catch(() => false);
    }
    let viewportOnly = false;
    if (!ok) {
      ok = await page.screenshot({ path: filePath, timeout: 12000 }).then(() => true).catch(() => false);
      viewportOnly = ok;
    }

    return {
      ok,
      viewportOnly,
      clipped,
      expandedContainers: prep.expanded || 0,
      hiddenOverlays: prep.hiddenOverlays || 0,
      unpinnedElements: prep.unpinned || 0,
      docHeight: needed,
      lowestField: Math.max(measure.lowestField || 0, pageBox.lowestField || 0),
      // The honest answer to "did we get the whole form": the image is only
      // complete if it reaches past the last field on the page.
      coversAllFields:
        !viewportOnly && !clipped && needed + 2 >= Math.max(measure.lowestField || 0, pageBox.lowestField || 0),
    };
  } finally {
    await target.evaluate(restoreInPage).catch(() => {});
    if (target !== page.mainFrame()) await page.mainFrame().evaluate(restoreInPage).catch(() => {});
  }
}
