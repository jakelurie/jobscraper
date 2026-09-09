import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { hash, now } from "./db.js";
export function canonical(input) {
  const u = new URL(input);
  if (!["https:", "http:"].includes(u.protocol))
    throw Error("HTTP(S) URL required");
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|ref$|source$)/.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href;
}
export function level(title) {
  return /\b(staff|principal|senior|sr\.?|lead)\b/i.test(title)
    ? "senior"
    : /\b(intern|junior|entry|graduate)\b/i.test(title)
      ? "excluded"
      : "unknown";
}
export async function importCorpus(db, root) {
  const audit = JSON.parse(
    await readFile(path.join(root, "docs/corpus-readiness-data.json"), "utf8"),
  );
  const by = new Map(
    audit.platforms.flatMap((p) => p.records.map((r) => [r.record, r])),
  );
  let count = 0;
  for (const file of (await readdir(path.join(root, "data/forms"))).sort()) {
    if (!file.endsWith(".json")) continue;
    const rel = "data/forms/" + file;
    let text;
    try {
      text = await readFile(path.join(root, rel), "utf8");
      const r = JSON.parse(text);
      if (!r.id || !Array.isArray(r.fields))
        throw Error("Missing capture id/fields");
      const url = canonical(r.seed?.jobUrl || r.finalUrl);
      const jobId = hash(url);
      const evidence = by.get(rel);
      db.put("captures", {
        id: hash(rel),
        jobId,
        path: rel,
        originalId: r.id,
        artifacts: r.artifacts,
        kind: evidence?.observedKind || "unaudited_reference",
        retained:
          r.isApplicationForm &&
          !r.duplicateOfSameForm &&
          !r.nonUS &&
          !r.overCap,
        platform: r.platform,
        fieldCount: r.fields.length,
      });
      if (!db.get("jobs", jobId))
        db.put("jobs", {
          id: jobId,
          title: r.seed?.title || r.pageTitle,
          company: r.seed?.company || null,
          sourceUrl: r.seed?.jobUrl || url,
          canonicalUrl: url,
          applicationUrl: r.finalUrl || url,
          externalId: null,
          locations: r.seed?.location ? [r.seed.location] : [],
          original: {
            title: r.seed?.title,
            company: r.seed?.company,
            location: r.seed?.location,
          },
          description: null,
          discipline:
            /software|developer|infrastructure|backend|frontend|full.?stack|security engineer/i.test(
              r.seed?.title || "",
            )
              ? "software"
              : "unknown",
          seniority: level(r.seed?.title || ""),
          seniorityEvidence: "Title inference, not employer grade",
          geography: "unknown",
          geographyEvidence: "Seed location is unverified",
          workMode: null,
          employmentType: null,
          salary: null,
          status: "reference",
          platform: r.platform,
          source: "corpus",
          verifiedAt: null,
          notes: "",
          tags: [],
          favorite: false,
        });
      count++;
    } catch (e) {
      db.put("quarantine", {
        id: hash(rel),
        path: rel,
        error: e.message,
        hash: hash(text || ""),
        at: now(),
      });
    }
  }
  return { count, invalid: db.all("quarantine").length };
}
export function postingFromHtml(html, url) {
  const found = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    if ([x["@type"]].flat().includes("JobPosting")) found.push(x);
    if (x["@graph"]) walk(x["@graph"]);
  };
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ))
    try {
      walk(JSON.parse(m[1]));
    } catch {}
  if (found.length !== 1)
    throw Error(
      "No unique JobPosting identity. Open manually; do not substitute a listing.",
    );
  const p = found[0];
  if (!p.title || !p.hiringOrganization?.name)
    throw Error("Posting identity incomplete");
  const clean = (s) =>
    String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const loc = [p.jobLocation]
    .flat()
    .filter(Boolean)
    .map((x) => x.address || {});
  const countries = loc
    .map((x) => x.addressCountry?.name || x.addressCountry)
    .filter(Boolean);
  const geo =
    countries.length &&
    countries.every((c) => /^(US|USA|United States(?: of America)?)$/i.test(c))
      ? "verified"
      : countries.length
        ? "excluded"
        : "unknown";
  const v = p.baseSalary?.value;
  const period = { YEAR: "year", HOUR: "hour", MONTH: "month" }[v?.unitText];
  const salary =
    typeof v?.minValue === "number" &&
    typeof v?.maxValue === "number" &&
    v.minValue <= v.maxValue &&
    p.baseSalary.currency &&
    period
      ? {
          min: v.minValue,
          max: v.maxValue,
          currency: p.baseSalary.currency,
          period,
          kind: "base",
          source: url,
          evidence: "JobPosting.baseSalary",
          checkedAt: now(),
        }
      : null;
  return {
    id: hash(
      p.identifier?.value
        ? String(p.hiringOrganization.name).toLowerCase() +
            "|" +
            new URL(url).hostname +
            "|" +
            p.identifier.value
        : canonical(url),
    ),
    title: clean(p.title),
    company: clean(p.hiringOrganization.name),
    sourceUrl: url,
    canonicalUrl: canonical(url),
    applicationUrl: canonical(url),
    externalId: p.identifier?.value || null,
    locations: loc.map((x) =>
      [
        x.addressLocality,
        x.addressRegion,
        x.addressCountry?.name || x.addressCountry,
      ]
        .filter(Boolean)
        .join(", "),
    ),
    description: clean(p.description),
    discipline:
      /software|developer|infrastructure|backend|frontend|full.?stack|security engineer/i.test(
        p.title,
      )
        ? "software"
        : "unknown",
    original: p,
    geography: geo,
    geographyEvidence: "JobPosting jobLocation (not work authorization)",
    seniority: level(p.title),
    seniorityEvidence: "Title inference",
    salary,
    workMode: p.jobLocationType === "TELECOMMUTE" ? "remote" : null,
    employmentType: p.employmentType || null,
    status: "active",
    source: "live",
    verifiedAt: now(),
    platform: new URL(url).hostname,
    notes: "",
    tags: [],
    favorite: false,
  };
}
