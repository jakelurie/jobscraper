// Shared helpers: HTTP with a browser-ish UA, bounded concurrency, slugs.
export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, opts = {}) {
  const { timeout = 20000, retries = 1, ...rest } = opts;
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        ...rest,
        signal: ctl.signal,
        headers: {
          'user-agent': UA,
          accept: 'application/json,text/plain,*/*',
          'accept-language': 'en-US,en;q=0.9',
          ...(rest.headers || {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('non-JSON response');
      }
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
}

export async function fetchText(url, opts = {}) {
  const { timeout = 20000, ...rest } = opts;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: ctl.signal,
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', ...(rest.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Run tasks with a fixed worker count. tasks: array of () => Promise
export async function pool(tasks, size, onDone) {
  const results = new Array(tasks.length);
  let next = 0;
  let finished = 0;
  const workers = Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
      finished++;
      if (onDone) onDone(finished, tasks.length, results[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

// Senior-level software engineering roles only.
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|distinguished|architect|iii|iv|l[5-7]|level\s*[5-7])\b/i;
const ENGINEERING =
  /\b(software|backend|back-end|frontend|front-end|fullstack|full-?stack|web|mobile|ios|android|platform|infrastructure|systems?|distributed|cloud|data|machine learning|ml|ai|research|security|devops|sre|reliability|compiler|kernel|embedded|firmware|api)\b/i;
const ROLE = /\b(engineer|engineering|developer|programmer|swe|sde)\b/i;
const EXCLUDE =
  /\b(manager|director|head of|vp|vice president|recruiter|sales|marketing|account|intern|internship|apprentice|support|success|technician|analyst|designer|writer|counsel|hr|people|finance|solutions? (architect|engineer)|sales engineer|field|customer)\b/i;

export function isSeniorSWE(title = '') {
  if (EXCLUDE.test(title)) return false;
  if (!ROLE.test(title)) return false;
  if (!ENGINEERING.test(title) && !/\b(swe|sde)\b/i.test(title)) return false;
  return SENIOR.test(title);
}

// --- United States scope --------------------------------------------------
// The corpus only wants US postings, so location is a hard filter rather than a
// ranking signal. Boards write location a dozen ways ("Austin, TX", "New York,
// United States", "Remote - US", "London, gb"), and the two-letter forms are
// genuinely ambiguous: CA is California and also Canada, IN is Indiana and also
// India. So the tests run in order of how much they can be trusted -- a spelled
// out place name decides outright, then an explicit US signal, and only then
// the ambiguous country codes, with the colliding ones left out entirely.

const US_STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_STATE_NAMES =
  'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia';

const US_POSITIVE = new RegExp(
  `\\b(united states|usa|u\\.s\\.a?\\.|americas)\\b|,\\s*(${US_STATES})\\b|\\b(${US_STATE_NAMES})\\b`,
  'i'
);

// Spelled-out foreign countries, regions and major cities. Unambiguous, so a
// match here settles it before any US test runs.
const NON_US_NAMES = new RegExp(
  '\\b(greece|athens|thessaloniki|united kingdom|great britain|england|scotland|wales|ireland|dublin|london|manchester|edinburgh|belfast|germany|deutschland|berlin|munich|hamburg|bremen|dresden|hannover|cologne|frankfurt|stuttgart|dusseldorf|france|paris|lyon|toulouse|bordeaux|spain|madrid|barcelona|valencia|seville|portugal|lisbon|porto|netherlands|holland|amsterdam|eindhoven|rotterdam|utrecht|the hague|belgium|brussels|antwerp|ghent|italy|rome|milan|turin|naples|poland|warsaw|krakow|wroclaw|gdansk|romania|bucharest|cluj|bulgaria|sofia|czechia|czech republic|prague|brno|slovakia|bratislava|hungary|budapest|austria|vienna|switzerland|zurich|geneva|basel|sweden|stockholm|gothenburg|malmo|norway|oslo|denmark|copenhagen|finland|helsinki|iceland|reykjavik|estonia|tallinn|lithuania|vilnius|latvia|riga|ukraine|kyiv|kiev|serbia|belgrade|croatia|zagreb|slovenia|ljubljana|cyprus|malta|luxembourg|turkey|istanbul|ankara|izmir|israel|tel aviv|jerusalem|haifa|india|bengaluru|bangalore|hyderabad|pune|mumbai|chennai|new delhi|gurgaon|gurugram|noida|kolkata|ahmedabad|china|beijing|shanghai|shenzhen|guangzhou|hong kong|taiwan|taipei|japan|tokyo|osaka|kyoto|yokohama|south korea|seoul|singapore|malaysia|kuala lumpur|indonesia|jakarta|philippines|manila|cebu|vietnam|hanoi|ho chi minh|thailand|bangkok|australia|sydney|melbourne|brisbane|perth|adelaide|canberra|new zealand|auckland|wellington|canada|toronto|vancouver|montreal|montr\\u00e9al|ottawa|calgary|edmonton|winnipeg|halifax|waterloo|british columbia|ontario|quebec|qu\\u00e9bec|alberta|manitoba|saskatchewan|nova scotia|mexico|guadalajara|monterrey|mexico city|brazil|brasil|sao paulo|s\\u00e3o paulo|rio de janeiro|belo horizonte|argentina|buenos aires|cordoba|uruguay|montevideo|chile|santiago|colombia|bogota|bogot\\u00e1|medellin|peru|lima|costa rica|san jose, cr|panama|ecuador|quito|bolivia|paraguay|venezuela|egypt|cairo|nigeria|lagos|abuja|kenya|nairobi|ghana|accra|south africa|cape town|johannesburg|pretoria|durban|dubai|abu dhabi|united arab emirates|saudi arabia|riyadh|jeddah|qatar|doha|bahrain|kuwait|oman|jordan|amman|lebanon|beirut|morocco|casablanca|rabat|tunisia|tunis|algeria|pakistan|karachi|lahore|islamabad|bangladesh|dhaka|sri lanka|colombo|nepal|kathmandu|russia|moscow|belarus|kazakhstan|apac|emea|latam|anz|benelux|nordics|dach)\\b',
  'i'
);

// Codes that do not collide with a US state abbreviation. Deliberately missing:
// ca, in, de, il, ma, id, ar, co, mn, mo, ne, mt, sc, sd, pa, va, wa, ok, or.
const NON_US_CODES = /,\s*(gb|uk|fr|es|it|nl|be|pt|pl|ro|bg|cz|hu|at|ch|se|no|dk|fi|ie|gr|tr|cn|jp|kr|sg|my|ph|vn|th|au|nz|mx|br|uy|cl|pe|za|ae|eg|ng|ke|ua|rs|hr|lt|lv|ee|is|lu|sa|qa|ph|bd|pk|lk)\b/i;

// Remote only counts when the remoteness is scoped to the US.
const US_REMOTE =
  /\b(remote)\b[^a-z]{0,14}(us|usa|united states|america|americas)\b|\b(us|usa|united states|americas)[^a-z]{0,14}\b(remote)\b/i;

export function isUSLocation(location = '', extra = '') {
  const hay = `${location} ${extra}`.trim();
  if (!hay) return null; // unknown; the caller decides what to do with that
  if (NON_US_NAMES.test(hay)) return false;
  if (US_REMOTE.test(hay)) return true;
  if (US_POSITIVE.test(hay)) return true;
  if (NON_US_CODES.test(hay)) return false;
  return null;
}

// Keeps a posting when it is US, or when the location is simply unknown and the
// caller would rather try than discard. Never keeps an explicitly foreign one.
export function keepIfUS(location = '', extra = '', { allowUnknown = true } = {}) {
  const v = isUSLocation(location, extra);
  return v === null ? allowUnknown : v;
}
