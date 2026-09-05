import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { timingSafeEqual } from "hono/utils/buffer";
import { classifyCrawler, type AiCrawlerPurpose } from "./crawlers";

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  INGEST_TOKEN: string;
  API_TOKEN: string;
  EVENT_RETENTION_DAYS?: string;
};

export class InputError extends Error {
  readonly status = 400;
}

export type IngestEvent = {
  host: string;
  path: string;
  vendor: string;
  purpose: AiCrawlerPurpose;
  userAgent: string;
  ip: string | null;
  status: number | null;
  source: string;
};

const encoder = new TextEncoder();

function truncateUtf8(value: string, bytes: number): string {
  const encoded = encoder.encode(value);
  if (encoded.length <= bytes) return value;
  let end = bytes;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.slice(0, end));
}

export function normalizeIngest(body: unknown): IngestEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("JSON object required");
  const { href, ai } = body as { href?: unknown; ai?: unknown };
  if (typeof href !== "string" || !href.trim()) throw new InputError("href is required");
  if (!ai || typeof ai !== "object") throw new InputError("ai is required");
  const { userAgent, ip, statusCode, source } = ai as Record<string, unknown>;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new InputError("href is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new InputError("href must use http or https");
  if (url.username || url.password) throw new InputError("href must not include userinfo");

  if (typeof userAgent !== "string" || !userAgent.trim()) throw new InputError("ai.userAgent is required");
  const crawler = classifyCrawler(userAgent);
  if (!crawler) return null;

  const normalizedSource = source == null ? "unknown" : String(source).toLowerCase();
  if (encoder.encode(normalizedSource).length > 64 || !/^[a-z0-9][a-z0-9._-]*$/.test(normalizedSource)) {
    throw new InputError("ai.source is invalid");
  }
  if (statusCode != null && (!Number.isInteger(statusCode) || (statusCode as number) < 100 || (statusCode as number) > 599)) {
    throw new InputError("ai.statusCode must be an HTTP status from 100 to 599");
  }

  return {
    host: url.hostname.toLowerCase(),
    path: url.pathname || "/",
    ...crawler,
    userAgent: truncateUtf8(userAgent, 512),
    ip: typeof ip === "string" && ip.length <= 45 ? ip : null,
    status: (statusCode as number | undefined) ?? null,
    source: normalizedSource,
  };
}

function parseRange(c: { req: { query: (k: string) => string | undefined } }): { from: number; to: number } | null {
  const rawTo = c.req.query("to");
  if (!rawTo && !c.req.query("from")) return null;
  const to = rawTo ? Date.parse(rawTo) : Date.now();
  if (!Number.isFinite(to)) throw new InputError("to must be an ISO 8601 timestamp");
  const rawFrom = c.req.query("from");
  const from = rawFrom ? Date.parse(rawFrom) : to - 7 * 86_400_000;
  if (!Number.isFinite(from)) throw new InputError("from must be an ISO 8601 timestamp");
  if (from >= to) throw new InputError("from must be before to");
  if (to - from > 90 * 86_400_000) throw new InputError("range must not exceed 90 days");
  return { from, to };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL,
    vendor TEXT NOT NULL,
    purpose TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    ip TEXT,
    status INTEGER,
    source TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS events_ts ON events(ts)",
];
let schemaReady: Promise<unknown> | undefined;
function ensureSchema(db: D1Database): Promise<unknown> {
  schemaReady ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  return schemaReady;
}

const app = new Hono<{ Bindings: Bindings }>();

app.post(
  "/api/ingest",
  bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: "body too large" }, 413) }),
  (c, next) => bearerAuth<{ Bindings: Bindings }>({ token: c.env.INGEST_TOKEN })(c, next),
  async (c) => {
    const event = normalizeIngest(await c.req.json().catch(() => { throw new InputError("invalid JSON body"); }));
    if (!event) return c.json({ ignored: true });
    await ensureSchema(c.env.DB);
    await c.env.DB.prepare(
      "INSERT INTO events (ts, host, path, vendor, purpose, user_agent, ip, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(Date.now(), event.host, event.path, event.vendor, event.purpose, event.userAgent, event.ip, event.status, event.source).run();
    return c.json({ accepted: true }, 201);
  },
);

