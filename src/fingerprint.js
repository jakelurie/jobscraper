// Turns a captured form into comparable signatures plus a semantic mapping of
// each field to a canonical key -- the thing a universal autofiller needs.
import crypto from 'node:crypto';

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

export const normLabel = (s = '') =>
  s
    .toLowerCase()
    .replace(/\(optional\)|\(required\)|\*/g, ' ')
    .replace(/[^a-z0-9+#/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

// Ordered: first match wins.
const CANONICAL = [
  ['full_name', /^(full name|name|your name|legal name|candidate name)$/],
  ['first_name', /(first|given|fore)\s*name|^fname$/],
  ['last_name', /(last|family|sur)\s*name|^lname$/],
  ['preferred_name', /preferred name|nickname|goes by/],
  ['email', /e-?mail/],
  ['phone', /phone|mobile|telephone|cell/],
  ['resume', /resume|cv\b|curriculum vitae/],
  ['cover_letter', /cover letter|motivation letter/],
  ['linkedin', /linkedin/],
  ['github', /github|gitlab/],
  ['portfolio', /portfolio|personal (web)?site|website|blog|url/],
  ['location', /location|city|state|province|address|postal|zip|country|where are you based/],
  ['work_authorization', /authoriz|legally (able|entitled) to work|right to work|work permit|eligible to work/],
  ['visa_sponsorship', /sponsor|visa|h-?1b/],
  ['relocation', /relocat/],
  ['remote_preference', /remote|hybrid|on-?site preference/],
  ['salary', /salary|compensation expectation|desired pay|rate/],
  ['start_date', /start date|available|notice period|earliest/],
  ['years_experience', /years? of (relevant )?experience|how many years/],
  ['education', /education|degree|university|school|gpa|major/],
  ['employer', /current (employer|company)|employer|company name/],
  ['job_title_current', /current (job )?title|current role/],
  ['referral', /how did you hear|referr|source|who referred/],
  ['pronouns', /pronoun/],
  ['gender', /gender|sex\b/],
  ['race_ethnicity', /race|ethnic|hispanic|latino/],
  ['veteran_status', /veteran|military/],
  ['disability_status', /disab/],
  ['age_range', /age range|date of birth|dob|over 18/],
  ['security_clearance', /clearance|itar|export control/],
  ['criminal_history', /convict|criminal|background check/],
  ['non_compete', /non-?compete|restrictive covenant/],
  ['previous_employee', /previously (worked|employed)|former employee|rehire/],
  ['consent', /consent|agree to|privacy policy|terms|acknowledge|certif/],
  ['password', /password/],
  ['custom_question', /.+/],
];

export function canonicalKey(field) {
  const l = normLabel(field.label || field.name || '');
  if (field.type === 'file') return 'resume';
  if (field.type === 'password') return 'password';
  if (field.autocomplete) {
    const ac = field.autocomplete.toLowerCase();
    if (ac.includes('given-name')) return 'first_name';
    if (ac.includes('family-name')) return 'last_name';
    if (ac === 'name') return 'full_name';
    if (ac.includes('email')) return 'email';
    if (ac.includes('tel')) return 'phone';
  }
  if (!l) return 'unknown';
  for (const [key, re] of CANONICAL) if (re.test(l)) return key;
  return 'custom_question';
}

export function fingerprint(record) {
  const fields = record.fields || [];
  const norm = fields.map((f) => ({
    ...f,
    normLabel: normLabel(f.label),
    canonical: canonicalKey(f),
  }));
  record.fields = norm;

  const typeCounts = {};
  for (const f of norm) typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;

  const labelSig = sha1(norm.map((f) => `${f.type}:${f.normLabel}`).sort().join('|'));
  const shapeSig = sha1(
    JSON.stringify({
      types: Object.entries(typeCounts).sort(),
      widgets: (record.widgets || []).map((w) => w.widget).sort(),
      n: norm.length,
    })
  );
  const canonicals = [...new Set(norm.map((f) => f.canonical))].sort();
  const controls = {};
  for (const f of norm) controls[f.control || 'unknown'] = (controls[f.control || 'unknown'] || 0) + 1;
  // Two forms that ask the same things but drive them with different widgets are
  // different problems for an autofiller, so the mechanics are part of the sig.
  const controlSig = sha1(
    norm.map((f) => `${f.control}:${f.fill?.action}:${f.fill?.optionsFrom || '-'}`).sort().join('|')
  );

  return {
    labelSig,
    shapeSig,
    controlSig,
    controls,
    needsTypeahead: norm.some((f) => /on-type/.test(f.fill?.optionsFrom || '')),
    needsCalendar: norm.some((f) => /date/.test(f.control || '')),
    uiSig: sha1(`${record.platform}|${shapeSig}`),
    typeCounts,
    canonicals,
    requiredCount: norm.filter((f) => f.required).length,
    customQuestionCount: norm.filter((f) => f.canonical === 'custom_question').length,
    hasFileUpload: norm.some((f) => f.type === 'file'),
    hasNativeSelect: norm.some((f) => f.tag === 'select'),
    hasCustomDropdown: (record.widgets || []).some((w) => ['react-select', 'combobox', 'typeahead'].includes(w.widget)),
    hasDropzone: (record.widgets || []).some((w) => w.widget === 'dropzone'),
  };
}
