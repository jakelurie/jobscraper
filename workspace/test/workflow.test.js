import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspace } from "../server.js";
import { canonical, postingFromHtml, importCorpus } from "../importer.js";
import { Store, hash } from "../db.js";
const wait = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw Error("Timed out waiting for state");
};
test("canonical IDs preserve requisitions and importer quarantines malformed input", async () => {
  assert.notEqual(
    canonical("https://example.com/job?pid=1"),
    canonical("https://example.com/job?pid=2"),
  );
  assert.equal(
    canonical("https://example.com/job?pid=1&utm_source=a"),
    canonical("https://example.com/job?pid=1"),
  );
  const dir = await mkdtemp(path.join(os.tmpdir(), "ws-import"));
  const db = new Store(":memory:");
  try {
    await mkdir(path.join(dir, "docs"));
    await mkdir(path.join(dir, "data/forms"), { recursive: true });
    await writeFile(
      path.join(dir, "docs/corpus-readiness-data.json"),
      JSON.stringify({ platforms: [] }),
    );
    await writeFile(path.join(dir, "data/forms/bad.json"), "{bad");
    for (const n of [1, 2])
      await writeFile(
        path.join(dir, `data/forms/${n}.json`),
        JSON.stringify({
          id: n,
          fields: [],
          seed: {
            jobUrl: `https://example.com/jobs?pid=${n}`,
            title: "Same title",
          },
        }),
      );
    await importCorpus(db, dir);
    await importCorpus(db, dir);
    assert.equal(db.all("jobs").length, 2);
    assert.equal(db.all("quarantine").length, 1);
    assert(db.all("jobs").every((j) => j.status === "reference"));
  } finally {
    db.close();
    await rm(dir, { recursive: true });
  }
});
test("three Chrome sessions, progressive questions, takeover, wizard, uploads and individual submit gate", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workspace-e2e"));
  let app;
  try {
    app = await createWorkspace({
      directory: dir,
      port: 0,
      headless: true,
      importReferences: false,
      perOrigin: 3,
    });
    const post = async (route, body) => {
      const r = await fetch(app.url + "/api/" + route, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Token": app.token,
        },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      return d;
    };
    await post("profile", {
      data: {
        fullName: "Fixture Candidate",
        email: "candidate@example.test",
        country: "United States of America",
        phoneCode: "+1",
        phone: "5550100",
      },
    });
    const runs = await post("batch", {
      ids: ["fixture-greenhouse", "fixture-lever", "fixture-ashby"],
      confirmed: true,
    });
    assert.equal(runs.length, 3);
    await wait(() =>
      app.db.all("runs").every((r) => r.state === "needs_input"),
    );
    assert.equal(app.browsers.sessions.size, 3);
    assert.equal(app.scheduler.active.size, 0);
    const green = runs[0],
      lever = runs[1],
      ashby = runs[2];
    const before = app.browsers.sessions.get(green.id).page;
    await post("control", { id: green.id, action: "takeover" });
    assert.equal(app.db.get("runs", green.id).owner, "manual");
    await before.locator("[name=fullName]").fill("Manual Candidate");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      await before.locator("[name=fullName]").inputValue(),
      "Manual Candidate",
    );
    await post("control", { id: green.id, action: "resume" });
    await wait(() => app.db.get("runs", green.id).state === "needs_input");
    assert.equal(before, app.browsers.sessions.get(green.id).page);
    const upload = await fetch(app.url + "/api/upload", {
      method: "POST",
      headers: { "X-Workspace-Token": app.token, "X-File-Name": "resume.txt" },
      body: "Fixture resume supplied by test",
    });
    const document = await upload.json();
    assert.equal(upload.status, 200);
    async function answerNext(run) {
      const q = app.db
        .all("questions")
        .find((q) => q.runId === run.id && q.state === "open");
      if (!q) return false;
      if (!q.field) throw Error("Unexpected manual task " + q.reason);
      const f = q.field;
      let value;
      let skip = false;
      if (f.kind === "file") value = document.id;
      else if (f.kind === "checkbox") value = true;
      else if (f.nameAttr === "motivation")
        value = "I want to work on these systems.";
      else if (f.nameAttr === "interview") value = "Yes";
      else if (f.nameAttr === "accommodation") value = "Yes";
      else if (f.nameAttr === "accommodationDetails")
        value = "Fixture accessible interview";
      else if (f.nameAttr === "city") value = "San Francisco";
      else if (f.nameAttr === "available") value = "2026-10-01";
      else if (f.nameAttr.startsWith("employer")) value = "Fixture Employer";
      else if (!f.required) skip = true;
      else throw Error("Unexpected question " + JSON.stringify(f));
      await post("answer", { id: q.id, value, skip });
      await wait(
        () =>
          app.db.get("runs", run.id).state !== "queued" &&
          app.db.get("runs", run.id).state !== "preparing",
      );
      return true;
    }
    // One run remains blocked while other independent employers reach review.
    for (const r of [lever, ashby]) {
      for (
        let i = 0;
        i < 20 && app.db.get("runs", r.id).state !== "ready_for_review";
        i++
      )
        await answerNext(r);
      assert.equal(app.db.get("runs", r.id).state, "ready_for_review");
    }
    assert.equal(app.db.get("runs", green.id).state, "needs_input");
    assert.equal(app.db.all("attempts").length, 0);
    assert.equal(app.db.get("runs", ashby.id).step, "3");
    const as = app.browsers.sessions.get(ashby.id);
    const history = app.db.all("steps").filter((s) => s.runId === ashby.id);
    assert(
      history.some((s) =>
        s.observation.fields.some((f) => f.nameAttr === "accommodationDetails"),
      ),
    );
    assert(
      history.some((s) =>
        s.observation.fields.some(
          (f) => f.nameAttr === "city" && f.committed === "San Francisco",
        ),
      ),
    );
    const ar = app.db.get("runs", ashby.id);
    const auth = await post("authorize", {
      runId: ashby.id,
      reviewId: ar.reviewId,
      confirmed: true,
    });
    const outcomes = await Promise.allSettled([
      post("submit", { authorizationId: auth.id }),
      post("submit", { authorizationId: auth.id }),
    ]);
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(
      app.db.all("receipts").filter((r) => r.runId === ashby.id).length,
      1,
    );
    for (
      let i = 0;
      i < 20 && app.db.get("runs", green.id).state !== "ready_for_review";
      i++
    )
      await answerNext(green);
    assert.equal(app.db.get("runs", green.id).state, "ready_for_review");
    const lr = app.db.get("runs", lever.id);
    const la = await post("authorize", {
      runId: lever.id,
      reviewId: lr.reviewId,
      confirmed: true,
    });
    await app.browsers.sessions
      .get(lever.id)
      .page.locator("[name=attestation]")
      .uncheck();
    await assert.rejects(post("submit", { authorizationId: la.id }));
    assert.equal(app.db.get("runs", lever.id).state, "submission_unknown");
    assert.equal(
      app.db.all("receipts").filter((r) => r.runId === lever.id).length,
      0,
    );
    await app.close();
    app = null;
    app = await createWorkspace({
      directory: dir,
      port: 0,
      headless: true,
      importReferences: false,
    });
    assert.equal(app.db.get("runs", green.id).state, "expired");
    assert.equal(app.db.get("runs", lever.id).state, "submission_unknown");
    assert.equal(app.db.get("runs", ashby.id).state, "submitted");
    assert(app.db.all("questions").length > 0);
    assert(app.db.all("answers").length > 0);
  } finally {
    if (app) await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
