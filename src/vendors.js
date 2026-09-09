// Tier A discovery: ATS vendors and large in-house career sites that expose a
// public JSON listing API. Each adapter returns normalized job records.
import { fetchJson, fetchText } from './lib/util.js';
import {
  GREENHOUSE_TENANTS, LEVER_TENANTS, ASHBY_TENANTS, WORKDAY_TENANTS,
  SMARTRECRUITERS_TENANTS, WORKABLE_TENANTS, RECRUITEE_TENANTS,
} from './tenants.js';

const j = (o) => ({ 'content-type': 'application/json' });

/* ---------------------------- ATS vendors ---------------------------- */

export const GREENHOUSE = {
  id: 'greenhouse',
  label: 'Greenhouse',
  tenants: GREENHOUSE_TENANTS,
  async jobs(t) {
    const d = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${t}/jobs`);
    return (d.jobs || []).map((x) => ({
      company: t,
      title: x.title,
      location: x.location?.name || '',
      jobUrl: x.absolute_url,
      applyUrl: x.absolute_url,
    }));
  },
};

export const LEVER = {
  id: 'lever',
  label: 'Lever',
  tenants: LEVER_TENANTS,
  async jobs(t) {
    const d = await fetchJson(`https://api.lever.co/v0/postings/${t}?mode=json`);
    return (d || []).map((x) => ({
      company: t,
      title: x.text,
      location: x.categories?.location || '',
      jobUrl: x.hostedUrl,
      applyUrl: x.applyUrl || `${x.hostedUrl}/apply`,
    }));
  },
};

export const ASHBY = {
  id: 'ashby',
  label: 'Ashby',
  tenants: ASHBY_TENANTS,
  async jobs(t) {
    const d = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${t}`);
    return (d.jobs || []).map((x) => ({
      company: t,
      title: x.title,
      location: x.location || '',
      jobUrl: x.jobUrl,
      applyUrl: x.applyUrl || `${x.jobUrl}/application`,
    }));
  },
};

export const SMARTRECRUITERS = {
  id: 'smartrecruiters',
  label: 'SmartRecruiters',
  tenants: SMARTRECRUITERS_TENANTS,
  async jobs(t) {
    const d = await fetchJson(
      `https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=100&q=engineer`
    );
    return (d.content || []).map((x) => ({
      company: t,
      title: x.name,
      location: [x.location?.city, x.location?.country].filter(Boolean).join(', '),
      jobUrl: `https://jobs.smartrecruiters.com/${x.company?.identifier || t}/${x.id}`,
      applyUrl: `https://jobs.smartrecruiters.com/${x.company?.identifier || t}/${x.id}`,
    }));
  },
};

export const WORKABLE = {
  id: 'workable',
  label: 'Workable',
  tenants: WORKABLE_TENANTS,
  async jobs(t) {
    const d = await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`);
    return (d.jobs || []).map((x) => ({
      company: t,
      title: x.title,
      location: [x.city, x.country].filter(Boolean).join(', '),
      jobUrl: x.url,
      applyUrl: x.application_url || `${x.url}/apply`,
    }));
  },
};

export const RECRUITEE = {
  id: 'recruitee',
  label: 'Recruitee',
  tenants: RECRUITEE_TENANTS,
  async jobs(t) {
    const d = await fetchJson(`https://${t}.recruitee.com/api/offers/`);
    return (d.offers || []).map((x) => ({
      company: t,
      title: x.title,
      location: x.location || '',
      jobUrl: x.careers_url,
      applyUrl: x.careers_apply_url || `${x.careers_url}/apply`,
    }));
  },
};

export const BREEZY = {
  id: 'breezy',
  label: 'Breezy HR',
  tenants: ['breezy', 'nomadhealth', 'tenderfoot', 'sonatype'],
  async jobs(t) {
    const d = await fetchJson(`https://${t}.breezy.hr/json`);
    return (d || []).map((x) => ({
      company: t,
      title: x.name,
      location: x.location?.name || '',
      jobUrl: x.url,
      applyUrl: `${x.url}/applicant/new`,
    }));
  },
};

export const BAMBOOHR = {
  id: 'bamboohr',
  label: 'BambooHR',
  tenants: ['bamboohr', 'jhu', 'fullscript', 'workwave'],
  async jobs(t) {
    const d = await fetchJson(`https://${t}.bamboohr.com/careers/list`);
    return (d.result || []).map((x) => ({
      company: t,
      title: x.jobOpeningName,
      location: [x.location?.city, x.location?.state].filter(Boolean).join(', '),
      jobUrl: `https://${t}.bamboohr.com/careers/${x.id}`,
      applyUrl: `https://${t}.bamboohr.com/careers/${x.id}`,
    }));
  },
};

export const RIPPLING = {
  id: 'rippling',
  label: 'Rippling ATS',
  tenants: ['rippling', 'gusto-2', 'anrok'],
  async jobs(t) {
    const d = await fetchJson(`https://api.rippling.com/platform/api/ats/v1/board/${t}/jobs`);
    return (Array.isArray(d) ? d : d.items || []).map((x) => ({
      company: t,
      title: x.name || x.title,
      location: x.workLocation?.label || x.location || '',
      jobUrl: x.url,
      applyUrl: x.url,
    }));
  },
};

// Workday tenants: [host, tenant, site]
export const WORKDAY = {
  id: 'workday',
  label: 'Workday',
  tenants: WORKDAY_TENANTS,
  async jobs([host, tenant, site]) {
    const d = await fetchJson(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST',
      headers: j(),
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: 'senior software engineer' }),
    });
    return (d.jobPostings || []).map((x) => ({
      company: tenant,
      title: x.title,
      location: x.locationsText || '',
      jobUrl: `https://${host}/en-US/${site}${x.externalPath}`,
      applyUrl: `https://${host}/en-US/${site}${x.externalPath}/apply`,
    }));
  },
  key: (t) => t[1],
};

