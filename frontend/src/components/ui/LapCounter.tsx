/**
 * LapCounter
 *
 * Two parts:
 *  1. Persistent badge below the minimap — always shows current lap number.
 *  2. Lap-complete burst — dramatic F1-style animation that fires on every
 *     'lap-complete' CustomEvent dispatched by DrivableCar.
 */

import { useState, useEffect, useRef } from 'react'

function fmtTime(ms: number): string {
  const m  = Math.floor(ms / 60_000)
  const s  = Math.floor((ms % 60_000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export default function LapCounter() {
  const [lap,         setLap]        = useState(1)
  const [burst,       setBurst]      = useState(false)
  const [burstLap,    setBurstLap]   = useState(1)
  const [lapTimeMs,   setLapTimeMs]  = useState<number | null>(null)
  const [bestLapMs,   setBestLapMs]  = useState<number | null>(null)
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onSector = (e: Event) => {
      setLap((e as CustomEvent<{ lap: number }>).detail.lap)
    }

    const onLapComplete = (e: Event) => {
      const { lap, lapTimeMs, bestLapMs } = (e as CustomEvent<{ lap: number; lapTimeMs: number; bestLapMs: number }>).detail
      setBurstLap(lap)
      setLapTimeMs(lapTimeMs)
      setBestLapMs(bestLapMs)
      setLap(lap)
      setBurst(true)
      if (burstTimer.current) clearTimeout(burstTimer.current)
      burstTimer.current = setTimeout(() => setBurst(false), 3200)
    }

    window.addEventListener('sector-crossed',  onSector)
    window.addEventListener('lap-complete',    onLapComplete)
    return () => {
      window.removeEventListener('sector-crossed',  onSector)
      window.removeEventListener('lap-complete',    onLapComplete)
      if (burstTimer.current) clearTimeout(burstTimer.current)
    }
  }, [])

  return (
    <>
      <style>{`
        @keyframes lc-badge-pulse {
          0%   { box-shadow: 0 0 0px rgba(245,197,24,0); }
          50%  { box-shadow: 0 0 14px rgba(245,197,24,0.55); }
          100% { box-shadow: 0 0 0px rgba(245,197,24,0); }
        }
        @keyframes lc-burst-in {
          0%   { transform: translateX(-50%) translateY(40px) scaleX(0.6); opacity: 0; }
          18%  { transform: translateX(-50%) translateY(0px)  scaleX(1.04); opacity: 1; }
          25%  { transform: translateX(-50%) translateY(0px)  scaleX(1); opacity: 1; }
          80%  { transform: translateX(-50%) translateY(0px)  scaleX(1); opacity: 1; }
          100% { transform: translateX(-50%) translateY(-28px) scaleX(0.9); opacity: 0; }
        }
        @keyframes lc-scan {
          0%   { left: -100%; }
          100% { left: 110%; }
        }
        @keyframes lc-num-pop {
          0%   { transform: skewX(-6deg) scale(0.7); opacity: 0; }
          40%  { transform: skewX(-6deg) scale(1.12); opacity: 1; }
          60%  { transform: skewX(-6deg) scale(0.97); }
          100% { transform: skewX(-6deg) scale(1); opacity: 1; }
        }
        @keyframes lc-flag {
          0%,100% { opacity: 0.7; }
          50%     { opacity: 1; }
        }
      `}</style>

      {/* ── Persistent lap badge ───────────────────────────────────────────── */}
      <div style={{
        position:        'fixed',
        top:             228,           // just below the 200 px minimap + 8 px gap
        left:            '50%',
        transform:       'translateX(-50%)',
        zIndex:          1000,
        display:         'flex',
        alignItems:      'center',
        gap:             8,
        padding:         '5px 14px',
        background:      'rgba(0,0,0,0.60)',
        backdropFilter:  'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border:          '1px solid rgba(245,197,24,0.30)',
        borderTop:       '2px solid rgba(245,197,24,0.70)',
        pointerEvents:   'none',
        animation:       burst ? 'lc-badge-pulse 0.5s ease-out' : 'none',
      }}>
        <span style={{
          fontFamily:    '"JetBrains Mono", monospace',
          fontSize:       8,
          color:         'rgba(245,197,24,0.55)',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
        }}>
          LAP
        </span>
        <span style={{
          fontFamily:    "'Barlow Condensed', sans-serif",
          fontWeight:     900,
          fontSize:       20,
          color:         '#f5c518',
          lineHeight:     1,
          transform:     'skewX(-5deg)',
          display:       'inline-block',
          minWidth:      24,
          textAlign:     'center',
        }}>
          {lap}
        </span>
      </div>

      {/* ── Lap-complete burst overlay ─────────────────────────────────────── */}
      {burst && (
        <div style={{
          position:  'fixed',
          top:       '50%',
          left:      '50%',
          transform: 'translateX(-50%) translateY(-50%)',
          zIndex:    2000,
          width:     'min(92vw, 560px)',
          pointerEvents: 'none',
          animation: 'lc-burst-in 3.2s cubic-bezier(0.16,1,0.3,1) forwards',
          overflow:  'hidden',
        }}>
          {/* Panel */}
          <div style={{
            background:   'rgba(0,0,0,0.88)',
            border:       '1px solid rgba(245,197,24,0.40)',
            borderLeft:   '4px solid #f5c518',
            borderRight:  '4px solid #f5c518',
            borderTop:    '2px solid rgba(245,197,24,0.60)',
            boxShadow:    '0 0 60px rgba(245,197,24,0.25), 0 0 120px rgba(245,197,24,0.10)',
            padding:      '18px 32px 20px',
            position:     'relative',
            overflow:     'hidden',
          }}>

            {/* Diagonal stripe background */}
            <div style={{
              position:   'absolute', inset: 0,
              background: 'repeating-linear-gradient(135deg, transparent 0px, transparent 18px, rgba(245,197,24,0.03) 18px, rgba(245,197,24,0.03) 36px)',
              pointerEvents: 'none',
            }} />

            {/* Scan line shimmer */}
            <div style={{
              position:   'absolute', top: 0, bottom: 0,
              width:      '40%',
              background: 'linear-gradient(90deg, transparent, rgba(245,197,24,0.08), transparent)',
              animation:  'lc-scan 1.1s ease-in-out 0.2s',
              pointerEvents: 'none',
            }} />

            {/* Content */}
            <div style={{ position: 'relative', textAlign: 'center' }}>

              {/* Checkered flags */}
              <div style={{
                fontFamily:    '"JetBrains Mono", monospace',
                fontSize:       11,
                color:         'rgba(245,197,24,0.55)',
                letterSpacing: '0.30em',
                textTransform: 'uppercase',
                marginBottom:  6,
                animation:     'lc-flag 0.6s ease-in-out infinite',
              }}>
                ⬛⬜⬛⬜&nbsp;&nbsp;LAP COMPLETE&nbsp;&nbsp;⬜⬛⬜⬛
              </div>

              {/* Big lap number */}
              <div style={{
                fontFamily:    "'Barlow Condensed', sans-serif",
                fontWeight:     900,
                fontSize:      'clamp(64px, 14vw, 96px)',
                color:         '#f5c518',
                lineHeight:     0.9,
                letterSpacing: '-0.02em',
                display:       'inline-block',
                transform:     'skewX(-6deg)',
                textShadow:    '0 0 40px rgba(245,197,24,0.6)',
                animation:     'lc-num-pop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.1s both',
              }}>
                {burstLap}
              </div>

              {/* Lap time row */}
              {lapTimeMs !== null && (
                <div style={{
                  display:       'flex',
                  justifyContent:'center',
                  gap:            24,
                  marginTop:      10,
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 8, color: 'rgba(245,197,24,0.50)', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 3 }}>
                      LAP TIME
                    </div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: '#ffffff', letterSpacing: '0.04em' }}>
                      {fmtTime(lapTimeMs)}
                    </div>
                  </div>
                  {bestLapMs !== null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 8, color: 'rgba(245,197,24,0.50)', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 3 }}>
                        BEST LAP
                      </div>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: lapTimeMs === bestLapMs ? '#a3e635' : '#ffffff', letterSpacing: '0.04em' }}>
                        {fmtTime(bestLapMs)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
