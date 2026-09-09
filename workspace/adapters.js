import { observe } from "./observe.js";
export const capabilities = [
  "greenhouse",
  "lever",
  "ashby",
  "avature",
  "shopify",
  "wellfound",
  "eightfold",
  "janestreet",
  "meta",
  "phenom",
  "pinpoint",
  "teamtailor",
  "workday",
].map((platform) => ({
  platform,
  level: ["greenhouse", "lever", "ashby"].includes(platform)
    ? "fixture-tested mechanics; live assisted"
    : "manual-required",
  evidence: ["workday", "phenom"].includes(platform)
    ? "Corpus first step only"
    : platform === "avature"
      ? "Login/listing gates; no post-gate coverage"
      : "Offline audit is not live certification",
}));
export class FixtureAdapter {
  constructor(origin) {
    this.origin = origin;
  }
  supports(job, page) {
    return (
      job.source === "fixture" &&
      new URL(page.url()).origin === this.origin &&
      new URL(page.url()).pathname === "/employer/" + job.externalId
    );
  }
  async verify(job, page, ob) {
    if (
      !this.supports(job, page) ||
      ob.job !== job.externalId ||
      ob.title !== job.title ||
      ob.employer !== job.company
    )
      throw Error("Selected posting identity changed");
  }
  async fill(page, f, value, document) {
    const frame = page.frames()[f.frame];
    const loc = frame.locator(`[data-workspace-field="${f.key}"]`);
    if ((await loc.count()) !== 1) throw Error("Ambiguous field");
    if (f.kind === "file") {
      if (!document) throw Error("Choose an uploaded document version");
      await loc.setInputFiles(document.path);
    } else if (f.kind === "select" || f.kind === "multi-select") {
      const vals = [value].flat().map((v) => {
        const matches = f.options.filter((o) => o.value === v || o.label === v);
        if (matches.length !== 1 || !matches[0].value)
          throw Error("Choose a real listed option");
        return matches[0].value;
      });
      await loc.selectOption(vals);
    } else if (f.kind === "radio-group") {
      const idx = f.options.findIndex(
        (o) => o.value === value || o.label === value,
      );
      if (idx < 0) throw Error("Unknown option");
      await frame.locator(`[data-workspace-member="${f.key}-${idx}"]`).check();
    } else if (f.kind === "radiogroup") {
      const button = loc.getByRole("radio", {
        name: String(value),
        exact: true,
      });
      if ((await button.count()) !== 1) throw Error("Unknown button choice");
      await button.click();
    } else if (["checkbox", "switch"].includes(f.kind)) {
      if (typeof value !== "boolean") throw Error("Explicit boolean required");
      await loc.setChecked(value);
    } else if (f.kind === "combobox") {
      await loc.fill(String(value));
      const controls = await loc.getAttribute("aria-controls");
      if (!controls || !/^[\w-]+$/.test(controls))
        throw Error("Cannot establish widget-owned options");
      const option = frame
        .locator("#" + controls)
        .getByRole("option", { name: String(value), exact: true });
      await option.waitFor({ state: "visible", timeout: 3000 });
      if ((await option.count()) !== 1) throw Error("Ambiguous widget option");
      await option.click();
    } else if (
      [
        "text",
        "email",
        "tel",
        "url",
        "textarea",
        "date",
        "number",
        "rich-text",
      ].includes(f.kind)
    )
      await loc.fill(String(value));
    else throw Error("Unsupported control requires manual input");
    const latest = await observe(page);
    const got = latest.fields.find(
      (x) =>
        x.frame === f.frame && x.nameAttr === f.nameAttr && x.name === f.name,
    );
    if (!got) throw Error("Field changed during fill; re-observe");
    const expected = document ? [document.name] : value;
    const equal =
      JSON.stringify(got.value) === JSON.stringify(expected) ||
      (f.kind === "select" &&
        f.options.some((o) => o.label === value && o.value === got.value));
    if (!equal || !got.valid || (f.kind === "combobox" && !got.committed))
      throw Error("Committed value did not verify");
    return latest;
  }
  async advance(page) {
    const b = page.locator(
      "main[data-final=false] button[data-action=advance]",
    );
    if ((await b.count()) !== 1) throw Error("Unknown non-final boundary");
    await b.click();
  }
  async review(page, ob) {
    return (
      ob.final &&
      (await page
        .locator("main[data-final=true] button[data-action=final]")
        .count()) === 1
    );
  }
}
