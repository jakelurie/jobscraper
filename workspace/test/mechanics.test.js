import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { observe } from "../observe.js";
import { FixtureAdapter } from "../adapters.js";
test("live extraction/readback: frames, shadow DOM, native groups, rich text, dates and scoped async options", async () => {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<form><label>Start date<input name="date" type="date" required></label><label>Phone country<select name="code"><option value="">Choose</option><option value="us">+1</option><option value="gb">+44</option></select></label><label>Phone<input name="phone" type="tel"></label><fieldset><legend>Radio context</legend><label><input name="radio" type="radio" value="yes">Yes</label><label><input name="radio" type="radio" value="no">No</label></fieldset><div contenteditable="true" aria-label="Cover writing" id="writing"></div><label>Skills<select multiple name="skills"><option>JS</option><option>Python</option></select></label><label>Explicit permission<input type="checkbox" name="consent"></label><div id="shadow"></div><iframe srcdoc='<label>Frame field<input name="framed"></label>'></iframe></form>`,
    );
    await page.locator("#shadow").evaluate((e) => {
      e.attachShadow({ mode: "open" }).innerHTML =
        '<label>Shadow field<input name="shadowed"></label>';
    });
    const adapter = new FixtureAdapter("http://fixture");
    for (const [nameAttr, name, value] of [
      ["date", "Start date", "2026-10-01"],
      ["code", "Phone country", "us"],
      ["phone", "Phone", "5551234"],
      ["radio", "Radio context", "no"],
      ["writing", "Cover writing", "User supplied writing"],
      ["skills", "Skills", ["JS", "Python"]],
      ["consent", "Explicit permission", true],
      ["shadowed", "Shadow field", "Shadow answer"],
      ["framed", "Frame field", "Frame answer"],
    ]) {
      const ob = await observe(page);
      const f = ob.fields.find((f) => f.nameAttr === nameAttr);
      assert(f, name);
      await adapter.fill(page, f, value);
      const actual = (await observe(page)).fields.find(
        (f) => f.nameAttr === nameAttr,
      );
      assert.deepEqual(actual.value, value);
    }
    assert.equal(
      (await observe(page)).fields.filter((f) => f.kind === "radio-group")
        .length,
      1,
    );
    await page.setContent(
      `<label>City<input role="combobox" name="city" aria-controls="correct"></label><div id="wrong" role="listbox"><button role="option">Boston</button></div><div id="correct" role="listbox"></div><script>const c=document.querySelector('input');c.oninput=()=>setTimeout(()=>{document.querySelector('#correct').innerHTML='<button role="option">Boston</button>';document.querySelector('#correct button').onclick=()=>{c.value='Boston';c.dataset.committed='Boston';};},100);</script>`,
    );
    await adapter.fill(page, (await observe(page)).fields[0], "Boston");
    assert.equal((await observe(page)).fields[0].committed, "Boston");
    // An ambiguous final-looking page cannot pass a trusted fixture identity check.
    assert.equal(
      adapter.supports({ source: "live", externalId: "x" }, page),
      false,
    );
  } finally {
    await browser.close();
  }
});
