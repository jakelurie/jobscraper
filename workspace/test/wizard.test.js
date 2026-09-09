import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspace } from "../server.js";
const wait = async (fn) => {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw Error("State wait timeout");
};
test("six-step wizard, repeatable history takeover, tab loss, and three separate fixture receipts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ws-wizard"));
  let app;
  try {
    app = await createWorkspace({
      directory: dir,
      port: 0,
      headless: true,
      importReferences: false,
      perOrigin: 3,
    });
    const db = app.db;
    for (const [k, v] of Object.entries({
      fullName: "Test Candidate",
      email: "test@example.test",
      country: "United States of America",
    }))
      db.put("facts", {
        id: k,
        key: k,
        value: v,
        version: 1,
        confirmedAt: new Date().toISOString(),
      });
    const runs = app.scheduler.create([
      "fixture-workday",
      "fixture-phenom",
      "fixture-greenhouse",
    ]);
    let added = false;
    for (const run of runs) {
      for (let round = 0; round < 55; round++) {
        await wait(
          () => !["queued", "preparing"].includes(db.get("runs", run.id).state),
        );
        const r = db.get("runs", run.id);
        if (r.state === "ready_for_review") break;
        assert.equal(r.state, "needs_input", r.error);
        if (r.jobId === "fixture-workday" && r.step === "2" && !added) {
          await app.scheduler.control(r.id, "takeover");
          await app.browsers.sessions
            .get(r.id)
            .page.locator("[data-action=add-history]")
            .click();
          await app.scheduler.control(r.id, "resume");
          added = true;
          continue;
        }
        const q = db
          .all("questions")
          .find((q) => q.runId === r.id && q.state === "open");
        assert(q?.field, q?.reason);
        const f = q.field;
        let value,
          skip = false;
        if (!f.required) skip = true;
        else if (f.kind === "checkbox") value = true;
        else if (f.nameAttr === "city") value = "New York";
        else if (f.kind === "date") value = "2026-10-10";
        else value = "Confirmed fixture answer";
        app.scheduler.answer(q.id, value, { skip });
      }
      const r = db.get("runs", run.id);
      assert.equal(r.state, "ready_for_review");
      if (r.jobId !== "fixture-greenhouse") {
        assert.equal(r.step, "6");
        const stages = new Set(
          db
            .all("steps")
            .filter((s) => s.runId === r.id)
            .map((s) => s.observation.step),
        );
        assert.deepEqual([...stages].sort(), ["1", "2", "3", "4", "5", "6"]);
      }
      if (r.jobId === "fixture-workday")
        assert(
          db
            .all("steps")
            .some(
              (s) =>
                s.runId === r.id &&
                s.observation.fields.some(
                  (f) =>
                    f.nameAttr === "employer2" &&
                    f.value === "Confirmed fixture answer",
                ),
            ),
        );
      assert.equal(db.all("receipts").length, runs.indexOf(run));
      const auth = await app.gate.authorize(r.id, r.reviewId);
      await app.gate.submit(auth.id);
      assert.equal(db.get("runs", run.id).state, "submitted");
    }
    assert.equal(db.all("receipts").length, 3);
    const [lost] = app.scheduler.create(["fixture-lever"]);
    await wait(() => app.browsers.sessions.has(lost.id));
    await app.browsers.sessions.get(lost.id).page.close();
    await wait(() => db.get("runs", lost.id).state === "expired");
    assert.equal(db.get("runs", lost.id).state, "expired");
  } finally {
    if (app) await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
