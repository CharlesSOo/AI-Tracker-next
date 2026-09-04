import { useState } from 'react'
import { Bot, Brain, Bug, FileText, Sparkles } from 'lucide-react'
import type { AiCrawlers } from './ai-types'
import MiniLineChart, { type Series } from './MiniLineChart'

const DOCS_URL = 'https://github.com/CharlesSOo/AI-Tracker-next#readme'

const fmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)
const VENDOR_COLORS: Record<string, string> = {
  OpenAI: '#565869', Anthropic: '#d97757', Google: '#4285f4', Microsoft: '#0078d4', Meta: '#0668e1',
  Amazon: '#ff9900', ByteDance: '#325ab4', Apple: '#6e6e73', Perplexity: '#20808d', DuckDuckGo: '#de5833',
  Mistral: '#fa520f', Cohere: '#39594d', 'Common Crawl': '#64748b', xAI: '#111111', Moonshot: '#1d4ed8',
  Alibaba: '#ff6a00', Baidu: '#2932e1', DeepSeek: '#4d6bfe', Zhipu: '#2f54eb', AI2: '#f0529c', 'You.com': '#7c3aed',
}
const MAX_VENDORS = 8
const FALLBACK_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b']
const ANSWER_VENDOR: Record<string, string> = { OpenAI: 'ChatGPT', Anthropic: 'Claude', Google: 'Gemini', xAI: 'Grok', Moonshot: 'Kimi', Alibaba: 'Qwen' }
const VENDOR_ICON: Record<string, string> = {
  OpenAI: 'https://cdn.simpleicons.org/openai/5B6270',
  Anthropic: 'https://cdn.simpleicons.org/anthropic/B5664E',
  Google: 'https://cdn.simpleicons.org/googlegemini/3971CF',
  DuckDuckGo: 'https://cdn.simpleicons.org/duckduckgo/B94C31',
}
const VENDOR_TILE: Record<string, string> = {
  OpenAI: '#e7e8eb', Anthropic: '#f9e9e4', Google: '#e1ebfd', DuckDuckGo: '#fae4de',
}

type Purpose = 'answers' | 'training' | 'indexing'
const purposeOf = (label: string): Purpose => {
  const key = label.toLowerCase()
  if (key.includes('answer')) return 'answers'
  if (key.includes('train')) return 'training'
  return 'indexing'
}
const purposeLabel: Record<Purpose, string> = { answers: 'AI answers', training: 'AI training', indexing: 'Search indexing' }
const purposeOrder: Purpose[] = ['answers', 'training', 'indexing']

function PurposeIcon({ purpose }: { purpose: Purpose }) {
  if (purpose === 'answers') return <Sparkles className="size-3.5" />
  if (purpose === 'training') return <Brain className="size-3.5" />
  return <Bug className="size-3.5" />
}

export default function AiCrawlersCard({ data }: { data: AiCrawlers }) {
  const ordered = purposeOrder.flatMap((purpose) => {
    const total = data.totals.find((item) => purposeOf(item.label) === purpose)
    return total ? [{ ...total, purpose }] : []
  })
  const [active, setActive] = useState<Purpose>(ordered.find((item) => item.hits > 0)?.purpose ?? ordered[0]?.purpose ?? 'answers')
  const selected = ordered.find((item) => item.purpose === active) ?? ordered[0]
  const rows = selected ? (data.vendors[selected.label] ?? []) : []
  const max = Math.max(1, ...rows.map((r) => r.value))
  const colorOf = new Map(rows.map((r, i) => [r.label, VENDOR_COLORS[r.label] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]]))
  const dates = data.series.map((s) => s.date)
  const inTab = data.byBucket.filter((b) => selected && b.purpose === selected.label)
  const byVendor = new Map<string, Map<string, number>>()

  for (const b of inTab) {
    const m = byVendor.get(b.vendor) ?? new Map<string, number>()
    m.set(b.date, (m.get(b.date) ?? 0) + b.hits)
    byVendor.set(b.vendor, m)
  }

  const series: Series[] = rows
    .filter((r) => byVendor.has(r.label))
    .map((r) => ({ label: r.label, color: colorOf.get(r.label)!, values: byVendor.get(r.label)! }))
  if (series.length === 0 && data.series.some((point) => point.hits > 0)) {
    series.push({ label: 'Crawler requests', color: '#3b82f6', values: new Map(data.series.map((point) => [point.date, point.hits])) })
  }

  return (
    <div className="dashboard-card flex flex-col">
      <div className="flex items-center justify-between gap-2 px-2 pt-2">
        <div className="tab-group">
          {ordered.map((item) => (
            <button key={item.label} onClick={() => setActive(item.purpose)} className={`tab-pill flex items-center gap-1.5 ${item.purpose === active ? 'is-active' : ''}`}>
              <PurposeIcon purpose={item.purpose} />
              {purposeLabel[item.purpose]} <span className="opacity-60">{fmt(item.hits)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 pr-2">
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-xl border border-dashed border-base-content/15 px-2 text-xs font-medium text-base-secondary hover:bg-base-200 hover:text-base-content">
            <Bot className="size-3.5" />
            Crawlers
          </a>
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg text-base-secondary hover:bg-base-200 hover:text-base-content" aria-label="AI crawler documentation">
            <FileText className="size-4" />
          </a>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-base-secondary">No traffic for this crawler type in this window.</p>
      ) : (
        <div className="grid min-h-80 gap-4 p-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 self-center"><MiniLineChart dates={dates} series={series} /></div>
          <div className="flex h-full flex-col gap-0.5 rounded-2xl border border-base-300 p-3 shadow-sm">
            {rows.slice(0, MAX_VENDORS).map((r) => {
              const icon = active === 'answers' ? (VENDOR_ICON[r.label] ?? r.icon) : r.icon
              return (
                <div key={r.label} className="relative flex h-8 shrink-0 items-center gap-2 overflow-hidden rounded-md px-3 text-sm">
                  <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${(r.value / max) * 100}%`, background: colorOf.get(r.label), opacity: 0.15 }} />
                  <div className="relative flex min-w-0 items-center gap-2">
                    {icon && (
                      <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ backgroundColor: VENDOR_TILE[r.label] ?? 'var(--color-base-200)' }}>
                        <img src={icon} alt="" className="size-4 object-contain" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                      </span>
                    )}
                    <span className="truncate">{active === 'answers' ? (ANSWER_VENDOR[r.label] ?? r.label) : r.label}</span>
                  </div>
                  <span className="relative ml-auto shrink-0 pl-3 font-medium tabular-nums">{fmt(r.value)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
