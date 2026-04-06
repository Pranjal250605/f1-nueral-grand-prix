import { useEffect, useRef, useState } from 'react'
import monacoPoints from '@/data/monaco'

// Start-line position in world-space XZ (matches DrivableCar spawn)
const TRACK_SCALE_H = 300
const START_X = monacoPoints[0][0] * TRACK_SCALE_H
const START_Z = monacoPoints[0][2] * TRACK_SCALE_H

const LAP_EXIT_DIST   = 600   // must travel this far from start before lap can trigger
const LAP_DETECT_DIST = 180   // must be within this radius of start to complete lap

// ─────────────────────────────────────────────────────────────────────────────
// LapPopup
// Detects lap completion from car-position DOM events, then shows a
// Persona-style HTML overlay: diagonal slash, bold slanted text, scale pop.
// ─────────────────────────────────────────────────────────────────────────────
export default function LapPopup() {
  const [visible,  setVisible]  = useState(false)
  const [lapCount, setLapCount] = useState(0)
  const [scale,    setScale]    = useState(0)

  const hasLeft = useRef(false)   // car has moved far enough from start
  const lapRef  = useRef(0)       // mirrors lapCount for use inside closure

  useEffect(() => {
    const handler = (e: Event) => {
      const { x, z } = (e as CustomEvent<{ x: number; z: number }>).detail
      const dx   = x - START_X
      const dz   = z - START_Z
      const dist = Math.sqrt(dx * dx + dz * dz)

      if (!hasLeft.current && dist > LAP_EXIT_DIST) {
        hasLeft.current = true
      }

      if (hasLeft.current && dist < LAP_DETECT_DIST) {
        hasLeft.current = false
        lapRef.current  += 1
        setLapCount(lapRef.current)
        setVisible(true)
        setScale(1.25)

        // Announce to scene (ChromaticAberration burst)
        window.dispatchEvent(new CustomEvent('lap-complete'))

        // Settle to 1.0 → dismiss after 1.5 s
        setTimeout(() => setScale(1.0),   180)
        setTimeout(() => setVisible(false), 1600)
      }
    }

    window.addEventListener('car-position', handler)
    return () => window.removeEventListener('car-position', handler)
  }, [])

  if (!visible) return null

  return (
    <div
      style={{
        position:        'absolute',
        top:             '50%',
        left:            '50%',
        transform:       `translate(-50%, -50%) scale(${scale}) skewX(-8deg)`,
        transition:      'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
        zIndex:          2000,
        pointerEvents:   'none',
        userSelect:      'none',
        minWidth:        360,
        textAlign:       'center',
      }}
    >
      {/* ── Persona slash card ── */}
      <div
        style={{
          background:   'linear-gradient(104deg, #e00 0%, #e00 45%, #111 45%, #111 100%)',
          border:       '3px solid #ff1a00',
          padding:      '18px 36px',
          position:     'relative',
          overflow:     'hidden',
          boxShadow:    '0 0 40px rgba(220,0,0,0.8), 0 0 80px rgba(220,0,0,0.3)',
        }}
      >
        {/* Diagonal white accent stripe */}
        <div style={{
          position:   'absolute',
          top:        -10,
          left:       '42%',
          width:      6,
          height:     '130%',
          background: 'rgba(255,255,255,0.18)',
          transform:  'rotate(12deg)',
        }} />

        <div style={{
          fontFamily:  '"JetBrains Mono", monospace',
          fontWeight:  900,
          fontStyle:   'italic',
          fontSize:    48,
          color:       '#ffffff',
          letterSpacing: 4,
          lineHeight:  1,
          textShadow:  '2px 2px 0 #000, -2px -2px 0 #000, 3px 0 0 #000',
        }}>
          LAP CLEAR!
        </div>

        <div style={{
          fontFamily:   '"JetBrains Mono", monospace',
          fontWeight:   700,
          fontStyle:    'italic',
          fontSize:     16,
          color:        '#ffdddd',
          letterSpacing: 6,
          marginTop:    6,
          textShadow:   '1px 1px 0 #000',
        }}>
          LAP {lapCount} COMPLETE
        </div>
      </div>
    </div>
  )
}
