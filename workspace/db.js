import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
export const id = () => randomUUID(),
  now = () => new Date().toISOString();
export const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const tables = [
  "jobs",
  "captures",
  "quarantine",
  "profiles",
  "facts",
  "documents",
  "runs",
  "sessions",
  "steps",
  "answers",
  "questions",
  "reviews",
  "authorizations",
  "attempts",
  "receipts",
  "views",
];
export class Store {
  constructor(file) {
    if (file !== ":memory:")
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS process_owner(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER,token TEXT);",
    );
    this.owner = id();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare("SELECT pid FROM process_owner WHERE id=1")
        .get();
      if (old) {
        let alive = true;
        try {
          process.kill(old.pid, 0);
        } catch (e) {
          alive = e.code !== "ESRCH";
        }
        if (alive)
          throw Error(
            "This workspace database is already owned by a running process",
          );
      }
      this.db
        .prepare("INSERT OR REPLACE INTO process_owner VALUES(1,?,?)")
        .run(process.pid, this.owner);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw e;
    }
    for (const t of tables)
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${t}(id TEXT PRIMARY KEY,data TEXT NOT NULL,updated TEXT NOT NULL)`,
      );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT,kind TEXT,data TEXT,at TEXT); CREATE TABLE IF NOT EXISTS active_jobs(job_id TEXT PRIMARY KEY,run_id TEXT UNIQUE);",
    );
  }
  all(t) {
    this.check(t);
    return this.db
      .prepare(`SELECT data FROM ${t} ORDER BY updated`)
      .all()
      .map((r) => JSON.parse(r.data));
  }
  get(t, i) {
    this.check(t);
    const r = this.db.prepare(`SELECT data FROM ${t} WHERE id=?`).get(i);
    return r ? JSON.parse(r.data) : null;
  }
  put(t, o) {
    this.check(t);
    if (!o.id) throw Error("Missing ID");
    this.db
      .prepare(
        `INSERT INTO ${t} VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated`,
      )
      .run(o.id, JSON.stringify(o), now());
    return o;
  }
  del(t, i) {
    this.check(t);
    this.db.prepare(`DELETE FROM ${t} WHERE id=?`).run(i);
  }
  check(t) {
    if (!tables.includes(t)) throw Error("Invalid table");
  }
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  event(run, kind, data = {}) {
    this.db
      .prepare("INSERT INTO events(run_id,kind,data,at) VALUES(?,?,?,?)")
      .run(run, kind, JSON.stringify(data), now());
  }
  events() {
    return this.db
      .prepare("SELECT * FROM events ORDER BY seq DESC LIMIT 200")
      .all()
      .map((e) => ({ ...e, data: JSON.parse(e.data) }));
  }
  close() {
    this.db.prepare("DELETE FROM process_owner WHERE token=?").run(this.owner);
    this.db.close();
  }
}
export const terminal = new Set([
  "submitted",
  "cancelled",
  "submission_unknown",
]);
export const transitions = {
  queued: ["preparing", "paused", "cancelled", "expired"],
  preparing: [
    "needs_input",
    "ready_for_review",
    "failed",
    "paused",
    "manual_control",
    "expired",
    "cancelled",
  ],
  needs_input: ["queued", "manual_control", "paused", "cancelled", "expired"],
  paused: ["queued", "manual_control", "cancelled", "expired"],
  manual_control: ["queued", "cancelled", "expired", "submitted"],
  ready_for_review: [
    "queued",
    "manual_control",
    "submitting",
    "cancelled",
    "expired",
  ],
  submitting: ["submitted", "submission_unknown"],
  failed: ["queued", "cancelled", "expired"],
  expired: ["queued", "cancelled"],
  submitted: [],
  cancelled: [],
  submission_unknown: [],
};
export function transition(db, run, state, extra = {}) {
  if (run.state !== state && !transitions[run.state]?.includes(state))
    throw Error(`Cannot ${run.state} → ${state}`);
  const next = { ...run, ...extra, state, updated: now() };
  db.put("runs", next);
  db.event(run.id, "state", { from: run.state, to: state });
  return next;
}
