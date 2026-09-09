// Identify the application platform from the final URL plus page markers.
export const PLATFORM_PATTERNS = [
  [/greenhouse\.io|boards\.greenhouse/i, 'greenhouse', 'Greenhouse'],
  [/lever\.co/i, 'lever', 'Lever'],
  [/ashbyhq\.com/i, 'ashby', 'Ashby'],
  [/myworkdayjobs\.com|myworkdaysite\.com|wd\d+\.myworkday/i, 'workday', 'Workday'],
  [/smartrecruiters\.com/i, 'smartrecruiters', 'SmartRecruiters'],
  [/workable\.com/i, 'workable', 'Workable'],
  [/recruitee\.com/i, 'recruitee', 'Recruitee'],
  [/breezy\.hr/i, 'breezy', 'Breezy HR'],
  [/bamboohr\.com/i, 'bamboohr', 'BambooHR'],
  [/icims\.com/i, 'icims', 'iCIMS'],
  [/taleo\.net|taleo\.com/i, 'taleo', 'Oracle Taleo'],
  [/successfactors\.|sfcareers|jobs\.sap\.com|rmkcdn/i, 'successfactors', 'SAP SuccessFactors'],
  [/oraclecloud\.com|\.fa\.\w+\.oraclecloud|oracle\.com\/careers/i, 'oracle-hcm', 'Oracle Recruiting Cloud'],
  [/jobvite\.com/i, 'jobvite', 'Jobvite'],
  [/avature\.net/i, 'avature', 'Avature'],
  [/eightfold\.ai|\.eightfold\.|explore\.jobs\./i, 'eightfold', 'Eightfold AI'],
  [/phenompeople\.com|phenom\.com|\/phapp\//i, 'phenom', 'Phenom People'],
  [/teamtailor\.com/i, 'teamtailor', 'Teamtailor'],
  [/applytojob\.com/i, 'jazzhr', 'JazzHR'],
  [/personio\.(de|com)/i, 'personio', 'Personio'],
  [/pinpointhq\.com/i, 'pinpoint', 'Pinpoint'],
  [/rippling\.com|rippling-ats/i, 'rippling', 'Rippling ATS'],
  [/paylocity\.com/i, 'paylocity', 'Paylocity'],
  [/dayforcehcm\.com|dayforce/i, 'dayforce', 'Ceridian Dayforce'],
  [/myworkdayjobs/i, 'workday', 'Workday'],
  [/adp\.com|workforcenow/i, 'adp', 'ADP'],
  [/ultipro\.com|ukg\.com/i, 'ukg', 'UKG'],
  [/clearcompany\.com/i, 'clearcompany', 'ClearCompany'],
  [/gem\.com\/jobs|jobs\.gem\.com/i, 'gem', 'Gem'],
  [/dover\.com/i, 'dover', 'Dover'],
  [/polymer\.co/i, 'polymer', 'Polymer'],
  [/workstream\.us/i, 'workstream', 'Workstream'],
  [/jobs\.apple\.com/i, 'apple', 'Apple (in-house)'],
  [/careers\.microsoft\.com|jobs\.careers\.microsoft/i, 'microsoft', 'Microsoft (in-house)'],
  [/amazon\.jobs/i, 'amazon', 'Amazon (in-house)'],
  [/google\.com\/about\/careers/i, 'google', 'Google (in-house)'],
  [/metacareers\.com/i, 'meta', 'Meta (in-house)'],
  [/tesla\.com/i, 'tesla', 'Tesla (in-house)'],
  [/janestreet\.com/i, 'janestreet', 'Jane Street (in-house)'],
  [/higher\.gs\.com|goldmansachs\.com/i, 'goldman', 'Goldman Sachs (in-house)'],
  [/careers\.bloomberg/i, 'bloomberg', 'Bloomberg (in-house)'],
  [/jobs\.cisco\.com/i, 'cisco', 'Cisco (in-house)'],
  [/ibm\.com\/(careers|employment)/i, 'ibm', 'IBM (in-house)'],
  [/uber\.com\/.*careers/i, 'uber', 'Uber (in-house)'],
  [/stripe\.com\/jobs/i, 'stripe', 'Stripe (in-house)'],
  [/lifeatspotify\.com|spotifyjobs/i, 'spotify', 'Spotify (in-house)'],
  [/atlassian\.com\/company\/careers/i, 'atlassian', 'Atlassian (in-house)'],
  [/careers\.snap\.com|snap\.com\/jobs/i, 'snap', 'Snap (in-house)'],
];

export function detectPlatform(url = '', hints = {}) {
  const hay = [url, ...(hints.scripts || []), ...(hints.frames || [])].join(' ');
  for (const [re, id, label] of PLATFORM_PATTERNS) {
    if (re.test(hay)) return { platform: id, platformLabel: label };
  }
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  return { platform: host ? `custom:${host}` : 'unknown', platformLabel: host || 'Unknown' };
}
