import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ── Audio hook — must be called from a user-gesture handler ──────────────────
export function playIntroSound(): void {
  // Example: new Audio('/sounds/intro.mp3').play()
  console.log('[PersonaIntro] playIntroSound() — wire up your audio file here')
}

// ── CSS keyframes (injected once via useLayoutEffect before first paint) ──────
// All enter/exit animations use only `transform` + `opacity` — GPU composited,
// zero JS per frame, safe to run alongside Three.js at 60 fps.
const KEYFRAMES = `
@keyframes _ngp-from-left {
  from { transform: translate3d(-115%, 0, 0) rotate(-7deg); }
  to   { transform: none; }
}
@keyframes _ngp-from-right {
  from { transform: translate3d(115%, 0, 0) rotate(7deg); }
  to   { transform: none; }
}
@keyframes _ngp-from-top {
  from { transform: translate3d(0, -115%, 0); }
  to   { transform: none; }
}
@keyframes _ngp-from-br {
  from { transform: translate3d(115%, 115%, 0); }
  to   { transform: none; }
}
@keyframes _ngp-from-tl {
  from { transform: translate3d(-115%, -115%, 0); }
  to   { transform: none; }
}
@keyframes _ngp-word {
  0%   { transform: translate3d(0, 72px, 0); opacity: 0; filter: blur(3px); }
  65%  { transform: translate3d(0, -6px, 0); opacity: 1; filter: blur(0);   }
  82%  { transform: translate3d(0, 3px,  0); }
  100% { transform: none; }
}
@keyframes _ngp-bar {
  from { transform: scaleX(0); opacity: 0; }
  to   { transform: scaleX(1); opacity: 1; }
}
@keyframes _ngp-flash {
  0%   { opacity: 0; }
  22%  { opacity: 1; }
  100% { opacity: 0; }
}
`

// ── Shard data ────────────────────────────────────────────────────────────────
// clip-path is STATIC — only transform animates (compositor-friendly).
const SHARDS = [
  {
    color:      '#111111',
    clip:       'polygon(0% 0%, 64% 0%, 46% 100%, 0% 100%)',
    enterAnim:  '_ngp-from-left',
    enterDelay: 0,
    exitTx:     'translate3d(-130%, 0, 0) rotate(-9deg)',
    exitDelay:  '0ms',
  },
  {
    color:      '#f0f0f0',
    clip:       'polygon(56% 0%, 100% 0%, 100% 100%, 40% 100%)',
    enterAnim:  '_ngp-from-right',
    enterDelay: 45,
    exitTx:     'translate3d(130%, 0, 0) rotate(9deg)',
    exitDelay:  '20ms',
  },
  {
    color:      '#0d0d0d',
    clip:       'polygon(40% 0%, 58% 0%, 54% 100%, 36% 100%)',
    enterAnim:  '_ngp-from-top',
    enterDelay: 80,
    exitTx:     'translate3d(0, -130%, 0)',
    exitDelay:  '10ms',
  },
  {
    color:      '#e5e5e5',
    clip:       'polygon(72% 60%, 100% 42%, 100% 100%, 60% 100%)',
    enterAnim:  '_ngp-from-br',
    enterDelay: 105,
    exitTx:     'translate3d(130%, 130%, 0)',
    exitDelay:  '30ms',
  },
  {
    color:      '#1a1a1a',
    clip:       'polygon(0% 0%, 30% 0%, 0% 42%)',
    enterAnim:  '_ngp-from-tl',
    enterDelay: 125,
    exitTx:     'translate3d(-130%, -130%, 0)',
    exitDelay:  '5ms',
  },
] as const

const SLAM_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const WORDS     = ['NEURAL', 'GRAND', 'PRIX'] as const

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  /** Fired immediately when the user clicks PRESS START — use to begin pre-loading the canvas. */
  onStart:    () => void
  /** Fired ~850 ms later once the overlay has fully left the viewport. */
  onComplete: () => void
}

