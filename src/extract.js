// Runs inside the page. Returns a structural description of whatever form the
// frame currently shows: fields, labels, widgets, sections, walls.
export function extractFromFrame() {
  const txt = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 200);

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const humanize = (s) =>
    txt(String(s || '').replace(/[_\-.\[\]]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));

  function labelFor(el) {
    const byAria = el.getAttribute('aria-label');
    if (byAria) return { label: txt(byAria), labelSource: 'aria-label' };
    const ref = el.getAttribute('aria-labelledby');
    if (ref) {
      const t = ref.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ');
      if (txt(t)) return { label: txt(t), labelSource: 'aria-labelledby' };
    }
    if (el.labels && el.labels.length) {
      const t = txt(el.labels[0].innerText || el.labels[0].textContent);
      if (t) return { label: t, labelSource: 'label[for]' };
    }
    const wrap = el.closest('label');
    if (wrap) {
      const t = txt(wrap.innerText || wrap.textContent);
      if (t) return { label: t, labelSource: 'wrapping-label' };
    }
    // Walk up looking for a heading-ish sibling above the control.
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const cand = node.querySelector('label, legend, .label, [class*="label"], [class*="Label"], [class*="question"]');
      if (cand && !cand.contains(el)) {
        const t = txt(cand.innerText || cand.textContent);
        if (t) return { label: t, labelSource: 'nearby' };
      }
    }
    if (el.placeholder) return { label: txt(el.placeholder), labelSource: 'placeholder' };
    if (el.name) return { label: humanize(el.name), labelSource: 'name-attr' };
    if (el.id) return { label: humanize(el.id), labelSource: 'id-attr' };
    return { label: '', labelSource: 'none' };
  }

  function selectorFor(el) {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  const isRequired = (el) => {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const l = el.labels?.[0] || el.closest('label') || el.parentElement;
    return !!(l && /\*|\brequired\b/i.test(l.textContent || ''));
  };

  // --- How a value gets entered -------------------------------------------
  // The canonical key says *what* belongs in a box; this says *how* to put it
  // there. A universal filler needs both: "email" plus "type into a text input",
  // or "location" plus "click open, type, wait for remote options, click one".
  const CLS = (el) => `${el.className || ''} ${el.getAttribute('data-testid') || ''}`;

  const closestMatch = (el, re, depth = 4) => {
    let n = el;
    for (let i = 0; i <= depth && n; i++, n = n.parentElement) {
      if (typeof n.className === 'string' && re.test(CLS(n))) return n;
    }
    return null;
  };

  const DATE_HINT = /date|day|month|year|dob|birth|available|start|deadline/i;
  const DATE_FORMAT = /\b(mm|dd|yyyy|m{2}\/d{2}|\d{2}\/\d{2}\/\d{4})\b/i;

  function classifyControl(el, tag, type, label) {
    const cls = CLS(el);
    const role = (el.getAttribute('role') || '').toLowerCase();
    const ariaPopup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
    const ariaAuto = (el.getAttribute('aria-autocomplete') || '').toLowerCase();
    const readonly = el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true';

    const rec = (control, fill, extra = {}) => ({ control, fill, ...extra });

    if (type === 'button-dropdown') {
      const multi = /multi|items selected/i.test(`${cls} ${el.innerText || ''}`);
      return rec(multi ? 'combobox-multi' : 'combobox', {
        action: 'click-pick',
        openBy: 'click',
        optionsFrom: 'unknown',
        typeToFilter: false,
        waitForOptions: true,
      }, { widgetHint: 'button-opens-listbox' });
    }

    if (tag === 'select') {
      return rec(el.multiple ? 'native-multiselect' : 'native-select', {
        action: el.multiple ? 'select-options' : 'select-option',
        openBy: null,
        optionsFrom: 'dom-static',
        typeToFilter: false,
        waitForOptions: false,
      });
    }

    if (tag === 'textarea') {
      return rec('textarea', { action: 'type', openBy: null, optionsFrom: null, typeToFilter: false, waitForOptions: false });
    }

    if (el.getAttribute('contenteditable') === 'true') {
      return rec('rich-text', { action: 'type', openBy: 'click', optionsFrom: null, typeToFilter: false, waitForOptions: false });
    }

    if (type === 'file') {
      const zone = closestMatch(el, /dropzone|drag-?and-?drop|drag-?drop|file-?drop|uppy|filepond/i, 5);
      return rec(zone ? 'file-dropzone' : 'file-upload', {
        action: 'upload',
        openBy: zone ? 'set-input-files-on-hidden-input' : 'set-input-files',
        optionsFrom: null,
        typeToFilter: false,
        waitForOptions: true, // uploads usually parse/preview before the form settles
      });
    }

    if (['date', 'month', 'week', 'datetime-local', 'time'].includes(type)) {
      return rec('date-native', { action: 'pick-date', openBy: null, optionsFrom: null, typeToFilter: false, waitForOptions: false }, { dateFormat: type });
    }

    if (type === 'range') {
      return rec('range', { action: 'set-range', openBy: null, optionsFrom: null, typeToFilter: false, waitForOptions: false },
        { min: el.getAttribute('min') || '', max: el.getAttribute('max') || '', step: el.getAttribute('step') || '' });
    }

    if (role === 'switch' || type === 'checkbox' && /toggle|switch/i.test(cls)) {
      return rec('toggle', { action: 'toggle', openBy: null, optionsFrom: null, typeToFilter: false, waitForOptions: false });
    }

    // Custom dropdowns: react-select, downshift, headless-ui, MUI, Ant, and the
    // hand-rolled ones. These never respond to selectOption().
    const comboWrap = closestMatch(el, /select__|Select__|react-select|combobox|Combobox|autocomplete|Autocomplete|typeahead|MuiAutocomplete|ant-select|chakra-select|dropdown|Dropdown|listbox|Listbox|downshift/i, 4);
    const isCombo =
      role === 'combobox' ||
      ariaPopup === 'listbox' ||
      ariaPopup === 'menu' ||
      !!ariaAuto ||
      el.hasAttribute('aria-expanded') ||
      !!comboWrap;

    if (isCombo && (type === 'tel' || /phone|mobile|telephone/i.test(label || '') || /phone|iti__|intl-tel/i.test(cls))) {
      // Country-flag phone widgets: a plain number field plus a country picker.
      return rec('phone-intl', {
        action: 'type-then-pick-country',
        openBy: 'click-country-button',
        optionsFrom: 'dom-on-open',
        typeToFilter: true,
        waitForOptions: true,
      });
    }

    if (isCombo) {
      const searchable = !readonly && (ariaAuto === 'list' || ariaAuto === 'both' || ariaAuto === 'inline' || tag === 'input');
      const multi = /multi|tags?\b/i.test(cls + ' ' + (comboWrap ? CLS(comboWrap) : ''));
      // Whether options are already in the DOM or fetched after typing cannot be
      // known statically -- the capture probe opens the widget and resolves it.
      return rec(multi ? 'combobox-multi' : 'combobox', {
        action: searchable ? 'click-type-pick' : 'click-pick',
        openBy: 'click',
        optionsFrom: 'unknown',
        typeToFilter: searchable,
        waitForOptions: true,
      }, { widgetHint: comboWrap ? (typeof comboWrap.className === 'string' ? comboWrap.className.slice(0, 60) : '') : '' });
    }

    // Calendar widgets built on a plain text input.
    if (
      tag === 'input' &&
      (closestMatch(el, /datepicker|DatePicker|date-picker|calendar|Calendar|react-day|flatpickr|pikaday/i, 4) ||
        DATE_FORMAT.test(el.getAttribute('placeholder') || '') ||
        (DATE_HINT.test(label || '') && DATE_FORMAT.test(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '')))
    ) {
      return rec('date-picker', {
        action: 'pick-date',
        openBy: 'click',
        optionsFrom: 'dom-on-open',
        typeToFilter: !readonly,
        waitForOptions: true,
      }, { dateFormat: el.getAttribute('placeholder') || '' });
    }

    if (type === 'radio') {
      return rec('radio', { action: 'choose-one', openBy: null, optionsFrom: 'dom-static', typeToFilter: false, waitForOptions: false });
    }
    if (type === 'checkbox') {
      return rec('checkbox', { action: 'check', openBy: null, optionsFrom: null, typeToFilter: false, waitForOptions: false });
    }

    // Segmented one-character verification-code boxes.
    if (tag === 'input' && (el.getAttribute('maxlength') === '1' || /\botp\b|one-?time|verification-?code|digit/i.test(cls + ' ' + (el.name || '')))) {
      return rec('otp-segment', { action: 'type', openBy: null, optionsFrom: null, typeToFilter: false, waitForOptions: false });
    }

    const TYPED = { email: 'email', tel: 'tel', number: 'number', url: 'url', password: 'password', search: 'search' };
    return rec(TYPED[type] ? `text-${TYPED[type]}` : 'text', {
      action: 'type',
      openBy: null,
      optionsFrom: null,
      typeToFilter: false,
      waitForOptions: false,
    });
  }

  // A radio/checkbox group's meaning lives in the question above it, not in the
  // first option's own label ("Yes"), so look for the prompt that governs them.
  function groupLabel(members) {
    const fs = members[0].closest('fieldset');
    const legend = fs && fs.querySelector('legend');
    if (legend && txt(legend.innerText)) return { label: txt(legend.innerText), labelSource: 'legend' };

    let anc = members[0].parentElement;
    const holdsAll = (n) => members.every((m) => n.contains(m));
    for (let i = 0; i < 6 && anc && !holdsAll(anc); i++) anc = anc.parentElement;
    if (!anc) return null;

    const wrapper = anc.closest('[class*="question"], [class*="Question"], [class*="field"], [class*="Field"]') || anc;
    for (const cand of wrapper.querySelectorAll(
      'legend, label, [class*="label"], [class*="Label"], [class*="question"], [class*="Question"], h1, h2, h3, h4, p'
    )) {
      if (members.some((m) => cand.contains(m))) continue;
      const t = txt(cand.innerText || cand.textContent);
      if (t.length > 2) return { label: t, labelSource: 'group-prompt' };
    }
    let prev = wrapper.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++, prev = prev.previousElementSibling) {
      const t = txt(prev.innerText || prev.textContent);
      if (t.length > 2) return { label: t, labelSource: 'group-prev-sibling' };
    }
    return null;
  }

  const CONTROL_SEL =
    'input,select,textarea,[contenteditable="true"],[role="combobox"],[role="listbox"],[role="radiogroup"],[role="checkbox"],[role="switch"],' +
    // Workday and Oracle HCM render their dropdowns as a button that opens a
    // listbox, with no input element anywhere near the value.
    'button[aria-haspopup="listbox"],button[aria-haspopup="menu"],button[aria-haspopup="dialog"][aria-expanded],[role="button"][aria-haspopup="listbox"]';

  const seenGroups = new Set();
  const fields = [];
  for (const el of document.querySelectorAll(CONTROL_SEL)) {
    const tag = el.tagName.toLowerCase();
    const popup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
    const type =
      tag === 'button' || (popup && tag !== 'input' && tag !== 'select')
        ? 'button-dropdown'
        : (el.getAttribute('type') || (tag === 'input' ? 'text' : tag)).toLowerCase();
    if (type === 'hidden') continue;
    if (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(type)) continue;
    if (type === 'button-dropdown' && !visible(el)) continue;
    const shown = visible(el);
    if (!shown && type !== 'file') continue; // file inputs are usually visually hidden

    // Collapse radio/checkbox groups that share a name.
    if ((type === 'radio' || type === 'checkbox') && el.name) {
      const key = `${type}:${el.name}`;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      const members = [...document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)];
      const own = labelFor(members[0]);
      const { label, labelSource } = groupLabel(members) || own;
      const fieldset = el.closest('fieldset');
      const opts = members.map((m) => ({
        label: txt(m.labels?.[0]?.innerText || m.value),
        value: m.value,
      })).filter((o) => o.label || o.value).slice(0, 25);
      fields.push({
        kind: 'group',
        type,
        control: type === 'radio' ? 'radio-group' : 'checkbox-group',
        fill: {
          action: type === 'radio' ? 'choose-one' : 'check-many',
          openBy: null,
          optionsFrom: 'dom-static',
          typeToFilter: false,
          waitForOptions: false,
        },
        name: el.name,
        label: txt(fieldset?.querySelector('legend')?.innerText) || label,
        labelSource,
        firstOptionLabel: own.label,
        required: members.some(isRequired),
        options: opts.map((o) => o.label).filter(Boolean),
        optionValues: opts,
        optionCount: members.length,
        selector: `input[name="${el.name}"]`,
      });
      continue;
    }

    const { label, labelSource } = labelFor(el);
    const shape = classifyControl(el, tag, type, label);
    const f = {
      kind: 'field',
      tag,
      type,
      control: shape.control,
      fill: shape.fill,
      name: el.getAttribute('name') || '',
      id: el.id || '',
      label,
      labelSource,
      required: isRequired(el),
      placeholder: el.getAttribute('placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      maxlength: el.getAttribute('maxlength') || '',
      selector: selectorFor(el),
      visible: shown,
    };
    for (const k of ['dateFormat', 'widgetHint', 'min', 'max', 'step']) {
      if (shape[k]) f[k] = shape[k];
    }
    if (tag === 'select') {
      f.options = [...el.options].map((o) => txt(o.textContent)).filter(Boolean).slice(0, 40);
      f.optionValues = [...el.options].map((o) => ({ label: txt(o.textContent), value: o.value })).slice(0, 40);
      f.optionCount = el.options.length;
    }
    if (type === 'file') {
      f.accept = el.getAttribute('accept') || '';
      f.multiple = el.multiple;
    }
    fields.push(f);
  }

  // Custom widgets that are not native controls.
  const widgets = [];
  const widgetProbe = [
    ['react-select', '[class*="select__control"], [class*="Select__control"], [class*="react-select"]'],
    ['combobox', '[role="combobox"]'],
    ['dropzone', '[class*="dropzone"], [class*="DropZone"], [class*="drag-and-drop"], [data-testid*="dropzone"]'],
    ['rich-text', '[contenteditable="true"], .ql-editor, [class*="rich-text"]'],
    ['date-picker', '[class*="datepicker"], [class*="DatePicker"], input[type="date"]'],
    ['typeahead', '[class*="autocomplete"], [class*="typeahead"], [aria-autocomplete]'],
    ['stepper', '[class*="stepper"], [class*="Stepper"], [class*="progress-bar"], [aria-label*="step" i]'],
    ['accordion', '[class*="accordion"], [class*="Accordion"], details'],
  ];
  for (const [name, sel] of widgetProbe) {
    let n = 0;
    try { n = [...document.querySelectorAll(sel)].filter(visible).length; } catch {}
    if (n) widgets.push({ widget: name, count: n });
  }

  const bodyText = txt(document.body?.innerText || '').slice(0, 0) || (document.body?.innerText || '');
  const has = (re) => re.test(bodyText);

  const resumeUpload = [...document.querySelectorAll('input[type="file"], button, a, div')]
    .filter((el) => /resume|cv\b|curriculum vitae/i.test(el.getAttribute('aria-label') || el.textContent || el.getAttribute('accept') || ''))
    .slice(0, 5)
    .map((el) => txt(el.textContent || el.getAttribute('aria-label')));

  const sections = [...document.querySelectorAll('h1,h2,h3,h4,legend,[role="heading"]')]
    .filter(visible)
    .map((el) => txt(el.innerText))
    .filter(Boolean)
    .slice(0, 30);

  const buttons = [...document.querySelectorAll('button,input[type="submit"],[role="button"],a[class*="btn"]')]
    .filter(visible)
    .map((el) => txt(el.innerText || el.value))
    .filter(Boolean)
    .slice(0, 25);

  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src).slice(0, 60);
  const frames = [...document.querySelectorAll('iframe[src]')].map((f) => f.src).slice(0, 20);

  return {
    url: location.href,
    title: document.title,
    fieldCount: fields.length,
    fields,
    widgets,
    sections,
    buttons,
    resumeUpload,
    signals: {
      hasPasswordField: !!document.querySelector('input[type="password"]'),
      authWall: has(/\b(sign in|log ?in|create an account|create account|register)\b/i) &&
        !!document.querySelector('input[type="password"], input[name*="password" i]'),
      captcha: /recaptcha|hcaptcha|turnstile|cf-challenge/i.test(
        document.documentElement.outerHTML.slice(0, 400000)
      ),
      eeoSection: has(/equal (employment )?opportunity|voluntary self-identification|gender|ethnicity|veteran|disability/i),
      demographicQuestions: has(/self-identif|race\/ethnicity|veteran status|disability status/i),
      coverLetter: has(/cover letter/i),
      linkedin: has(/linkedin/i),
      multiStep: /step \d+ of \d+|of \d+ steps/i.test(bodyText),
      oauthApply: has(/apply with (linkedin|indeed|google)|sign in with/i),
      accountRequired: has(/create an account to apply|you must (sign in|be signed in)/i),
    },
    scripts,
    frames,
    textLength: bodyText.length,
  };
}