app.use("*", async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const [scheme = "", value] = header.split(" ");
  let candidate = "";
  if (scheme.toLowerCase() === "bearer" && value) candidate = value;
  else if (scheme.toLowerCase() === "basic" && value) {
    try {
      candidate = atob(value).split(":").slice(1).join(":");
    } catch {}
  }
  const tokens = (c.env.API_TOKEN ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  let ok = false;
  for (const token of tokens) if (await timingSafeEqual(token, candidate)) ok = true;
  if (!ok) {
    return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Basic realm="AI Tracker"' });
  }
  await next();
});

app.get("/api/report", async (c) => {
  const { from, to } = parseRange(c) ?? { from: Date.now() - 7 * 86_400_000, to: Date.now() };
  const interval = c.req.query("interval") ?? "day";
  if (interval !== "hour" && interval !== "day") throw new InputError("interval must be hour or day");
  const bucket = interval === "hour" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%d";
  const window = [from, to];
  await ensureSchema(c.env.DB);
  const [totals, series, pages] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS requests, COUNT(DISTINCT user_agent || '|' || COALESCE(ip, '')) AS uniqueCrawlers, COUNT(DISTINCT path) AS pages FROM events WHERE ts >= ? AND ts < ?",
    ).bind(...window),
    c.env.DB.prepare(
      `SELECT strftime('${bucket}', ts / 1000, 'unixepoch') AS date, vendor, purpose, COUNT(*) AS requests FROM events WHERE ts >= ? AND ts < ? GROUP BY date, vendor, purpose ORDER BY date ASC`,
    ).bind(...window),
    c.env.DB.prepare(
      "SELECT path, COUNT(*) AS requests FROM events WHERE ts >= ? AND ts < ? GROUP BY path ORDER BY requests DESC LIMIT 10",
    ).bind(...window),
  ]);

  const seriesRows = (series.results ?? []) as { date: string; vendor: string; purpose: AiCrawlerPurpose; requests: number }[];
  const byPurpose = { "ai-answers": 0, indexing: 0, training: 0 } as Record<AiCrawlerPurpose, number>;
  const vendorTotals = new Map<string, { vendor: string; purpose: AiCrawlerPurpose; requests: number }>();
  for (const row of seriesRows) {
    byPurpose[row.purpose] += row.requests;
    const key = `${row.vendor}|${row.purpose}`;
    const entry = vendorTotals.get(key);
    if (entry) entry.requests += row.requests;
    else vendorTotals.set(key, { vendor: row.vendor, purpose: row.purpose, requests: row.requests });
  }

  return c.json({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    interval,
    totals: totals.results?.[0] ?? { requests: 0, uniqueCrawlers: 0, pages: 0 },
    byPurpose,
    vendors: [...vendorTotals.values()].sort((a, b) => b.requests - a.requests),
    series: seriesRows,
    pages: pages.results ?? [],
  });
});

app.get("/api/requests", async (c) => {
  const range = parseRange(c);
  const limit = Number(c.req.query("limit") ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new InputError("limit must be between 1 and 200");
  const before = c.req.query("before");
  const after = c.req.query("after");
  if (before !== undefined && after !== undefined) throw new InputError("before and after are mutually exclusive");

  const cursor = before ?? after;
  if (cursor !== undefined && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) {
    throw new InputError("cursor must be a safe integer event id");
  }
  const clauses: string[] = [];
  const params: number[] = [];
  if (range) clauses.push("ts >= ? AND ts < ?"), params.push(range.from, range.to);
  if (cursor !== undefined) clauses.push(after ? "id > ?" : "id < ?"), params.push(Number(cursor));
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  await ensureSchema(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT id, ts, host, path, vendor, purpose, user_agent AS userAgent, ip, status, source FROM events${where} ORDER BY id ${after ? "ASC" : "DESC"} LIMIT ?`,
  ).bind(...params, limit).all<{ id: number; ts: number }>();

  const events = (results ?? []).map((row) => ({ ...row, ts: new Date(row.ts).toISOString() }));
  return c.json({ events, nextCursor: events.length ? events[events.length - 1]!.id : null });
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  if (err instanceof InputError) return c.json({ error: err.message }, err.status);
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_event, env) => {
  const days = Number(env.EVENT_RETENTION_DAYS);
  const retention = Number.isInteger(days) && days > 0 ? days : 365;
  await ensureSchema(env.DB);
  await env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(Date.now() - retention * 86_400_000).run();
};

export default { fetch: app.fetch, scheduled };
export { app };
