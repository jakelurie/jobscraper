import { id, now, transition, hash } from "./db.js";
import { observe } from "./observe.js";
import { stateFingerprint } from "./scheduler.js";
import { readFile } from "node:fs/promises";
export class SubmissionGate {
  constructor(db, browsers, adapter) {
    this.db = db;
    this.browsers = browsers;
    this.adapter = adapter;
  }
  async current(run) {
    const s = this.browsers.sessions.get(run.id);
    if (!s || s.owner === "manual")
      throw Error("Session not available for verified review");
    const job = this.db.get("jobs", run.jobId);
    if (job.source !== "fixture")
      throw Error(
        "Real submissions disabled: no verified tenant-specific final boundary",
      );
    const ob = await observe(s.page);
    await this.adapter.verify(job, s.page, ob);
    if (!(await this.adapter.review(s.page, ob)))
      throw Error("Not on final review");
    if (
      ob.fields.some(
        (f) =>
          f.required &&
          (!f.valid ||
            f.value === false ||
            f.value === "" ||
            (Array.isArray(f.value) && !f.value.length)),
      )
    )
      throw Error("Required live values unresolved");
    const answers = this.db.all("answers").filter((a) => a.runId === run.id);
    const docs = this.db
      .all("documents")
      .filter((d) => answers.some((a) => a.value === d.id));
    for (const d of docs)
      if (hash((await readFile(d.path)).toString("base64")) !== d.sha)
        throw Error("Document changed since upload");
    return { s, ob, fingerprint: stateFingerprint(ob, answers, docs) };
  }
  async authorize(runId, reviewId) {
    const run = this.db.get("runs", runId);
    if (run?.state !== "ready_for_review" || run.reviewId !== reviewId)
      throw Error("Fresh review required");
    const review = this.db.get("reviews", reviewId),
      cur = await this.current(run);
    if (cur.fingerprint !== review.fingerprint)
      throw Error("Live values changed. Resume preparation and review again.");
    return this.db.tx(() => {
      if (this.db.get("runs", runId).state !== "ready_for_review")
        throw Error("State changed");
      const a = {
        id: id(),
        runId,
        reviewId,
        fingerprint: review.fingerprint,
        expires: Date.now() + 60000,
        consumed: false,
      };
      this.db.put("authorizations", a);
      return a;
    });
  }
  async submit(authId) {
    const { a, run, attempt } = this.db.tx(() => {
      const a = this.db.get("authorizations", authId);
      if (!a || a.consumed || a.expired || a.expires < Date.now())
        throw Error("Authorization expired or used");
      const run = this.db.get("runs", a.runId);
      if (run?.state !== "ready_for_review" || run.reviewId !== a.reviewId)
        throw Error("Review changed");
      this.db.put("authorizations", { ...a, consumed: true });
      transition(this.db, run, "submitting", { owner: "submit" });
      const attempt = {
        id: id(),
        runId: run.id,
        authorizationId: a.id,
        state: "intent",
        at: now(),
      };
      this.db.put("attempts", attempt);
      return { a, run, attempt };
    });
    let clicked = false;
    try {
      const cur = await this.current(run);
      if (cur.fingerprint !== a.fingerprint)
        throw Error(
          "Live state changed; consumed authorization cannot be replayed",
        );
      cur.s.owner = "submit";
      this.db.event(run.id, "before_final_action", { attemptId: attempt.id });
      clicked = true;
      await cur.s.page
        .locator("main[data-final=true] button[data-action=final]")
        .click();
      await cur.s.page.locator("[data-receipt]").waitFor({ timeout: 5000 });
      const receipt = await cur.s.page
        .locator("[data-receipt]")
        .getAttribute("data-receipt");
      if (!receipt) throw Error("No positive receipt");
      this.db.tx(() => {
        this.db.put("receipts", {
          id: id(),
          runId: run.id,
          attemptId: attempt.id,
          evidence: receipt,
          at: now(),
        });
        this.db.put("attempts", { ...attempt, state: "confirmed" });
        transition(this.db, this.db.get("runs", run.id), "submitted", {
          owner: "none",
        });
      });
      return { submitted: true, receipt };
    } catch (e) {
      this.db.tx(() => {
        this.db.put("attempts", {
          ...attempt,
          state: clicked ? "unknown" : "not_executed",
          error: e.message,
        });
        transition(this.db, this.db.get("runs", run.id), "submission_unknown", {
          owner: "none",
          error: e.message,
        });
      });
      throw e;
    } finally {
      const s = this.browsers.sessions.get(run.id);
      if (s) s.owner = "none";
    }
  }
}
