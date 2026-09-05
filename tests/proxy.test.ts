import { readFileSync } from "node:fs";
import { transformWithEsbuild } from "vite";
import { afterEach, expect, test, vi } from "vitest";
import { AI_CRAWLERS } from "../src/crawlers";

// Exercise the copy-paste integration without installing Next.js in the Worker.
const source = readFileSync(new URL("../nextjs/proxy.ts", import.meta.url), "utf8");
const { code } = await transformWithEsbuild(source, "proxy.ts", { format: "cjs", target: "es2023" });
const module: { exports: any } = { exports: {} };
new Function("require", "module", "process", code)(
  () => ({ NextResponse: { next: () => "next" } }), module,
  { env: { AI_TRACKER_URL: "https://tracker.example/", AI_TRACKER_TOKEN: "ingest" } },
);
const { proxy, config } = module.exports;
const matcher = new RegExp(`^${config.matcher[0]}$`);

afterEach(() => vi.unstubAllGlobals());

test("forwards every classified crawler without query strings or spoofable IP headers", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response());
  vi.stubGlobal("fetch", fetch);
  for (const [needle] of AI_CRAWLERS) {
    fetch.mockClear();
    const waitUntil = vi.fn();
    expect(proxy({
      method: "GET", nextUrl: new URL("https://site.example/docs?secret=1"),
      headers: new Headers({ "user-agent": needle, "x-forwarded-for": "spoofed" }),
    }, { waitUntil })).toBe("next");
    expect(fetch, needle).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      href: "https://site.example/docs", ai: { userAgent: needle, source: "next-proxy" },
    });
    await waitUntil.mock.calls[0][0];
  }
});

test("matches page names beginning with api, but not API routes or framework assets", () => {
  for (const path of ["/", "/apiary", "/api-docs", "/docs", "/robots.txt"]) expect(matcher.test(path), path).toBe(true);
  for (const path of ["/api", "/api/events", "/_next/static/app.js", "/_next/image", "/favicon.ico"]) expect(matcher.test(path), path).toBe(false);
});

test("skips static assets and human requests, but preserves crawler discovery files", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  const waitUntil = vi.fn();
  for (const path of ["/assets/app.js", "/image.png", "/api/events"]) {
    proxy({ method: "GET", nextUrl: new URL(`https://site.example${path}`), headers: new Headers({ "user-agent": "GPTBot" }) }, { waitUntil });
  }
  proxy({ method: "GET", nextUrl: new URL("https://site.example/"), headers: new Headers({ "user-agent": "Chrome" }) }, { waitUntil });
  expect(fetch).not.toHaveBeenCalled();
  for (const path of ["/robots.txt", "/llms.txt", "/sitemap.xml", "/docs.md"]) {
    proxy({ method: "HEAD", nextUrl: new URL(`https://site.example${path}`), headers: new Headers({ "user-agent": "GPTBot" }) }, { waitUntil });
  }
  expect(fetch).toHaveBeenCalledTimes(4);
  await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
});