export default function PersonaIntro({ onStart, onComplete }: Props) {
  const [phase, setPhase] = useState<'slam' | 'brand' | 'ready' | 'exit'>('slam')
  const fired = useRef(false)

  // Inject keyframes before first paint so CSS animations start correctly
  useLayoutEffect(() => {
    if (document.getElementById('_ngp-kf')) return
    const s = document.createElement('style')
    s.id    = '_ngp-kf'
    s.textContent = KEYFRAMES
    document.head.appendChild(s)
    return () => { document.getElementById('_ngp-kf')?.remove() }
  }, [])

  // Phase timeline
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('brand'),  650)
    const t2 = setTimeout(() => setPhase('ready'), 2400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const handleStart = useCallback(() => {
    if (fired.current) return
    fired.current = true
    playIntroSound()
    setPhase('exit')
    // Tell App.tsx to mount (but keep hidden) the canvas immediately so it has
    // time to compile shaders while the overlay is still animating out.
    onStart()
    // Signal App.tsx to reveal the canvas only AFTER the overlay has fully
    // left the viewport (~800 ms animation + small buffer).
    setTimeout(onComplete, 850)
  }, [onStart, onComplete])

  const isExit    = phase === 'exit'
  const showBrand = phase === 'brand' || phase === 'ready'
  const showStart = phase === 'ready'

  return (
    // ONE Framer Motion element: the outer wrapper SLIDES UP on exit.
    // Opacity fade was causing black frames — Chrome doesn't composite the
    // WebGL canvas through a transparent overlay reliably. A translateY wipe
    // reveals the canvas instantly once the overlay clears the viewport edge.
    <motion.div
      animate={{ y: isExit ? '-105%' : '0%' }}
      transition={isExit
        ? { duration: 0.52, delay: 0.28, ease: [0.87, 0, 0.13, 1] }
        : { duration: 0 }
      }
      style={{
        position:   'fixed',
        inset:      0,
        zIndex:     9000,
        background: '#D32F2F',
        overflow:   'hidden',
        willChange: 'transform',
      }}
    >

      {/* ── Shards — enter via CSS @keyframes, exit via CSS transition ── */}
      {SHARDS.map((s, i) => (
        <div
          key={i}
          style={{
            position:   'fixed',
            inset:      0,
            background: s.color,
            clipPath:   s.clip,       // static — never animated (avoids repaint)
            willChange: 'transform',
            // Enter: CSS animation (compositor, no JS)
            // Exit:  inline CSS transition to off-screen transform
            ...(isExit
              ? {
                  transform:  s.exitTx,
                  transition: `transform 0.2s ease-in ${s.exitDelay}`,
                }
              : {
                  animation: `${s.enterAnim} 0.65s ${SLAM_EASE} ${s.enterDelay}ms both`,
                }
            ),
          }}
        />
      ))}

      {/* ── Halftone dot pattern ── */}
      <div
        style={{
          position:        'fixed',
          inset:           0,
          backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.48) 1.2px, transparent 1.2px)',
          backgroundSize:  '10px 10px',
          pointerEvents:   'none',
          zIndex:          1,
          transform:       'translateZ(0)',
        }}
      />

      {/* ── Branding — CSS mount animation, CSS transition on exit ── */}
      {showBrand && (
        <div
          style={{
            position:       'fixed',
            inset:          0,
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            zIndex:         2,
            pointerEvents:  'none',
            // Exit: shift up + fade; Enter: just rotate (words handle their own entry)
            transform:      isExit
              ? 'rotate(-15deg) translateY(-28px)'
              : 'rotate(-15deg)',
            opacity:    isExit ? 0 : 1,
            transition: isExit
              ? 'opacity 0.17s ease-in, transform 0.17s ease-in'
              : 'none',
          }}
        >
          {/* Top accent bar */}
          <div style={{
            width:           460,
            height:          4,
            background:      '#D32F2F',
            marginBottom:    18,
            transformOrigin: 'left center',
            animation:       '_ngp-bar 0.22s ease-out 0.08s both',
          }} />

          {/* Title words — staggered CSS animation */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}>
            {WORDS.map((word, i) => (
              <span
                key={word}
                style={{
                  display:       'inline-block',   // required for transform
                  fontFamily:    '"JetBrains Mono", monospace',
                  fontWeight:    900,
                  fontStyle:     'italic',
                  fontSize:      'clamp(44px, 8vw, 88px)',
                  color:         '#ffffff',
                  lineHeight:    1,
                  letterSpacing: 4,
                  userSelect:    'none',
                  // Chromatic aberration via static text-shadow (no animation needed)
                  textShadow:    '5px 0 0 rgba(255,0,60,0.72), -5px 0 0 rgba(0,255,240,0.72), 2px 2px 0 #000',
                  animation:     `_ngp-word 0.62s ${SLAM_EASE} ${i * 130 + 50}ms both`,
                }}
              >
                {word}
              </span>
            ))}
          </div>

          {/* Subtitle */}
          <div style={{
            fontFamily:    '"JetBrains Mono", monospace',
            fontWeight:    700,
            fontSize:      11,
            color:         '#ffcccc',
            letterSpacing: 7,
            marginTop:     14,
            textTransform: 'uppercase',
            userSelect:    'none',
            opacity:       0,
            animation:     `_ngp-word 0.5s ease-out 530ms forwards`,
          }}>
            GITHUB COMMIT HISTORY → F1 CIRCUIT
          </div>

          {/* Bottom accent bar */}
          <div style={{
            width:           460,
            height:          4,
            background:      '#D32F2F',
            marginTop:       18,
            transformOrigin: 'right center',
            animation:       '_ngp-bar 0.22s ease-out 0.26s both',
          }} />
        </div>
      )}

      {/* ── Press Start button — ONE Framer Motion element for hover spring ── */}
      <AnimatePresence>
        {showStart && !isExit && (
          <motion.button
            key="start"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18, transition: { duration: 0.15 } }}
            transition={{ duration: 0.26, ease: 'easeOut' }}
            whileHover={{ x: -3, y: -3, boxShadow: '8px 8px 0 #8b0000' }}
            whileTap={{   x: 2,  y: 2,  boxShadow: '2px 2px 0 #8b0000' }}
            onClick={handleStart}
            style={{
              position:      'fixed',
              bottom:        72,
              left:          '50%',
              transform:     'translateX(-50%) skewX(-10deg)',
              zIndex:        3,
              fontFamily:    '"JetBrains Mono", monospace',
              fontWeight:    900,
              fontStyle:     'italic',
              fontSize:      18,
              letterSpacing: 8,
              color:         '#111111',
              background:    '#ffffff',
              border:        '3px solid #8b0000',
              padding:       '14px 52px',
              cursor:        'pointer',
              textTransform: 'uppercase',
              boxShadow:     '5px 5px 0 #8b0000',
              outline:       'none',
            }}
          >
            PRESS START ▶
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── White-out flash — CSS-only, masks 3D pop-in ── */}
      {isExit && (
        <div style={{
          position:      'fixed',
          inset:         0,
          background:    '#ffffff',
          pointerEvents: 'none',
          zIndex:        9,
          animation:     '_ngp-flash 0.55s ease-out forwards',
          transform:     'translateZ(0)',
        }} />
      )}

    </motion.div>
  )
}
