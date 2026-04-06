import { useState } from 'react'
import { RefreshCw, Users, Zap } from 'lucide-react'
import TelemetryCard  from './TelemetryCard'
import SentimentCard  from './SentimentCard'
import CommitTicker   from './CommitTicker'
import UsernameModal  from '@/components/ui/UsernameModal'
import PitWall        from '@/components/ui/PitWall'
import LapCounter     from '@/components/ui/LapCounter'
import { useTrack }   from '@/context/TrackContext'

export default function DashboardLayout() {
  const [modalOpen, setModalOpen] = useState(false)
  const { trackData, loading, fetchTrack } = useTrack()

  return (
    <>
      {/* Username input modal — rendered above everything */}
      <UsernameModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {/* AI Pit Wall commentator — appears on sector crossings */}
      <PitWall />

      {/* Lap counter badge + completion burst */}
      <LapCounter />

      <div className="fixed inset-0 z-10 pointer-events-none">

        {/* ── Top-left: Floating logo shard ── */}
        <div className="absolute top-8 left-8 pointer-events-auto">
          <LogoBlock username={trackData?.username ?? null} />
        </div>

        {/* ── Left: Telemetry + Sentiment ── */}
        <div
          className="absolute top-24 left-8 flex flex-col gap-3 pointer-events-auto"
          style={{ width: '232px' }}
        >
          <TelemetryCard stats={trackData?.stats ?? null} />
          <SentimentCard stats={trackData?.stats ?? null} />
        </div>

        {/* ── Right: Commit feed ── */}
        <div
          className="absolute top-8 right-8 bottom-8 pointer-events-auto"
          style={{ width: '252px' }}
        >
          <CommitTicker languages={trackData?.stats.top_languages ?? null} colors={trackData?.colors ?? null} />
        </div>

        {/* ── Center: CTA buttons ── */}
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 pointer-events-auto flex items-center gap-3">

          {/* Primary: Generate / Regenerate (same user, no modal) */}
          <IgnitionButton
            loading={loading}
            hasTrack={!!trackData}
            onClick={() => trackData ? fetchTrack(trackData.username) : setModalOpen(true)}
          />

          {/* Secondary: Switch User — only shown after a track is loaded */}
          {trackData && (
            <button
              onClick={() => setModalOpen(true)}
              disabled={loading}
              style={{
                display:       'flex',
                alignItems:    'center',
                gap:           6,
                fontFamily:    "'IBM Plex Mono', monospace",
                fontSize:      '10px',
                fontWeight:    700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color:         loading ? '#52525b' : '#00d4ff',
                background:    'rgba(0,0,0,0.55)',
                border:        `1px solid ${loading ? 'rgba(255,255,255,0.08)' : 'rgba(0,212,255,0.35)'}`,
                padding:       '10px 16px',
                cursor:        loading ? 'not-allowed' : 'pointer',
                backdropFilter:'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                transition:    'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.borderColor = 'rgba(0,212,255,0.7)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = loading ? 'rgba(255,255,255,0.08)' : 'rgba(0,212,255,0.35)'
              }}
            >
              <Users size={12} />
              Switch User
            </button>
          )}
        </div>

        {/* ── Bottom-center: Status strip ── */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-auto">
          <StatusStrip />
        </div>

      </div>
    </>
  )
}

// ── Logo shard ────────────────────────────────────────────────────────────────
function LogoBlock({ username }: { username: string | null }) {
  return (
    <div
      className="panel-glow relative bg-black/40 backdrop-blur-2xl border border-white/[0.12] shadow-[0_30px_60px_rgba(0,0,0,0.8)] px-4 py-3"
      style={{ borderTop: '2px solid rgba(210,0,90,0.55)', borderLeft: '2px solid rgba(210,0,90,0.3)' }}
      style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}
    >
      <div className="absolute top-0 right-0 w-[1px] h-full" style={{ background: 'rgba(245,197,24,0.4)' }} />
      <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-[0.22em] mb-1">
        SYS / CIRCUIT_GEN
      </p>
      <h1
        className="font-black uppercase text-white leading-none"
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: '20px',
          letterSpacing: '-0.01em',
          transform: 'skewX(-4deg)',
        }}
      >
        Neural&nbsp;<span className="text-[#f5c518]">Grand Prix</span>
      </h1>
      {username ? (
        <p className="font-mono text-[8px] text-zinc-400 uppercase tracking-[0.14em] mt-1">
          @{username}&ensp;·&ensp;<span className="text-lime-400">● LIVE</span>
        </p>
      ) : (
        <p className="font-mono text-[8px] text-zinc-600 uppercase tracking-[0.18em] mt-1">
          v2.0 — git-to-track&ensp;·&ensp;<span className="text-lime-400">● ONLINE</span>
        </p>
      )}
    </div>
  )
}

