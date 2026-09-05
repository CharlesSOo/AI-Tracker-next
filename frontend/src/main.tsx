import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Settings, X } from 'lucide-react'
import AiCrawlersCard from './AiCrawlersCard'
import type { AiCrawlers } from './ai-types'
import './styles.css'

type Report = {
  from: string
  to: string
  interval: 'hour' | 'day'
  totals: { requests: number; uniqueCrawlers: number; pages: number }
  byPurpose: Record<string, number>
  vendors: { vendor: string; purpose: string; requests: number }[]
  series: { date: string; vendor: string; purpose: string; requests: number }[]
  pages: { path: string; requests: number }[]
}
type EventRow = {
  id: number; ts: string; host: string; path: string; vendor: string
  purpose: string; userAgent: string; ip: string | null; status: number | null; source: string
}

// Same ranges and bucket rules as the analyis dashboard: hourly up to 7d, daily beyond.
const RANGES = [
  { key: '24h', hours: 24, interval: 'hour' },
  { key: '7d', hours: 7 * 24, interval: 'hour' },
  { key: '30d', hours: 30 * 24, interval: 'day' },
  { key: '90d', hours: 90 * 24, interval: 'day' },
] as const
const LABEL: Record<string, string> = { 'ai-answers': 'AI answers', training: 'AI training', indexing: 'Search indexing' }
const ORDER = ['ai-answers', 'training', 'indexing'] as const

const dayLabel = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`
// Bucket keys match the Worker's strftime output; labels match analyis' bucketLabelOf.
const bucketKey = (ms: number, interval: 'hour' | 'day') => {
  const d = new Date(ms)
  if (interval === 'day') return d.toISOString().slice(0, 10)
  d.setUTCMinutes(0, 0, 0)
  return `${d.toISOString().slice(0, 13)}:00:00Z`
}
const bucketLabel = (key: string, interval: 'hour' | 'day', multiDay: boolean) => {
  const d = new Date(interval === 'day' ? `${key}T00:00:00Z` : key)
  if (interval === 'day') return dayLabel(d)
  return multiDay ? `${dayLabel(d)} ${key.slice(11, 16)}` : key.slice(11, 16)
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .catch((err: Error) => { throw new Error(`${url.split('?')[0]}: ${err.message}`) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${url.split('?')[0]}: ${(body as { error?: string } | null)?.error ?? res.status}`)
  return body as T
}

function toAiCrawlers(report: Report): AiCrawlers {
  const totals = ORDER.map((p) => ({ label: LABEL[p], hits: report.byPurpose[p] ?? 0 }))
  const vendors: AiCrawlers['vendors'] = {}
  for (const p of ORDER) {
    vendors[LABEL[p]] = report.vendors
      .filter((v) => v.purpose === p)
      .map((v) => ({ label: v.vendor, value: v.requests }))
  }
  const step = report.interval === 'hour' ? 3_600_000 : 86_400_000
  const keys: string[] = []
  for (let t = Date.parse(report.from); t <= Date.parse(report.to); t += step) {
    const k = bucketKey(t, report.interval)
    if (keys[keys.length - 1] !== k) keys.push(k)
  }
  const multiDay = new Set(keys.map((k) => k.slice(0, 10))).size > 1
  const labelOf = new Map(keys.map((k) => [k, bucketLabel(k, report.interval, multiDay)]))
  const byBucket = report.series.flatMap((r) => {
    const date = labelOf.get(r.date)
    return date ? [{ date, purpose: LABEL[r.purpose] ?? r.purpose, vendor: r.vendor, hits: r.requests }] : []
  })
  return { totals, vendors, dates: [...labelOf.values()], byBucket }
}


