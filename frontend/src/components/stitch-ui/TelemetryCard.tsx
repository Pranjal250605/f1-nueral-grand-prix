import type { TrackStats } from '@/context/TrackContext'

// ─────────────────────────────────────────────────────────────────────────────
// TelemetryCard — shows live GitHub stats once a track is generated,
// falls back to scaffold placeholders before first load.
// ─────────────────────────────────────────────────────────────────────────────
export default function TelemetryCard({ stats }: { stats: TrackStats | null }) {

  const blocks = stats
    ? [
        {
          heading: 'GITHUB ACTIVITY',
          rows: [
            { label: 'COMMITS',    value: String(stats.total_commits),                    color: '#ffffff' },
            { label: 'STARS',      value: String(stats.total_stars),                      color: '#f5c518' },
          ],
        },
        {
          heading: 'REPO HEALTH',
          rows: [
            { label: 'OPEN_ISS',   value: String(stats.open_issues),                      color: '#ef4444' },
            { label: 'CLOSED_ISS', value: String(stats.closed_issues),                    color: '#a3e635' },
            { label: 'LANGUAGES',  value: String(stats.top_languages.length),             color: '#ffffff' },
          ],
        },
        {
          heading: 'TRACK PARAMS',
          rows: [
            { label: 'COMPLEXITY', value: (stats.complexity * 100).toFixed(1) + '%',      color: '#a3e635' },
            { label: 'SMOOTHNESS', value: (stats.smoothness * 100).toFixed(1) + '%',      color: '#a3e635' },
          ],
        },
      ]
    : [
        {
          heading: 'GITHUB ACTIVITY',
          rows: [
            { label: 'COMMITS',    value: '—',    color: '#ffffff' },
            { label: 'STARS',      value: '—',    color: '#ffffff' },
          ],
        },
        {
          heading: 'REPO HEALTH',
          rows: [
            { label: 'OPEN_ISS',   value: '—',    color: '#ef4444' },
            { label: 'CLOSED_ISS', value: '—',    color: '#a3e635' },
            { label: 'LANGUAGES',  value: '—',    color: '#ffffff' },
          ],
        },
        {
          heading: 'TRACK PARAMS',
          rows: [
            { label: 'COMPLEXITY', value: '—',    color: '#a3e635' },
            { label: 'SMOOTHNESS', value: '—',    color: '#a3e635' },
          ],
        },
      ]

  return (
    <div className="panel-glow bg-black/40 backdrop-blur-2xl border border-white/[0.12] shadow-[0_30px_60px_rgba(0,0,0,0.8)]" style={{ borderTop: '2px solid rgba(210,0,90,0.5)', borderLeft: '2px solid rgba(210,0,90,0.3)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="relative flex h-[6px] w-[6px]">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lime-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-[6px] w-[6px] bg-lime-400" />
          </span>
          <span className="font-mono text-[9px] text-lime-400 uppercase tracking-[0.2em]">
            SYS.TELEMETRY
          </span>
        </div>
        <span className="font-mono text-[9px] text-zinc-600 tracking-widest">
          {stats ? 'GIT→TRACK' : 'AWAITING'}
        </span>
      </div>

      {/* ── Data blocks ── */}
      <div className="flex flex-col">
        {blocks.map((block) => (
          <div key={block.heading} className="border-t border-white/10">
            <p className="font-mono text-[8px] text-zinc-700 uppercase tracking-[0.2em] px-4 pt-3 pb-2">
              {block.heading}
            </p>
            {block.rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between px-4 pb-3">
                <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.1em]">
                  {row.label}
                </span>
                <span
                  className="font-black uppercase leading-none inline-block"
                  style={{
                    fontFamily:    "'Barlow Condensed', sans-serif",
                    fontSize:      '22px',
                    color:         row.color,
                    transform:     'skewX(-6deg)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
        <span className="font-mono text-[8px] text-zinc-700 uppercase tracking-[0.16em]">PIPELINE</span>
        <span className="font-mono text-[9px] font-bold text-lime-400 uppercase tracking-[0.14em]">
          {stats ? 'NOMINAL' : 'STANDBY'}
        </span>
      </div>
    </div>
  )
}
