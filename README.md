# AI Tracker

See which AI crawlers read your site: ChatGPT and Perplexity fetching pages to answer users,
GPTBot and ClaudeBot collecting training data, Googlebot and Bingbot indexing. One Cloudflare
Worker in your own account, one file in your Next.js app, no SDK, no npm package.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CharlesSOo/AI-Tracker-next)

- **Dashboard** with the requests chart per vendor, split into AI answers / AI training /
  Search indexing, plus top pages and recent requests.
- **JSON read API** so you can pull the same numbers into your own dashboard or database.
- **Minimal request data.** Path, user agent, vendor, purpose, optional IP. Never query
  strings, cookies, bodies, or other headers. Paths and IP addresses may still be sensitive.

Modelled on [datafa.st bot traffic tracking](https://datafa.st/docs/bot-traffic-tracking).
The ingest payload is compatible with theirs, so their Express, Hono and Cloudflare snippets
work against this Worker too.

## Install

You need a [Cloudflare account](https://dash.cloudflare.com/sign-up/workers-and-pages)
(free plan is enough) and, for the CLI path, Node.js 22.12+.

### 1. Deploy the Worker

**Option A: one click.** Press the Deploy to Cloudflare button above. Cloudflare forks this
repo into your GitHub account, creates the D1 database, asks for the two secrets, builds, and
deploys. Every push to your fork redeploys.

**Option B: CLI.**

```sh
git clone https://github.com/CharlesSOo/AI-Tracker-next.git
cd AI-Tracker-next
npm install
npx wrangler login
npx wrangler d1 create ai-tracker            # copy the database_id it prints into wrangler.jsonc
npx wrangler secret put INGEST_TOKEN         # paste a value from: openssl rand -hex 32
npx wrangler secret put API_TOKEN            # a second, different value
npm run deploy
```

The Worker creates its table on first use; there is no migration step. `npm run deploy`
prints the Worker URL, `https://ai-tracker.<your-subdomain>.workers.dev`.

### 2. Open the dashboard

Visit the Worker URL. The browser asks for a username and password: type anything for the
username and `API_TOKEN` as the password. It is empty until the first crawler arrives.

### 3. Add the proxy to your Next.js app

The integration is a single file with a default export supported by both Next.js 15 and 16.
Place it next to `app/` or `pages/` (inside `src/` if that is where your router lives).
Run the matching command from that directory:

**Next.js 16 — `proxy.ts`:**

```sh
curl -fLo proxy.ts https://raw.githubusercontent.com/CharlesSOo/AI-Tracker-next/main/nextjs-integration/proxy.ts
```

**Next.js 15 — `middleware.ts`:**

```sh
curl -fLo middleware.ts https://raw.githubusercontent.com/CharlesSOo/AI-Tracker-next/main/nextjs-integration/proxy.ts
```

Only the filename differs; do not rename the function or install both files. If your app
already has middleware/proxy logic, merge the tracking logic into it instead of overwriting it.

Set two server-side environment variables in the app (Vercel project settings, `.env.local`,
or wherever the app reads its env):

```env
AI_TRACKER_URL=https://ai-tracker.<your-subdomain>.workers.dev
AI_TRACKER_TOKEN=<the INGEST_TOKEN you set on the Worker>
```

Deploy the app. The proxy needs no dependencies beyond `next/server`; if either variable is
missing it does nothing.

### 4. Verify

Pretend to be a crawler and hit your site, then check the Worker:

```sh
curl -A "Mozilla/5.0 (compatible; GPTBot/1.2)" https://your-site.example/
curl -s "https://ai-tracker.<your-subdomain>.workers.dev/api/requests?limit=1" \
  -H "Authorization: Bearer $API_TOKEN"
```

The second call returns the request you just made. The dashboard shows it under AI training.
The same two snippets, with your Worker URL filled in, live behind the gear icon on the
dashboard.

## How the proxy behaves

On `GET`/`HEAD` requests whose user agent matches a loose bot-hint regex, and whose path is
not a static asset (crawler discovery files `robots.txt`, `llms*.txt`, `sitemap*.xml` and
`*.md` are kept), it fires one non-blocking POST via `event.waitUntil` with a 1.5s timeout.
It is never awaited and failures are swallowed, so it cannot slow down or break a page.
Classification happens in the Worker, so a new crawler never needs an app redeploy.

What is sent:

```json
{ "href": "https://your-site.example/docs",
  "ai": { "userAgent": "GPTBot/1.2", "ip": "203.0.113.10", "source": "next-proxy" } }
```

`href` is `origin + pathname` only. `ip` comes from `cf-connecting-ip`, else the first value
of `x-vercel-forwarded-for`, and is omitted otherwise; generic `x-forwarded-for` is ignored
because it is client-spoofable.

## Secrets and access

| Secret | Used by | Purpose |
| --- | --- | --- |
| `INGEST_TOKEN` | the proxy | Bearer token for `POST /api/ingest`. Can only write. |
| `API_TOKEN` | you | Bearer token for the read API, and the dashboard password. |

The two secrets are the whole key management. `API_TOKEN` may hold a comma-separated list:
to issue a second key or rotate with overlap, set `old,new`, move consumers, then set `new`.
Rotate either with `npx wrangler secret put <NAME>`; no redeploy needed. Cloudflare Access
can be layered on the hostname later without code changes.

## API

Range parameters: `from`/`to` are ISO 8601, the interval is half-open `[from, to)`, the
default is the last 7 days, and the maximum span is 90 days.

### `POST /api/ingest`

`Authorization: Bearer <INGEST_TOKEN>`.

```json
{ "href": "https://example.com/docs", "ai": { "userAgent": "GPTBot/1.2", "ip": "203.0.113.10", "source": "next-proxy" } }
```

- `201 {"accepted":true}` classified and stored.
- `200 {"ignored":true}` user agent is not a known AI crawler. Normal, not an error.
- `400 {"error":"…"}` malformed `href` or body.
- `401` bad or missing token.

### `GET /api/report?from=&to=&interval=day`

`Authorization: Bearer <API_TOKEN>`. `interval` is `day` (default) or `hour`; `series.date`
is the bucket start, `YYYY-MM-DD` for day and `YYYY-MM-DDTHH:00:00Z` for hour.

```json
{ "from":"…","to":"…","interval":"day",
  "totals": { "requests":0,"uniqueCrawlers":0,"pages":0 },
  "byPurpose": { "ai-answers":0,"indexing":0,"training":0 },
  "vendors": [ { "vendor":"OpenAI","purpose":"training","requests":0 } ],
  "series":  [ { "date":"2026-09-01","vendor":"OpenAI","purpose":"training","requests":0 } ],
  "pages":   [ { "path":"/docs","requests":0 } ] }
```

Buckets with no traffic are absent from `series`; fill them client-side from the range.

### `GET /api/requests?from=&to=&limit=50&before=<id>|after=<id>`

`Authorization: Bearer <API_TOKEN>`. Integer keyset cursor, `limit` ≤ 200. `before` pages
newest-first (what the dashboard table uses); `after` pages oldest-first, which is how you
sync into your own store. `from`/`to` are optional here: omit them to walk the whole table
by id.

```json
{ "events": [ { "id":1042,"ts":"2026-09-04T11:20:54.855Z","host":"example.com","path":"/docs",
                "vendor":"OpenAI","purpose":"training","userAgent":"GPTBot/1.2",
                "ip":"203.0.113.10","status":null,"source":"next-proxy" } ],
  "nextCursor": 1042 }
```

Sync loop, store the last id you saw and resume from it:

```ts
let after = await loadLastId();                       // 0 on first run
for (;;) {
  const { events, nextCursor } = await fetch(`${base}/api/requests?limit=200&after=${after}`,
    { headers: { Authorization: `Bearer ${process.env.API_TOKEN}` } }).then((r) => r.json());
  if (!events.length) break;
  await saveRows(events); after = nextCursor; await saveLastId(after);
}
```

## What is recorded

| field | notes |
| --- | --- |
| `ts` | received at the Worker |
| `host`, `path` | from `href`; query strings and fragments are never stored |
| `vendor` | e.g. `OpenAI`, `Anthropic`, `Perplexity` |
| `purpose` | `ai-answers`, `indexing`, or `training` |
| `user_agent` | bounded to 512 bytes |
| `ip`, `status` | optional |
| `source` | e.g. `next-proxy` |

The crawler table is [`src/crawlers.ts`](src/crawlers.ts). Adding a crawler is one row.

## Repository map

Every tracked file is listed below. The Worker serves the built React dashboard;
`nextjs-integration/proxy.ts` is copied into the site you want to track, not deployed with the Worker.

```text
AI-Tracker-next/
├── .dev.vars.example           # Local secret template: INGEST_TOKEN and API_TOKEN.
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions: install, test, typecheck, build and Worker deploy dry-run.
├── .gitignore                  # Keeps secrets, dependencies, build output and local Wrangler state out of Git.
├── frontend/
│   ├── index.html              # Dashboard HTML shell, metadata, font loading and React entry script.
│   └── src/
│       ├── AiCrawlersCard.tsx   # Purpose tabs, vendor rankings, icons and per-vendor chart data.
│       ├── MiniLineChart.tsx    # SVG line chart: scales, distinct axis ticks, date labels and accessible name.
│       ├── ai-types.ts         # TypeScript shape for crawler totals, vendors, dates and bucket data.
│       ├── curve.ts            # Converts chart points to smooth cubic Bézier paths with clamped controls.
│       ├── main.tsx            # React entry, API fetching, time ranges, report mapping, tables and settings dialog.
│       └── styles.css          # Tailwind/DaisyUI setup, themes and responsive dashboard/dialog styles.
├── nextjs-integration/
│   └── proxy.ts                # Next.js 15/16 integration: save as middleware.ts/proxy.ts; sends non-blocking ingest POSTs.
├── src/
│   ├── crawlers.ts             # Ordered user-agent rules mapping crawlers to vendors and purposes.
│   └── index.ts                # Hono API, token auth, input validation, D1 schema/queries, assets and retention cron.
├── tests/
│   ├── chart.test.ts           # Server-rendered chart checks: distinct ticks, accessible name and vendor rendering.
│   ├── crawlers.test.ts        # Classification, ingest normalization, auth, cursor validation and schema checks.
│   └── proxy.test.ts           # Proxy coverage, route matching, privacy, asset filtering and swallowed fetch failures.
├── LICENSE                     # MIT license terms.
├── package-lock.json           # Locks the npm dependency tree for reproducible installs.
├── package.json                # Node requirement, dependencies, npm scripts and Cloudflare secret descriptions.
├── README.md                   # Installation, integration, API reference, repository map and operational notes.
├── tsconfig.json               # Strict TypeScript configuration for the Worker, dashboard, tests and build configs.
├── vite.config.ts              # Builds frontend/ into public/ with React and Tailwind plugins.
├── vitest.config.ts            # Discovers and runs tests/**/*.test.ts.
└── wrangler.jsonc              # Worker entry, D1/assets bindings, compatibility date, retention setting and daily cron.
```

Generated or local-only paths are not part of the tracked source tree:

- `public/`: dashboard HTML and hashed JS/CSS generated by `npm run build`; served through
  the Worker's `ASSETS` binding. Edit `frontend/`, not these generated files.
- `node_modules/`: installed npm dependencies.
- `.wrangler/`: Wrangler's local state, including local D1 data and temporary build files.
- `.dev.vars`: your local secrets, copied from `.dev.vars.example`; never commit it.
- `wrangler.local.jsonc`: optional local Wrangler configuration; ignored by Git and used
  only when explicitly selected with `--config`.

## Local development

```sh
cp .dev.vars.example .dev.vars   # fill in INGEST_TOKEN and API_TOKEN
npm run dev                      # builds the dashboard, then wrangler dev on :8787
```

```sh
curl -s -X POST localhost:8787/api/ingest \
  -H "Authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' \
  -d '{"href":"https://example.com/docs?x=1","ai":{"userAgent":"Mozilla/5.0 GPTBot/1.2","source":"curl"}}'

curl -s localhost:8787/api/report -H "Authorization: Bearer $API_TOKEN"
```

`npm test`, `npm run typecheck`, and `npm run build` are the checks CI runs.

## Gotchas

- **Cloudflare's AI-bot blocking runs before your origin.** If the tracked site's domain is
  proxied through Cloudflare with AI-bot blocking or managed `robots.txt` enabled
  (Security → Bots), crawlers are blocked at the edge, never reach Next.js, and are never
  recorded. Blocking and measuring are mutually exclusive per zone.
- **Content blockers.** EasyPrivacy carries `||workers.dev/api/event`, which is why the raw
  rows endpoint is `/api/requests` and not `/api/events`. If you rename endpoints, keep the
  paths off filter lists; the symptom is a dashboard that renders with "Failed to fetch".
- **Retention.** A daily cron deletes events older than `EVENT_RETENTION_DAYS` (default 365).
  Change it in `wrangler.jsonc`; there is no archive.

MIT licensed. See [LICENSE](LICENSE).