// ── Bottom status strip ───────────────────────────────────────────────────────
function StatusStrip() {
  const { trackData } = useTrack()

  const items = trackData
    ? [
        { k: 'COMMITS',    v: String(trackData.stats.total_commits),           accent: false },
        { k: 'STARS',      v: String(trackData.stats.total_stars),             accent: false },
        { k: 'COMPLEXITY', v: (trackData.stats.complexity * 100).toFixed(0) + '%', accent: true  },
        { k: 'SMOOTHNESS', v: (trackData.stats.smoothness * 100).toFixed(0) + '%', accent: false },
        { k: 'WEATHER',    v: trackData.weather,                               accent: trackData.weather !== 'CLEAR' },
      ]
    : [
        { k: 'N_POINTS',   v: '—',         accent: false },
        { k: 'COMMITS',    v: '—',         accent: false },
        { k: 'SPLINE',     v: 'CATMULL-R', accent: false },
        { k: 'FPS',        v: '60',        accent: true  },
        { k: 'WEATHER',    v: '—',         accent: false },
      ]

  return (
    <div className="panel-glow flex bg-black/40 backdrop-blur-2xl border border-white/[0.12] shadow-[0_30px_60px_rgba(0,0,0,0.8)] overflow-hidden" style={{ borderTop: '2px solid rgba(210,0,90,0.4)' }}>
      {items.map(({ k, v, accent }) => (
        <div
          key={k}
          className="flex flex-col items-center gap-[3px] px-5 py-2 border-r border-white/10 last:border-r-0"
        >
          <span className="font-mono text-[8px] text-zinc-600 uppercase tracking-[0.16em]">{k}</span>
          <span
            className="font-black uppercase leading-none inline-block"
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: '16px',
              color: accent ? '#a3e635' : '#ffffff',
              transform: 'skewX(-4deg)',
            }}
          >
            {v}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Ignition button ───────────────────────────────────────────────────────────
function IgnitionButton({
  loading,
  hasTrack,
  onClick,
}: {
  loading:  boolean
  hasTrack: boolean
  onClick:  () => void
}) {
  const [hovered, setHovered] = useState(false)

  const idle    = !loading
  const flash   = idle && hovered

  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position:      'relative',
        display:       'flex',
        alignItems:    'center',
        gap:           9,
        fontFamily:    "'IBM Plex Mono', monospace",
        fontWeight:    900,
        fontSize:      '11px',
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color:         flash ? '#000000' : '#ffffff',
        background:    flash ? '#ffffff' : 'rgba(0,0,0,0.65)',
        border:        '2px solid',
        borderColor:   loading ? 'rgba(255,255,255,0.15)' : 'rgba(34,211,238,0.85)',
        padding:       '13px 32px',
        cursor:        loading ? 'not-allowed' : 'pointer',
        clipPath:      'polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)',
        backdropFilter:'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow:     loading
          ? 'none'
          : flash
            ? '0 0 28px rgba(34,211,238,0.9), 0 0 8px rgba(34,211,238,0.6)'
            : '0 0 15px rgba(34,211,238,0.6), 0 0 4px rgba(34,211,238,0.3)',
        transform:     flash ? 'scale(1.04)' : 'scale(1)',
        transition:    'color 0.12s, background 0.12s, box-shadow 0.12s, transform 0.12s, border-color 0.12s',
        opacity:       loading ? 0.6 : 1,
      }}
    >
      {loading
        ? <><IgnitionSpinner /> GENERATING...</>
        : hasTrack
          ? <><RefreshCw size={13} color={flash ? '#000' : '#22d3ee'} /> REGENERATE</>
          : <><Zap      size={14} color={flash ? '#000' : '#22d3ee'} /> GENERATE TRACK</>
      }
    </button>
  )
}

function IgnitionSpinner() {
  return (
    <span style={{
      display:      'inline-block',
      width:        11,
      height:       11,
      border:       '2px solid rgba(255,255,255,0.2)',
      borderTop:    '2px solid #22d3ee',
      borderRadius: '50%',
      animation:    'spin 0.7s linear infinite',
      flexShrink:   0,
    }} />
  )
}
