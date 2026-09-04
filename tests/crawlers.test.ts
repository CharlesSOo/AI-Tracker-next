import { describe, expect, test } from "vitest";
import { classifyCrawler } from "../src/crawlers";
import { InputError, app, normalizeIngest } from "../src/index";

describe("classifyCrawler", () => {
  test("matches specific needles before broad ones", () => {
    expect(classifyCrawler("Mozilla/5.0 ChatGPT-User/1.0")).toEqual({ vendor: "OpenAI", purpose: "ai-answers" });
    expect(classifyCrawler("Mozilla/5.0 GPTBot/1.2")).toEqual({ vendor: "OpenAI", purpose: "training" });
    expect(classifyCrawler("Mozilla/5.0 OAI-SearchBot/1.0")).toEqual({ vendor: "OpenAI", purpose: "indexing" });
  });

  test("returns null for human traffic", () => {
    expect(classifyCrawler("Mozilla/5.0 Chrome")).toBeNull();
  });
});

describe("normalizeIngest", () => {
  const ai = { userAgent: "GPTBot/1.2" };

  test("strips query and fragment, keeps host and path", () => {
    expect(normalizeIngest({ href: "https://example.com/docs?x=1#top", ai })).toMatchObject({
      host: "example.com",
      path: "/docs",
      vendor: "OpenAI",
      purpose: "training",
      source: "unknown",
      ip: null,
      status: null,
    });
  });

  test("rejects userinfo and non-http protocols", () => {
    expect(() => normalizeIngest({ href: "https://u:p@example.com/", ai })).toThrow(InputError);
    expect(() => normalizeIngest({ href: "ftp://example.com/", ai })).toThrow(InputError);
  });

  test("truncates the user agent to 512 bytes", () => {
    const userAgent = `GPTBot ${"a".repeat(600)}`;
    const event = normalizeIngest({ href: "https://example.com/", ai: { userAgent } })!;
    expect(new TextEncoder().encode(event.userAgent).length).toBe(512);
  });

  test("rejects an invalid status code", () => {
    expect(() => normalizeIngest({ href: "https://example.com/", ai: { ...ai, statusCode: 99 } })).toThrow(InputError);
  });

  test("returns null for an unrecognised user agent", () => {
    expect(normalizeIngest({ href: "https://example.com/", ai: { userAgent: "Mozilla/5.0 Chrome" } })).toBeNull();
  });
});

const fakeDb = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({}),
      all: async () => ({ results: [] }),
    }),
  }),
  batch: async () => [
    { results: [{ requests: 0, uniqueCrawlers: 0, pages: 0 }] },
    { results: [] },
    { results: [] },
  ],
};
const env = { DB: fakeDb, INGEST_TOKEN: "ingest", API_TOKEN: "first, second" } as never;

describe("routes", () => {
  test("ingest requires the ingest token", async () => {
    const res = await app.request("/api/ingest", { method: "POST", body: "{}" }, env);
    expect(res.status).toBe(401);
  });

  test("ingest ignores human traffic", async () => {
    const res = await app.request(
      "/api/ingest",
      {
        method: "POST",
        headers: { authorization: "Bearer ingest", "content-type": "application/json" },
        body: JSON.stringify({ href: "https://example.com/", ai: { userAgent: "Mozilla/5.0 Chrome" } }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
  });

  test("report requires read auth", async () => {
    const res = await app.request("/api/report", {}, env);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="AI Tracker"');
  });

  test("report accepts Basic auth with any configured token", async () => {
    const res = await app.request(
      "/api/report",
      { headers: { authorization: `Basic ${btoa("admin:second")}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { totals: { requests: number }; byPurpose: Record<string, number> };
    expect(body.totals.requests).toBe(0);
    expect(body.byPurpose).toEqual({ "ai-answers": 0, indexing: 0, training: 0 });
  });
});
