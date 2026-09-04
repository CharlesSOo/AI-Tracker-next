import { smoothPath } from './curve'

export type Series = { label: string; color: string; values: Map<string, number> }

function niceMax(v: number): number {
  if (v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

const fmtTick = (v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)

export default function MiniLineChart({ dates: allDates, series }: { dates: string[]; series: Series[] }) {
  const hasData = (d: string) => series.some((s) => (s.values.get(d) ?? 0) > 0)
  const firstIdx = allDates.findIndex(hasData)
  const dates = firstIdx > 0 ? allDates.slice(firstIdx - 1) : allDates
  const rawMax = Math.max(0, ...series.flatMap((s) => dates.map((d) => s.values.get(d) ?? 0)))
  const yMax = niceMax(rawMax || 1)
  const W = 640
  const H = 250
  const padL = 40
  const padR = 10
  const padT = 12
  const padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const n = dates.length
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * innerW
  const y = (v: number) => padT + innerH - (v / yMax) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f))
  const labelEvery = Math.max(1, Math.ceil(n / 7))
  const lines = series
    .filter((s) => dates.some((d) => (s.values.get(d) ?? 0) > 0))
    .map((s) => ({ label: s.label, color: s.color, d: smoothPath(dates.map((dt, i) => ({ x: x(i), y: y(s.values.get(dt) ?? 0) }))) }))

  if (n < 2 || lines.length === 0) return null
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-base-300" strokeDasharray="2 4" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="fill-base-content/40 text-[11px]">{fmtTick(t)}</text>
        </g>
      ))}
      {lines.map((l) => <path key={l.label} d={l.d} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
      {dates.map((d, i) => i % labelEvery === 0 ? <text key={`${d}-${i}`} x={x(i)} y={H - 6} textAnchor="middle" className="fill-base-content/40 text-[11px]">{d}</text> : null)}
    </svg>
  )
}