// Eightfold AI tenants: [host, domain]
export const EIGHTFOLD = {
  id: 'eightfold',
  label: 'Eightfold AI',
  tenants: [
    ['explore.jobs.netflix.net', 'netflix.com'],
    ['careers.chevron.com', 'chevron.com'],
    ['jobs.telusinternational.com', 'telusinternational.com'],
    ['careers.hitachi.com', 'hitachi.com'],
  ],
  async jobs([host, domain]) {
    const d = await fetchJson(
      `https://${host}/api/apply/v2/jobs?domain=${domain}&start=0&num=20&query=senior%20software%20engineer&sort_by=relevance`
    );
    return (d.positions || []).map((x) => ({
      company: domain.replace(/\..*/, ''),
      title: x.name,
      location: (x.locations || []).join('; ') || x.location || '',
      jobUrl: x.canonicalPositionUrl || `https://${host}/careers?pid=${x.id}`,
      applyUrl: `https://${host}/careers?pid=${x.id}&domain=${domain}&sort_by=relevance&triggerGoButton=false`,
    }));
  },
  key: (t) => t[1],
};

export const PERSONIO = {
  id: 'personio',
  label: 'Personio',
  tenants: ['personio', 'sennder', 'raisin'],
  async jobs(t) {
    const xml = await fetchText(`https://${t}.jobs.personio.de/xml`);
    const out = [];
    for (const m of xml.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
      const b = m[1];
      const get = (tag) => (b.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`)) || [])[1] || '';
      const id = get('id');
      out.push({
        company: t,
        title: get('name'),
        location: get('office'),
        jobUrl: `https://${t}.jobs.personio.de/job/${id}`,
        applyUrl: `https://${t}.jobs.personio.de/job/${id}#apply`,
      });
    }
    return out;
  },
};

/* --------------------- In-house career-site APIs --------------------- */

export const AMAZON = {
  id: 'amazon',
  label: 'Amazon (in-house)',
  tenants: ['amazon'],
  async jobs() {
    const d = await fetchJson(
      'https://www.amazon.jobs/en/search.json?base_query=senior+software+development+engineer&result_limit=20&sort=relevant'
    );
    return (d.jobs || []).map((x) => ({
      company: 'amazon',
      title: x.title,
      location: x.location || x.normalized_location || '',
      jobUrl: `https://www.amazon.jobs${x.job_path}`,
      applyUrl: `https://www.amazon.jobs${x.job_path}/apply`,
    }));
  },
};

export const MICROSOFT = {
  id: 'microsoft',
  label: 'Microsoft (in-house)',
  tenants: ['microsoft'],
  async jobs() {
    const d = await fetchJson(
      'https://gcsservices.careers.microsoft.com/search/api/v1/search?q=senior%20software%20engineer&l=en_us&pg=1&pgSz=20&o=Relevance&flt=true'
    );
    const jobs = d.operationResult?.result?.jobs || [];
    return jobs.map((x) => ({
      company: 'microsoft',
      title: x.title,
      location: x.properties?.locations?.[0] || x.properties?.primaryLocation || '',
      jobUrl: `https://jobs.careers.microsoft.com/global/en/job/${x.jobId}/`,
      applyUrl: `https://jobs.careers.microsoft.com/global/en/job/${x.jobId}/apply`,
    }));
  },
};

export const APPLE = {
  id: 'apple',
  label: 'Apple (in-house)',
  tenants: ['apple'],
  async jobs() {
    const d = await fetchJson('https://jobs.apple.com/api/role/search', {
      method: 'POST',
      headers: { ...j(), referer: 'https://jobs.apple.com/en-us/search' },
      body: JSON.stringify({
        query: 'senior software engineer',
        filters: { range: { standardWeeklyHours: { start: null, end: null } } },
        page: 1,
        locale: 'en-us',
        sort: 'relevance',
      }),
    });
    return (d.searchResults || []).map((x) => ({
      company: 'apple',
      title: x.postingTitle || x.transformedPostingTitle,
      location: x.locations?.[0]?.name || x.postingLocation || '',
      jobUrl: `https://jobs.apple.com/en-us/details/${x.positionId}`,
      applyUrl: `https://jobs.apple.com/en-us/details/${x.positionId}`,
    }));
  },
};

export const TESLA = {
  id: 'tesla',
  label: 'Tesla (in-house)',
  tenants: ['tesla'],
  async jobs() {
    const d = await fetchJson('https://www.tesla.com/cua-api/apps/careers/state');
    const lookup = d.lookup || {};
    const listings = (d.listings || []).filter((x) => /engineer/i.test(x.t || ''));
    return listings.slice(0, 60).map((x) => ({
      company: 'tesla',
      title: x.t,
      location: lookup.locations?.[x.l] || '',
      jobUrl: `https://www.tesla.com/careers/search/job/${x.id}`,
      applyUrl: `https://www.tesla.com/careers/search/job/${x.id}`,
    }));
  },
};

export const VENDORS = [
  GREENHOUSE, LEVER, ASHBY, SMARTRECRUITERS, WORKABLE, RECRUITEE, BREEZY,
  BAMBOOHR, RIPPLING, WORKDAY, EIGHTFOLD, PERSONIO,
  AMAZON, MICROSOFT, APPLE, TESLA,
];
