// AI Tracker — copy this file to the root of a Next.js 16 app.
// On Next.js 15 and earlier: rename the file to `middleware.ts` and the
// exported function from `proxy` to `middleware`. Nothing else changes.
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

// Deliberately loose candidate filter. The Worker owns classification, so a new
// crawler with conventional bot hints is recorded without redeploying the app.
const BOT_HINTS =
  /bot|crawler|spider|crawl|gpt|claude|perplexity|bing|applebot|bytespider|ccbot|amazon|amzn|meta-|duckassist|mistral|google-|copilot|grok|kimi|qwen|cohere|msnbot/i;
const IGNORED_PATH_PREFIXES = ["/api", "/_next", "/_vercel", "/static", "/assets", "/public"];
const STATIC_EXTENSION =
  /\.(?:avif|bmp|br|cjs|css|csv|eot|gif|gz|ico|jpe?g|js|json|map|mjs|mov|mp3|mp4|mpeg|ogg|otf|pdf|png|svg|tar|tiff?|ttf|wasm|wav|webm|webmanifest|webp|woff2?|xml|zip)$/i;
const DISCOVERY_FILE =
  /(?:^|\/)(?:robots\.txt|llms[^/]*\.txt|sitemap[^/]*\.xml|[^/]+\.md)$|\/sitemaps?\/.*\.xml$/i;

function isIgnoredPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  if (DISCOVERY_FILE.test(path)) return false;
  return (
    STATIC_EXTENSION.test(path) ||
    IGNORED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const url = process.env.AI_TRACKER_URL;
  const token = process.env.AI_TRACKER_TOKEN;
  const userAgent = request.headers.get("user-agent") ?? "";

  if (
    url &&
    token &&
    (request.method === "GET" || request.method === "HEAD") &&
    BOT_HINTS.test(userAgent) &&
    !isIgnoredPath(request.nextUrl.pathname)
  ) {
    // `x-forwarded-for` is omitted on purpose: it is client-spoofable.
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim();

    event.waitUntil(
      fetch(`${url.replace(/\/+$/, "")}/api/ingest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          href: `${request.nextUrl.origin}${request.nextUrl.pathname}`,
          ai: { userAgent, ...(ip ? { ip } : {}), source: "next-proxy" },
        }),
        signal: AbortSignal.timeout(1500),
      }).catch(() => undefined),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
