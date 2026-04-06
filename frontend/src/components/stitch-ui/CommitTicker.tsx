// Scaffold commit entries — displayed when no track has been generated yet
const SCAFFOLD_COMMITS = [
  { hash: 'a3f92c1', message: 'git-to-track pipeline wired up',       author: 'ngp', time: '2m',  type: 'feat'     },
  { hash: 'b71e4d8', message: 'fbm noise hairpin injection tuned',    author: 'ngp', time: '14m', type: 'fix'      },
  { hash: 'c9102bf', message: 'perf: async github api gather',        author: 'ngp', time: '31m', type: 'perf'     },
  { hash: 'd45a77e', message: 'log-scale complexity mapping',         author: 'ngp', time: '1h',  type: 'refactor' },
  { hash: 'e823cc0', message: 'chore: drop torch dep, add httpx',     author: 'ngp', time: '2h',  type: 'chore'    },
  { hash: 'f11b39a', message: 'weather fog buckets clear/fog/storm',  author: 'ngp', time: '3h',  type: 'feat'     },
  { hash: '07d92f4', message: 'fix: cors vite 5173/5174 origins',     author: 'ngp', time: '4h',  type: 'fix'      },
  { hash: '182e55c', message: 'sha256 deterministic track seed',      author: 'ngp', time: '5h',  type: 'feat'     },
  { hash: '2c7f01b', message: 'chore: tailwind v4 theme tokens',      author: 'ngp', time: '6h',  type: 'chore'    },
  { hash: '3a4d88f', message: 'perf: tube segments 400→200 render',   author: 'ngp', time: '7h',  type: 'perf'     },
] as const

type CommitType = 'feat' | 'fix' | 'chore' | 'refactor' | 'perf'

const TYPE_STYLE: Record<CommitType, { label: string; color: string }> = {
  feat:     { label: 'FEAT',     color: '#a3e635' },
  fix:      { label: 'FIX',      color: '#ef4444' },
  chore:    { label: 'CHORE',    color: '#52525b' },
  refactor: { label: 'REFACTOR', color: '#38bdf8' },
  perf:     { label: 'PERF',     color: '#f5c518' },
}

// ─────────────────────────────────────────────────────────────────────────────
// CommitTicker
// When a track is generated: shows top languages as "data signals".
// Before generation: scaffold commit feed to fill the panel.
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  languages: string[] | null
  colors:    string[] | null
}

export default function CommitTicker({ languages, colors }: Props) {
  const hasTrack = languages !== null && languages.length > 0

  return (
    <div className="panel-glow flex flex-col h-full bg-black/40 backdrop-blur-2xl border border-white/[0.12] shadow-[0_30px_60px_rgba(0,0,0,0.8)]" style={{ borderTop: '2px solid rgba(210,0,90,0.5)', borderRight: '2px solid rgba(210,0,90,0.3)' }}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-white/10 flex-shrink-0">
        <div>
          <span className="font-mono text-[9px] text-[#f5c518] uppercase tracking-[0.2em]">
            {hasTrack ? 'LANG.PROFILE' : 'GIT.LOG'}
          </span>
          <p className="font-mono text-[8px] text-zinc-700 tracking-[0.1em] mt-[3px]">
            {hasTrack ? '⎇ git-to-track' : '⎇ main'}
          </p>
        </div>
        <div className="text-right">
          <span
            className="font-black text-white leading-none inline-block"
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize:   '28px',
              transform:  'skewX(-6deg)',
            }}
          >
            {hasTrack ? languages.length : SCAFFOLD_COMMITS.length}
          </span>
          <p className="font-mono text-[8px] text-zinc-600 uppercase tracking-[0.12em] mt-[2px]">
            {hasTrack ? 'LANGUAGES' : 'COMMITS'}
          </p>
        </div>
      </div>

      {/* ── Content ── */}
      {hasTrack ? (
        // Language cards — static, no scroll needed (max 3 languages from backend)
        <div className="flex flex-col flex-1 p-4 gap-3">
          {languages.map((lang, i) => {
            const color = colors?.[i] ?? '#f5c518'
            return (
              <div
                key={lang}
                className="border border-white/[0.08] p-4"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span
                    className="font-black uppercase leading-none inline-block"
                    style={{
                      fontFamily:    "'Barlow Condensed', sans-serif",
                      fontSize:      '20px',
                      color,
                      transform:     'skewX(-4deg)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {lang}
                  </span>
                  <span className="font-mono text-[8px] text-zinc-600 uppercase tracking-[0.1em]">
                    #{i + 1} LANG
                  </span>
                </div>

                {/* Colour swatch */}
                <div className="flex items-center gap-2 mt-1">
                  <div
                    style={{
                      width:        24,
                      height:       4,
                      background:   color,
                      boxShadow:    `0 0 6px ${color}88`,
                    }}
                  />
                  <span className="font-mono text-[8px] text-zinc-600 uppercase tracking-[0.08em]">
                    {color}
                  </span>
                </div>

                {/* Accent bar — fills panel width, represents rank */}
                <div className="mt-3 h-[2px] bg-white/[0.06]">
                  <div
                    style={{
                      height:     '100%',
                      width:      `${100 - i * 28}%`,
                      background: color,
                      transition: 'width 0.6s ease',
                    }}
                  />
                </div>
              </div>
            )
          })}

          <p className="font-mono text-[8px] text-zinc-700 text-center uppercase tracking-[0.12em] mt-auto pt-2">
            Colors sourced from github-linguist
          </p>
        </div>
      ) : (
        // Scrolling scaffold commit feed
        <div
          className="flex-1 overflow-hidden relative"
          style={{
            maskImage:       'linear-gradient(to bottom, black 70%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)',
          }}
        >
          <div
            className="flex flex-col"
            style={{ animation: 'ticker-scroll 30s linear infinite' }}
            onMouseEnter={(e) => (e.currentTarget.style.animationPlayState = 'paused')}
            onMouseLeave={(e) => (e.currentTarget.style.animationPlayState = 'running')}
          >
            {[...SCAFFOLD_COMMITS, ...SCAFFOLD_COMMITS].map((c, i) => {
              const t = TYPE_STYLE[c.type]
              return (
                <div
                  key={`${c.hash}-${i}`}
                  className="px-4 py-3 border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2 mb-[5px]">
                    <span
                      className="font-mono font-bold uppercase"
                      style={{ fontSize: '9px', letterSpacing: '0.14em', color: t.color }}
                    >
                      [{t.label}]
                    </span>
                    <span className="font-mono text-[8px] text-zinc-700 tracking-[0.06em] ml-auto">
                      {c.hash}
                    </span>
                    <span className="font-mono text-[8px] text-zinc-700">{c.time}</span>
                  </div>
                  <p className="font-mono text-[10px] text-zinc-300 leading-snug" style={{ letterSpacing: '0.02em' }}>
                    {c.message}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
