export type Pt = { x: number; y: number }

/** Catmull-Rom to cubic Bézier with segment-clamped control points. */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return ''
  const d = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const lo = Math.min(p1.y, p2.y)
    const hi = Math.max(p1.y, p2.y)
    const clamp = (y: number) => Math.min(hi, Math.max(lo, y))
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6)
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6)
    d.push(`C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`)
  }
  return d.join(' ')
}
