import http from "node:http";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Store, id, now, hash } from "./db.js";
import { importCorpus, postingFromHtml } from "./importer.js";
import { Browsers } from "./browser.js";
import { Scheduler } from "./scheduler.js";
import { SubmissionGate } from "./submission.js";
import { fixtureNames, fixturePage } from "./fixtures.js";
import { capabilities } from "./adapters.js";
import { extractDocument } from "./documents.js";
export const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export async function createWorkspace({
  directory = path.join(root, "workspace/.local"),
  port = 4320,
  headless = false,
  importReferences = true,
  perOrigin = 1,
} = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(path.join(directory, "artifacts"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(directory, "documents"), {
    recursive: true,
    mode: 0o700,
  });
  const db = new Store(path.join(directory, "workspace.sqlite"));
  if (importReferences) await importCorpus(db, root);
  const fixtureServer = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      if (req.method === "GET" && u.pathname.startsWith("/employer/")) {
        const name = u.pathname.split("/").at(-1);
        if (!fixtureNames.includes(name)) throw Error("Unknown fixture");
        res.setHeader("Content-Type", "text/html");
        return res.end(fixturePage(name));
      }
      if (req.method === "POST" && u.pathname.startsWith("/receipt/")) {
        let total = 0;
        for await (const c of req) {
          total += c.length;
          if (total > 100000) throw Error("Too large");
        }
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ id: "fixture-" + id() }));
      }
      res.writeHead(404);
      res.end();
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
  await new Promise((r) => fixtureServer.listen(0, "127.0.0.1", r));
  const fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
  // Keep stable job IDs even though fixture server may get a new port.
  for (const name of fixtureNames)
    db.put("jobs", {
      ...(db.get("jobs", "fixture-" + name) || {}),
      id: "fixture-" + name,
      title: "Senior Software Engineer",
      company: "Fixture " + name,
      externalId: name,
      source: "fixture",
      status: "fixture",
      discipline: "software",
      canonicalUrl: fixtureOrigin + "/employer/" + name,
      applicationUrl: fixtureOrigin + "/employer/" + name,
      sourceUrl: fixtureOrigin + "/employer/" + name,
      locations: ["US (fictional employer)"],
      geography: "verified",
      seniority: "senior",
      platform: name,
      salary: {
        min: 140000,
        max: 200000,
        currency: "USD",
        period: "year",
        kind: "base",
        source: "Controlled fixture; fictional pay",
      },
      notes: "",
      tags: [],
      favorite: false,
    });
  const browsers = new Browsers(db, { headless });
  const scheduler = new Scheduler(db, browsers, {
    fixtureOrigin,
    artifacts: path.join(directory, "artifacts"),
    perOrigin,
  });
  scheduler.recover();
  const gate = new SubmissionGate(db, browsers, scheduler.adapter);
  const secret = randomBytes(32).toString("hex");
  const streams = new Set();
  const snapshot = () => ({
    jobs: db.all("jobs"),
    captures: db.all("captures"),
    quarantine: db.all("quarantine"),
    facts: db.all("facts"),
    profiles: db.all("profiles"),
    documents: db.all("documents").map(({ path, ...d }) => d),
    runs: db.all("runs"),
    questions: db.all("questions"),
    reviews: db.all("reviews").map(({ screenshot, ...r }) => r),
    views: db.all("views"),
    events: db.events(),
    capabilities,
    concurrency: scheduler.concurrency,
    retainedSessions: browsers.sessions.size,
    sessionCap: browsers.cap,
    realSubmissionEnabled: false,
  });
  const publish = () => {
    for (const res of streams) res.write("data: update\n\n");
  };
  const timer = setInterval(publish, 1500);
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (n, v) => {
      res.writeHead(n, { "Content-Type": "application/json" });
      res.end(JSON.stringify(v));
    };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return send(403, { error: "Local same-origin access required" });
      const url = new URL(req.url, origin);
      const staticFiles = {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
      };
      if (req.method === "GET" && staticFiles[url.pathname]) {
        const file = staticFiles[url.pathname];
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
        return res.end(
          await readFile(path.join(root, "workspace/public", file)),
        );
      }
      if (req.method === "GET" && url.pathname === "/api/session") {
        res.setHeader(
          "Set-Cookie",
          `workspace=${secret}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return send(200, { token: secret });
      }
      const cookie =
        String(req.headers.cookie || "")
          .split("; ")
          .find((x) => x.startsWith("workspace="))
          ?.slice(10) || "";
      const provided = String(req.headers["x-workspace-token"] || "");
      const valid = (x) =>
        x.length === secret.length &&
        timingSafeEqual(Buffer.from(x), Buffer.from(secret));
      if (!valid(cookie) && !valid(provided))
        return send(401, {
          error: "Open workspace to establish a local session",
        });
      if (req.method === "GET" && url.pathname === "/api/state")
        return send(200, snapshot());
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
        });
        res.write("data: connected\n\n");
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/preview") {
        const s = browsers.sessions.get(url.searchParams.get("run"));
        if (!s) throw Error("Session no longer retained");
        const image = await s.page.screenshot();
        res.setHeader("Content-Type", "image/png");
        return res.end(image);
      }
      if (req.method !== "POST") return send(404, { error: "Not found" });
      if (!valid(provided)) return send(403, { error: "Write token required" });
      if (url.pathname === "/api/upload") {
        const filename = decodeURIComponent(
          String(req.headers["x-file-name"] || ""),
        );
        if (
          !filename ||
          filename.length > 200 ||
          /[\/\\\x00-\x1f]/.test(filename) ||
          !/\.(pdf|txt|docx)$/i.test(filename)
        )
          throw Error("Choose PDF, TXT or DOCX, max 10 MB");
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 10 * 1024 * 1024) throw Error("Maximum 10 MB");
          chunks.push(chunk);
        }
        if (!bytes) throw Error("Empty document");
        const buffer = Buffer.concat(chunks);
        if (
          /\.pdf$/i.test(filename) &&
          !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
        )
          throw Error("Invalid PDF");
        if (
          /\.docx$/i.test(filename) &&
          buffer.subarray(0, 2).toString() !== "PK"
        )
          throw Error("Invalid DOCX");
        const document = {
          id: id(),
          name: filename,
          kind: req.headers["x-document-kind"] === "cover" ? "cover" : "resume",
          size: bytes,
          sha: hash(buffer.toString("base64")),
          created: now(),
          version: db.all("documents").length + 1,
        };
        document.path = path.join(
          directory,
          "documents",
          document.id + path.extname(filename),
        );
        await writeFile(document.path, buffer, { mode: 0o600, flag: "wx" });
        db.put("documents", document);
        return send(200, {
          ...document,
          path: undefined,
          extractedText: /\.txt$/i.test(filename)
            ? buffer.toString("utf8")
            : null,
          note: "No facts applied automatically. Review supplied text and enter confirmed facts.",
        });
      }
      if (req.headers["content-type"] !== "application/json")
        return send(415, { error: "JSON required" });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1000000) throw Error("Request too large");
      }
      const b = JSON.parse(body || "{}");
      let result = { ok: true };
      switch (url.pathname) {
        case "/api/extract-document": {
          const d = db.get("documents", b.id);
          if (!d) throw Error("Unknown document");
          result = await extractDocument(d);
          break;
        }
        case "/api/import":
          result = await importCorpus(db, root);
          break;
        case "/api/enrich": {
          const u = new URL(b.url);
          if (u.protocol !== "https:")
            throw Error("Live imports require HTTPS");
          const response = await fetch(u, {
            signal: AbortSignal.timeout(15000),
            redirect: "follow",
          });
          if (!response.ok)
            throw Error("Posting unavailable: HTTP " + response.status);
          const html = await response.text();
          if (html.length > 8000000) throw Error("Posting too large");
          const j = postingFromHtml(html, response.url);
          const previous = db.get("jobs", j.id);
          result = db.put("jobs", {
            ...j,
            notes: previous?.notes || "",
            tags: previous?.tags || [],
            favorite: previous?.favorite || false,
          });
          break;
        }
        case "/api/job": {
          const j = db.get("jobs", b.id);
          if (!j) throw Error("Unknown job");
          result = db.put("jobs", {
            ...j,
            notes: String(b.notes ?? j.notes).slice(0, 10000),
            tags: Array.isArray(b.tags)
              ? b.tags.map(String).slice(0, 20)
              : j.tags,
            favorite: b.favorite ?? j.favorite,
          });
          break;
        }
        case "/api/profile": {
          result = db.tx(() => {
            const existing = db.get("profiles", "candidate");
            const p = {
              id: "candidate",
              version: (existing?.version || 0) + 1,
              data: b.data,
              confirmedAt: now(),
            };
            db.put("profiles", p);
            for (const [key, value] of Object.entries(b.data || {}))
              db.put("facts", {
                id: id(),
                profileId: p.id,
                key,
                value,
                version: p.version,
                scope: "candidate factual profile",
                provenance: "user",
                confirmedAt: now(),
              });
            return p;
          });
          break;
        }
        case "/api/view":
          result = db.put("views", {
            id: b.id || id(),
            name: String(b.name).slice(0, 100),
            filters: b.filters,
          });
          break;
        case "/api/batch":
          if (
            b.confirmed !== true ||
            !Array.isArray(b.ids) ||
            !b.ids.length ||
            b.ids.length > 50
          )
            throw Error("Confirm the exact selected jobs (1–50)");
          result = scheduler.create([...new Set(b.ids)]);
          break;
        case "/api/concurrency":
          if (!Number.isInteger(b.value) || b.value < 1 || b.value > 5)
            throw Error("Concurrency must be 1–5");
          scheduler.concurrency = b.value;
          break;
        case "/api/control":
          if (
            !["pause", "resume", "retry", "cancel", "takeover"].includes(
              b.action,
            )
          )
            throw Error("Unknown action");
          await scheduler.control(b.id, b.action);
          break;
        case "/api/answer":
          result = scheduler.answer(b.id, b.value, {
            skip: b.skip === true,
            reuse: b.reuse === true,
          });
          break;
        case "/api/defer": {
          const q = db.get("questions", b.id);
          if (!q || q.state !== "open") throw Error("Task not open");
          db.put("questions", { ...q, state: "deferred" });
          break;
        }
        case "/api/authorize":
          if (b.confirmed !== true)
            throw Error("Individual confirmation required");
          result = await gate.authorize(b.runId, b.reviewId);
          break;
        case "/api/submit":
          result = await gate.submit(b.authorizationId);
          break;
        case "/api/delete-run": {
          const run = db.get("runs", b.id);
          if (!run) throw Error("Unknown run");
          if (run.state === "submitting")
            throw Error("Reconcile submission first");
          if (
            ![
              "cancelled",
              "submitted",
              "expired",
              "submission_unknown",
            ].includes(run.state)
          )
            await scheduler.control(run.id, "cancel");
          await browsers.close(run.id);
          const images = db
            .all("reviews")
            .filter((r) => r.runId === run.id)
            .map((r) => r.screenshot);
          db.tx(() => {
            for (const t of [
              "sessions",
              "steps",
              "answers",
              "questions",
              "reviews",
              "authorizations",
              "attempts",
              "receipts",
            ])
              for (const row of db.all(t))
                if (row.runId === run.id) db.del(t, row.id);
            db.del("runs", run.id);
            db.db.prepare("DELETE FROM active_jobs WHERE run_id=?").run(run.id);
            db.event(run.id, "private_run_data_deleted", {});
          });
          for (const image of images) await unlink(image).catch(() => {});
          break;
        }
        case "/api/delete-profile":
          db.tx(() => {
            for (const row of db.all("facts")) db.del("facts", row.id);
            for (const row of db.all("profiles")) db.del("profiles", row.id);
          });
          break;
        case "/api/delete-document": {
          const d = db.get("documents", b.id);
          if (!d) throw Error("Unknown document");
          if (db.all("answers").some((a) => a.value === d.id))
            throw Error(
              "Document is referenced by a run; delete the run first",
            );
          await unlink(d.path);
          db.del("documents", d.id);
          break;
        }
        default:
          return send(404, { error: "Unknown endpoint" });
      }
      publish();
      send(200, result);
    } catch (e) {
      send(400, { error: e.message });
    }
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  scheduler.start();
  return {
    db,
    server,
    fixtureServer,
    scheduler,
    browsers,
    gate,
    snapshot,
    token: secret,
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      clearInterval(timer);
      for (const s of streams) s.end();
      await scheduler.shutdown();
      await new Promise((r) => server.close(r));
      await new Promise((r) => fixtureServer.close(r));
      db.close();
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createWorkspace({
    port: Number(process.env.PORT || 4320),
    headless: process.env.WORKSPACE_HEADLESS === "1",
  });
  console.log("Application workspace: " + app.url);
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
