// Executes inside a frame; includes open shadow roots. Fields get observation
// IDs for this DOM only. They are never reused across navigation/re-observation.
export function scan() {
  let seq = 0;
  const out = [];
  const roots = [document];
  const all = [];
  for (let i = 0; i < roots.length; i++) {
    for (const e of roots[i].querySelectorAll("*")) {
      all.push(e);
      if (e.shadowRoot) roots.push(e.shadowRoot);
    }
  }
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    return (
      !!(r.width && r.height) && getComputedStyle(e).visibility !== "hidden"
    );
  };
  const text = (e) =>
    (e?.innerText || e?.textContent || "").replace(/\s+/g, " ").trim();
  const label = (e) =>
    e.getAttribute("aria-label") ||
    e.labels?.[0]?.textContent?.trim() ||
    text(e.closest("fieldset")?.querySelector("legend")) ||
    e.getAttribute("placeholder") ||
    e.name ||
    "";
  const groups = new Set();
  for (const e of all) {
    if (
      !e.matches(
        "input,select,textarea,[contenteditable=true],[role=combobox],[role=radiogroup],[role=checkbox],[role=switch]",
      )
    )
      continue;
    if (
      e.matches(
        "input[type=hidden],input[type=submit],input[type=button],input[type=reset]",
      )
    )
      continue;
    if (!visible(e) && e.type !== "file") continue;
    if (
      e.closest("[role=radiogroup]") &&
      e.getAttribute("role") !== "radiogroup"
    )
      continue;
    let members = [e],
      kind = e.getAttribute("role") || e.type || e.tagName.toLowerCase();
    if (e.tagName === "SELECT") kind = e.multiple ? "multi-select" : "select";
    if (e.isContentEditable) kind = "rich-text";
    if (e.type === "radio" && e.name) {
      const key = e.getRootNode() === document ? e.name : e.name + "shadow";
      if (groups.has(key)) continue;
      groups.add(key);
      members = all.filter(
        (x) =>
          x.tagName === "INPUT" &&
          x.type === "radio" &&
          x.name === e.name &&
          x.getRootNode() === e.getRootNode(),
      );
      kind = "radio-group";
    }
    const key = "w" + seq++;
    e.setAttribute("data-workspace-field", key);
    members.forEach((x, i) =>
      x.setAttribute("data-workspace-member", key + "-" + i),
    );
    let options = [];
    if (e.tagName === "SELECT")
      options = [...e.options].map((o) => ({
        label: o.textContent.trim(),
        value: o.value,
      }));
    if (kind === "radio-group")
      options = members.map((x) => ({ label: label(x), value: x.value }));
    if (kind === "radiogroup")
      options = [...e.querySelectorAll("[role=radio],button")].map((x) => ({
        label: text(x),
        value: text(x),
      }));
    let value =
      e.type === "file"
        ? [...e.files].map((f) => f.name)
        : e.type === "checkbox" || kind === "switch" || kind === "checkbox"
          ? !!(e.checked || e.getAttribute("aria-checked") === "true")
          : kind === "radio-group"
            ? members.find((x) => x.checked)?.value || ""
            : kind === "radiogroup"
              ? text(e.querySelector("[aria-checked=true]"))
              : e.isContentEditable
                ? text(e)
                : e.multiple
                  ? [...e.selectedOptions].map((o) => o.value)
                  : e.value || "";
    const context = text(
      e.closest("fieldset") || e.closest("[data-question]") || e.parentElement,
    ).slice(0, 6000);
    const name =
      kind === "radio-group"
        ? text(e.closest("fieldset")?.querySelector("legend")) || e.name
        : label(e);
    out.push({
      key,
      kind,
      name,
      context,
      required: members.some(
        (x) => x.required || x.getAttribute("aria-required") === "true",
      ),
      options,
      value,
      autocomplete: e.autocomplete || "",
      nameAttr: e.name || e.id || "",
      valid: e.validity?.valid !== false,
      error: e.validationMessage || "",
      accept: e.accept || "",
      constraints: {
        min: e.min || "",
        max: e.max || "",
        maxLength: e.maxLength > 0 ? e.maxLength : null,
      },
      committed: e.dataset.committed || null,
    });
  }
  return {
    url: location.href,
    title: document.title,
    heading: text(document.querySelector("h1")),
    employer: text(document.querySelector("h2")),
    step: document.querySelector("main")?.dataset.step || "Unknown step",
    final: document.querySelector("main")?.dataset.final === "true",
    job: document.querySelector("main")?.dataset.job || null,
    receipt:
      document.querySelector("[data-receipt]")?.getAttribute("data-receipt") ||
      null,
    fields: out,
  };
}
export async function observe(page) {
  const frames = [];
  for (const [index, frame] of page.frames().entries()) {
    try {
      frames.push({ ...(await frame.evaluate(scan)), frame: index });
    } catch {}
  }
  return {
    url: page.url(),
    frames,
    fields: frames.flatMap((f) =>
      f.fields.map((x) => ({
        ...x,
        frame: f.frame,
        frameUrl: f.url,
        step: f.step,
      })),
    ),
    title: frames[0]?.heading || "",
    employer: frames[0]?.employer || "",
    step: frames[0]?.step || "Unknown",
    final: frames[0]?.final || false,
    receipt: frames[0]?.receipt || null,
    job: frames[0]?.job || null,
  };
}
