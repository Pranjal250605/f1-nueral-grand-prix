import { useState, useEffect, useRef, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTrack } from '@/context/TrackContext'

const WEATHER_META = {
  CLEAR: { label: 'CLEAR',  color: '#a3e635', desc: 'Elite repo health — pure neon void' },
  FOG:   { label: 'FOG',    color: '#f5c518', desc: 'Open issues present — visibility reduced' },
  STORM: { label: 'STORM',  color: '#ef4444', desc: 'High open-issue ratio — severe conditions' },
} as const

interface Props {
  open:    boolean
  onClose: () => void
}

export default function UsernameModal({ open, onClose }: Props) {
  const { fetchTrack, loading, error, trackData } = useTrack()
  const [username, setUsername] = useState('')
  const inputRef    = useRef<HTMLInputElement>(null)
  // Only auto-close when a fetch was triggered *inside this modal session*
  const fetchedRef  = useRef(false)

  useEffect(() => {
    if (open) {
      setUsername('')          // always start with a blank field
      fetchedRef.current = false
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  // Auto-close 900 ms after successful generation — but only if we fetched here
  useEffect(() => {
    if (!loading && !error && trackData && open && fetchedRef.current) {
      const t = setTimeout(onClose, 900)
      return () => clearTimeout(t)
    }
  }, [loading, error, trackData, open, onClose])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || loading) return
    fetchedRef.current = true
    fetchTrack(username.trim())
  }

  const weather    = trackData?.weather ? WEATHER_META[trackData.weather] : null
  const justLoaded = !loading && !error && trackData

  return (
    <>
      {/*
        BACKDROP — NO opacity animation.
        Chrome cannot composite a WebGL canvas through a fading HTML overlay.
        Snapping in/out instantly avoids the compositor black-frame bug.
      */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position:   'fixed',
            inset:      0,
            background: 'rgba(0,0,0,0.78)',
            zIndex:     500,
            cursor:     'pointer',
          }}
        />
      )}

      {/*
        PANEL — translateY animation only (GPU transform path, no opacity).
        Centering wrapper is non-animated; only the inner motion.div moves.
      */}
      <AnimatePresence>
        {open && (
          <div
            style={{
              position:       'fixed',
              inset:          0,
              zIndex:         501,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              padding:        '0 16px',
              pointerEvents:  'none',
            }}
          >
            <motion.div
              key="modal-panel"
              initial={{ y: 28 }}
              animate={{ y: 0  }}
              exit={{    y: 18 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              style={{ width: '100%', maxWidth: 420, pointerEvents: 'auto' }}
            >
              {/* Panel shell */}
              <div style={{
                background: '#09090f',
                border:     '1px solid rgba(255,255,255,0.1)',
                boxShadow:  '0 40px 80px rgba(0,0,0,0.95)',
                clipPath:   'polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%)',
                position:   'relative',
              }}>
                {/* Gold corner accent */}
                <div style={{
                  position:   'absolute',
                  top:        0,
                  right:      0,
                  width:      1,
                  height:     '100%',
                  background: 'rgba(245,197,24,0.35)',
                }} />

                {/* Header */}
                <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <p style={{
                    fontFamily:    '"JetBrains Mono", monospace',
                    fontSize:      9,
                    color:         '#f5c518',
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    marginBottom:  6,
                  }}>
                    CIRCUIT_GEN / INPUT
                  </p>
                  <h2 style={{
                    fontFamily:    "'Barlow Condensed', sans-serif",
                    fontWeight:    900,
                    fontSize:      22,
                    color:         '#ffffff',
                    textTransform: 'uppercase',
                    letterSpacing: '-0.01em',
                    display:       'inline-block',
                    transform:     'skewX(-4deg)',
                  }}>
                    {trackData ? 'Switch User' : 'Generate Your Track'}
                  </h2>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ padding: '16px 20px 20px' }}>
                  <label style={{
                    fontFamily:    '"JetBrains Mono", monospace',
                    fontSize:      8,
                    color:         '#71717a',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    display:       'block',
                    marginBottom:  8,
                  }}>
                    GitHub Username
                  </label>

                  <div style={{ position: 'relative', marginBottom: 14 }}>
                    <span style={{
                      position:      'absolute',
                      left:          12,
                      top:           '50%',
                      transform:     'translateY(-50%)',
                      fontFamily:    '"JetBrains Mono", monospace',
                      fontSize:      13,
                      color:         '#f5c518',
                      fontWeight:    700,
                      pointerEvents: 'none',
                    }}>@</span>

                    <input
                      ref={inputRef}
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="torvalds"
                      disabled={loading}
                      autoComplete="off"
                      spellCheck={false}
                      style={{
                        width:         '100%',
                        background:    'rgba(255,255,255,0.04)',
                        border:        `1px solid ${error ? '#ef4444' : 'rgba(255,255,255,0.12)'}`,
                        color:         '#ffffff',
                        fontFamily:    '"JetBrains Mono", monospace',
                        fontSize:      14,
                        fontWeight:    700,
                        padding:       '10px 12px 10px 28px',
                        outline:       'none',
                        letterSpacing: '0.04em',
                      }}
                      onFocus={(e) => {
                        if (!error) e.currentTarget.style.borderColor = 'rgba(245,197,24,0.5)'
                      }}
                      onBlur={(e) => {
                        if (!error) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                      }}
                    />
                  </div>

                  {error && (
                    <p style={{
                      fontFamily:    '"JetBrains Mono", monospace',
                      fontSize:      9,
                      color:         '#ef4444',
                      letterSpacing: '0.1em',
                      marginBottom:  12,
                    }}>
                      ✕ {error}
                    </p>
                  )}

                  {justLoaded && weather && (
                    <div style={{
                      marginBottom: 12,
                      padding:      '8px 12px',
                      background:   'rgba(163,230,53,0.06)',
                      border:       '1px solid rgba(163,230,53,0.2)',
                      display:      'flex',
                      alignItems:   'center',
                      gap:          10,
                    }}>
                      <span style={{ fontSize: 16 }}>✓</span>
                      <div>
                        <p style={{
                          fontFamily:    '"JetBrains Mono", monospace',
                          fontSize:      9,
                          color:         '#a3e635',
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                        }}>
                          Track generated — {trackData?.track_points.length} pts
                        </p>
                        <p style={{
                          fontFamily:    '"JetBrains Mono", monospace',
                          fontSize:      8,
                          color:         weather.color,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          marginTop:     2,
                        }}>
                          WEATHER: {weather.label} — {weather.desc}
                        </p>
                      </div>
                    </div>
                  )}

                  <motion.button
                    type="submit"
                    disabled={!username.trim() || loading}
                    whileHover={!loading && username.trim() ? { x: -2, y: -2, boxShadow: '6px 6px 0 #8b6914' } : {}}
                    whileTap={!loading && username.trim()  ? { x: 1,  y: 1,  boxShadow: '2px 2px 0 #8b6914' } : {}}
                    style={{
                      width:          '100%',
                      fontFamily:     '"JetBrains Mono", monospace',
                      fontWeight:     900,
                      fontSize:       11,
                      letterSpacing:  '0.22em',
                      textTransform:  'uppercase',
                      color:          username.trim() && !loading ? '#111111' : '#52525b',
                      background:     username.trim() && !loading ? '#f5c518' : 'rgba(255,255,255,0.05)',
                      border:         '2px solid',
                      borderColor:    username.trim() && !loading ? '#8b6914' : 'rgba(255,255,255,0.08)',
                      padding:        '11px 0',
                      cursor:         !username.trim() || loading ? 'not-allowed' : 'pointer',
                      boxShadow:      username.trim() && !loading ? '4px 4px 0 #8b6914' : 'none',
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'center',
                      gap:            8,
                      transition:     'background 0.15s, color 0.15s, border-color 0.15s',
                    }}
                  >
                    {loading ? <><Spinner /> FETCHING GITHUB DATA...</> : '▶  BUILD CIRCUIT'}
                  </motion.button>

                  <p style={{
                    fontFamily:    '"JetBrains Mono", monospace',
                    fontSize:      8,
                    color:         '#3f3f46',
                    letterSpacing: '0.1em',
                    textAlign:     'center',
                    marginTop:     10,
                  }}>
                    Reads public GitHub API · No auth required · Set GITHUB_TOKEN for higher rate limits
                  </p>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

function Spinner() {
  return (
    <span style={{
      display:      'inline-block',
      width:        10,
      height:       10,
      border:       '2px solid rgba(255,255,255,0.2)',
      borderTop:    '2px solid #ffffff',
      borderRadius: '50%',
      animation:    'spin 0.7s linear infinite',
    }} />
  )
}
