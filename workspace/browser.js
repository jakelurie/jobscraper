import { chromium } from "playwright-core";
import { id, now, transition } from "./db.js";
export class Browsers {
  constructor(db, { headless = false, cap = 8 } = {}) {
    this.db = db;
    this.headless = headless;
    this.cap = cap;
    this.sessions = new Map();
    this.opening = 0;
  }
  async open(run, job) {
    if (this.sessions.has(run.id)) return this.sessions.get(run.id);
    if (this.sessions.size + this.opening >= this.cap)
      throw Error(
        "Browser resource cap reached. Cancel an unused retained session, then retry.",
      );
    this.opening++;
    try {
      if (!this.browser) {
        this.launching ||= chromium.launch({
          executablePath:
            process.env.CHROME_PATH ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          headless: this.headless,
          args: ["--no-first-run"],
        });
        this.browser = await this.launching;
        this.launching = null;
        this.browser.on("disconnected", () => {
          for (const runId of this.sessions.keys()) {
            const r = this.db.get("runs", runId);
            if (
              r &&
              !["submitted", "cancelled", "submission_unknown"].includes(
                r.state,
              )
            )
              transition(
                this.db,
                r,
                r.state === "submitting" ? "submission_unknown" : "expired",
                {
                  owner: "none",
                  error:
                    "Chrome disconnected; unsaved browser state is unavailable. Revalidation required.",
                },
              );
          }
          this.sessions.clear();
          this.browser = null;
        });
      }
      const context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      context.setDefaultTimeout(5000);
      const page = await context.newPage();
      const session = { id: id(), page, context, runId: run.id, owner: "auto" };
      this.sessions.set(run.id, session);
      this.db.put("sessions", {
        id: session.id,
        runId: run.id,
        owner: "auto",
        retained: true,
        heartbeat: now(),
      });
      page.on("close", () => {
        this.sessions.delete(run.id);
        const r = this.db.get("runs", run.id);
        if (
          r &&
          !["submitted", "cancelled", "submission_unknown", "expired"].includes(
            r.state,
          )
        )
          transition(
            this.db,
            r,
            r.state === "submitting" ? "submission_unknown" : "expired",
            {
              owner: "none",
              error: "Owned tab closed; explicitly retry to revalidate.",
            },
          );
      });
      // Fixture POST submit endpoints are blocked except during final executor/manual lease.
      await context.route("**/*", async (route) => {
        const req = route.request();
        if (
          job.source === "fixture" &&
          new URL(req.url()).pathname.startsWith("/receipt/") &&
          !["submit", "manual"].includes(session.owner)
        )
          return route.abort("blockedbyclient");
        return route.continue();
      });
      await page.goto(job.applicationUrl, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      return session;
    } finally {
      this.opening--;
    }
  }
  async close(runId) {
    const s = this.sessions.get(runId);
    if (s) {
      this.sessions.delete(runId);
      await s.context.close();
    }
  }
  async shutdown() {
    for (const s of this.sessions.values())
      await s.context.close().catch(() => {});
    await this.browser?.close();
  }
}
