import type { TrackStats } from '@/context/TrackContext'

// ─────────────────────────────────────────────────────────────────────────────
// SentimentCard — track health / circuit confidence derived from GitHub stats.
// When `stats` is null (pre-load) it shows placeholder dashes.
// ─────────────────────────────────────────────────────────────────────────────
export default function SentimentCard({ stats }: { stats: TrackStats | null }) {
  // "Health score" = smoothness (closed-issue ratio).
  // 0.75 default is used when no issue data exists (backend sends this).
  const healthPct  = stats ? Math.round(stats.smoothness * 100) : 0
  const complexity = stats ? Math.round(stats.complexity * 100) : 0

  // Drivability — inverse of complexity (simple tracks are easier)
  const drivability = stats ? Math.round((1 - stats.complexity) * 100) : 0

  // Stars normalised to 0–100 (log scale, saturates at 10 000 stars)
  const starScore = stats
    ? Math.min(100, Math.round((Math.log(stats.total_stars + 1) / Math.log(10001)) * 100))
    : 0

  // Commit velocity normalised (saturates at 500 commits)
  const commitScore = stats
    ? Math.min(100, Math.round((Math.log(stats.total_commits + 1) / Math.log(501)) * 100))
    : 0

  const bars = [
    { label: 'SMOOTHNESS',  pct: healthPct,   color: healthPct  > 60 ? '#a3e635' : healthPct > 30 ? '#f5c518' : '#ef4444' },
    { label: 'COMPLEXITY',  pct: complexity,  color: '#a3e635' },
    { label: 'STAR_POWER',  pct: starScore,   color: '#f5c518' },
    { label: 'DRIVABILITY', pct: drivability, color: '#ffffff' },
    { label: 'COMMIT_VEL',  pct: commitScore, color: '#ffffff' },
  ]

  const ringColor = healthPct > 60 ? '#a3e635' : healthPct > 30 ? '#f5c518' : '#ef4444'
  const CIRC = 2 * Math.PI * 28

  return (
    <div className="panel-glow bg-black/40 backdrop-blur-2xl border border-white/[0.12] shadow-[0_30px_60px_rgba(0,0,0,0.8)]" style={{ borderTop: '2px solid rgba(210,0,90,0.5)', borderLeft: '2px solid rgba(210,0,90,0.3)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/10">
        <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.2em]">
          TRACK.HEALTH
        </span>
        <span
          className="font-black text-white leading-none inline-block"
          style={{
            fontFamily:    "'Barlow Condensed', sans-serif",
            fontSize:      '28px',
            transform:     'skewX(-6deg)',
            letterSpacing: '-0.02em',
          }}
        >
          {stats ? healthPct : '—'}<span className="text-zinc-600 text-lg">{stats ? '%' : ''}</span>
        </span>
      </div>

      {/* ── SVG ring ── */}
      <div className="flex justify-center py-4 border-b border-white/10">
        <div className="relative w-[72px] h-[72px]">
          <svg viewBox="0 0 72 72" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
            <circle
              cx="36" cy="36" r="28"
              fill="none"
              stroke={stats ? ringColor : 'rgba(255,255,255,0.1)'}
              strokeWidth="4"
              strokeLinecap="square"
              strokeDasharray={String(CIRC)}
              strokeDashoffset={String(CIRC * (1 - healthPct / 100))}
              style={{ filter: stats ? `drop-shadow(0 0 6px ${ringColor}99)` : 'none', transition: 'all 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="font-black text-white leading-none inline-block"
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize:   '20px',
                transform:  'skewX(-4deg)',
              }}
            >
              {stats ? healthPct : '—'}
            </span>
            <span className="font-mono text-[7px] text-zinc-600 uppercase tracking-[0.16em] mt-[2px]">
              HEALTH
            </span>
          </div>
        </div>
      </div>

      {/* ── Breakdown bars ── */}
      <div className="flex flex-col px-4 py-3 gap-[10px]">
        {bars.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="font-mono text-[8px] text-zinc-600 uppercase tracking-[0.08em] w-[72px] flex-shrink-0">
              {b.label}
            </span>
            <div className="flex-1 h-[2px] bg-white/[0.06] relative">
              <div
                className="absolute inset-y-0 left-0 transition-all duration-700"
                style={{ width: stats ? `${b.pct}%` : '0%', background: b.color }}
              />
            </div>
            <span
              className="font-black leading-none inline-block w-7 text-right flex-shrink-0"
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize:   '14px',
                color:      stats ? b.color : '#3f3f46',
                transform:  'skewX(-4deg)',
              }}
            >
              {stats ? b.pct : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