function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<'install' | 'api'>('install')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  const origin = location.origin
  return (
    <dialog ref={ref} aria-label="Install and API settings" className="settings" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-head">
        <div className="tab-group">
          <button className={`tab-pill ${tab === 'install' ? 'is-active' : ''}`} onClick={() => setTab('install')}>Install</button>
          <button className={`tab-pill ${tab === 'api' ? 'is-active' : ''}`} onClick={() => setTab('api')}>Read API</button>
        </div>
        <button className="icon-button" aria-label="Close" onClick={onClose}><X className="size-4" /></button>
      </div>
      {tab === 'install' ? (
        <div className="settings-body">
          <p>Fetch the proxy into the root of your Next.js 16 app, next to <code>app/</code>. On Next.js 15, save it as <code>middleware.ts</code> and rename the export to <code>middleware</code>.</p>
          <pre>{`curl -o proxy.ts https://raw.githubusercontent.com/CharlesSOo/AI-Tracker-next/main/nextjs/proxy.ts`}</pre>
          <p>Then set two server-side environment variables in the app and deploy it:</p>
          <pre>{`AI_TRACKER_URL=${origin}\nAI_TRACKER_TOKEN=$INGEST_TOKEN`}</pre>
          <p>The proxy reports GET/HEAD requests from bot-like user agents with one non-blocking POST. Only <code>origin + pathname</code>, the user agent, and the platform client IP are sent. Classification happens here, so new crawlers never need an app redeploy.</p>
          <p className="snippet-label">Verify from your machine</p>
          <pre>{`curl -A "GPTBot/1.2" https://your-site.example/\ncurl -s "${origin}/api/requests?limit=1" -H "Authorization: Bearer $API_TOKEN"`}</pre>
        </div>
      ) : (
        <div className="settings-body">
          <p>Bearer auth with <code>API_TOKEN</code>. Call it from your server, never from the browser.</p>
          <p className="snippet-label">Report</p>
          <pre>{`curl -s "${origin}/api/report?from=2026-01-01T00:00:00Z&to=2026-01-08T00:00:00Z&interval=day" \\\n  -H "Authorization: Bearer $API_TOKEN"`}</pre>
          <p className="snippet-label">Server-side from Next.js</p>
          <pre>{`const res = await fetch("${origin}/api/report", {\n  headers: { Authorization: \`Bearer \${process.env.API_TOKEN}\` },\n  cache: "no-store",\n})\nconst report = await res.json()`}</pre>
          <p className="snippet-label">Sync every event into your own store</p>
          <pre>{`let after = await loadCursor() // last id you stored, or 0\nfor (;;) {\n  const res = await fetch(\`${origin}/api/requests?after=\${after}&limit=200\`, {\n    headers: { Authorization: \`Bearer \${process.env.API_TOKEN}\` },\n  })\n  const { events, nextCursor } = await res.json()\n  if (!events.length) break\n  await insert(events)\n  after = nextCursor\n  await saveCursor(after)\n}`}</pre>
        </div>
      )}
    </dialog>
  )
}

function App() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1])
  const [report, setReport] = useState<Report | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    const to = new Date()
    const from = new Date(to.getTime() - range.hours * 3_600_000)
    const window = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
    let live = true
    setError('')
    getJson<Report>(`/api/report?${window}&interval=${range.interval}`)
      .then((r) => { if (live) setReport(r) })
      .catch((err: Error) => { if (live) setError(err.message) })
    getJson<{ events: EventRow[] }>(`/api/requests?${window}&limit=25`)
      .then((e) => { if (live) setEvents(e.events) })
      .catch((err: Error) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [range])

  const crawlers = useMemo(() => (report ? toAiCrawlers(report) : null), [report])
  const topShare = Math.max(1, ...(report?.pages ?? []).map((p) => p.requests))

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><span>AI</span>AI Tracker</div>
        <div className="topbar-right">
          <div className="tab-group">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r)} className={`tab-pill ${r.key === range.key ? 'is-active' : ''}`}>{r.key}</button>
            ))}
          </div>
          <button className="icon-button" aria-label="Install and API settings" onClick={() => setSettings(true)}><Settings className="size-4" /></button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="tiles">
        <div className="dashboard-card tile"><small>Requests</small><strong>{report?.totals.requests ?? '—'}</strong></div>
        <div className="dashboard-card tile"><small>Unique crawlers</small><strong>{report?.totals.uniqueCrawlers ?? '—'}</strong></div>
        <div className="dashboard-card tile"><small>Pages</small><strong>{report?.totals.pages ?? '—'}</strong></div>
      </div>

      {crawlers && <AiCrawlersCard data={crawlers} />}

      <div className="two-col">
        <section className="dashboard-card panel">
          <h2>Top pages</h2>
          {report?.pages.length ? report.pages.map((p) => (
            <div className="page-row" key={p.path}>
              <span title={p.path}>{p.path}</span>
              <strong>{p.requests}</strong>
              <i style={{ width: `${(p.requests / topShare) * 100}%` }} />
            </div>
          )) : <p className="empty">No pages crawled in this window.</p>}
        </section>
        <section className="dashboard-card panel">
          <h2>Recent requests</h2>
          {events.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Time</th><th>Vendor</th><th>Purpose</th><th>Path</th><th>Status</th><th>Source</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.ts).toLocaleString()}</td>
                      <td>{e.vendor}</td>
                      <td>{LABEL[e.purpose] ?? e.purpose}</td>
                      <td title={e.path}>{e.path}</td>
                      <td>{e.status ?? '—'}</td>
                      <td>{e.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">No requests recorded yet.</p>}
        </section>
      </div>

      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
