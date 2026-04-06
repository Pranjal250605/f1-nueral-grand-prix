/**
 * PitWall — AI Race Commentator with Voice
 *
 * Listens for 'sector-crossed' events fired by DrivableCar.
 * Streams 2-sentence F1 commentary from /api/commentary via SSE.
 * Types it out character-by-character, then speaks it via gTTS
 * served from /api/tts — works in every browser including Brave.
 *
 * Audio is decoded through Web Audio API (AudioContext) so it is
 * never blocked by the browser's autoplay policy — the context is
 * unlocked on the first keydown (which happens before the car moves).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTrack } from '@/context/TrackContext'

const _BASE          = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const API_COMMENTARY = `${_BASE}/api/commentary`
const API_TTS        = `${_BASE}/api/tts`

const LINGER_MS     = 14_000
const CHAR_DELAY_MS = 28

type SectorEvent = { sector: number; speedLevel: string; lap: number }

// ── Shared AudioContext (module-level — survives re-renders) ──────────────────
// New Audio() is blocked by autoplay policy when called asynchronously.
// AudioContext.resume() after a user gesture unlocks it permanently for the
// session, so we unlock on first keydown (which precedes any sector crossing).
let _audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext ?? (window as Record<string,unknown>)['webkitAudioContext'] as typeof AudioContext)()
  }
  return _audioCtx
}

async function unlockAudioCtx() {
  try {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') await ctx.resume()
  } catch { /* ignore */ }
}

// ── TTS via gTTS backend ───────────────────────────────────────────────────────
async function speakText(text: string, muted: boolean): Promise<void> {
  if (muted || !text.trim()) return
  try {
    const res = await fetch(API_TTS, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    })
    // 204 = gTTS not installed on server, 4xx/5xx = error
    if (!res.ok || res.status === 204) {
      console.warn('[PitWall] TTS unavailable — run: pip install gtts')
      return
    }

    const ctx      = getAudioCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    const arrayBuf = await res.arrayBuffer()
    const audioBuf = await ctx.decodeAudioData(arrayBuf)

    const src = ctx.createBufferSource()
    src.buffer             = audioBuf
    src.playbackRate.value = 1.08   // commentator energy
    src.connect(ctx.destination)
    src.start(0)
  } catch (err) {
    console.warn('[PitWall TTS]', err)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PitWall() {
  const { trackData }             = useTrack()
  const [text,      setText]      = useState('')
  const [visible,   setVisible]   = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [muted,     setMuted]     = useState(false)

  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typeTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef    = useRef<AbortController | null>(null)
  const bufferRef   = useRef('')
  const typedRef    = useRef('')
  const mutedRef    = useRef(false)

  useEffect(() => { mutedRef.current = muted }, [muted])

  // Unlock AudioContext on first keydown so audio plays without restriction
  useEffect(() => {
    const unlock = () => unlockAudioCtx()
    window.addEventListener('keydown',     unlock, { once: true })
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => {
      window.removeEventListener('keydown',     unlock)
      window.removeEventListener('pointerdown', unlock)
    }
  }, [])

  const clearLinger     = () => { if (lingerTimer.current) { clearTimeout(lingerTimer.current); lingerTimer.current = null } }
  const clearTypewriter = () => { if (typeTimer.current)   { clearTimeout(typeTimer.current);   typeTimer.current   = null } }

  const tickTypewriter = useCallback((doneStreaming: boolean) => {
    clearTypewriter()
    const next = bufferRef.current[typedRef.current.length]
    if (next === undefined) {
      if (doneStreaming) {
        speakText(bufferRef.current, mutedRef.current)
        setStreaming(false)
        clearLinger()
        lingerTimer.current = setTimeout(() => setVisible(false), LINGER_MS)
      } else {
        typeTimer.current = setTimeout(() => tickTypewriter(false), 40)
      }
      return
    }
    typedRef.current += next
    setText(typedRef.current)
    typeTimer.current = setTimeout(
      () => tickTypewriter(doneStreaming && typedRef.current.length >= bufferRef.current.length),
      CHAR_DELAY_MS
    )
  }, [])

  const fetchCommentary = useCallback(async (detail: SectorEvent) => {
    if (!trackData) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    clearLinger()
    clearTypewriter()

    bufferRef.current = ''
    typedRef.current  = ''
    setText('')
    setVisible(true)
    setStreaming(true)
    tickTypewriter(false)

    try {
      const res = await fetch(API_COMMENTARY, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  abortRef.current.signal,
        body: JSON.stringify({
          username:    trackData.username,
          commits:     trackData.stats.total_commits,
          stars:       trackData.stats.total_stars,
          languages:   trackData.stats.top_languages,
          complexity:  trackData.stats.complexity,
          smoothness:  trackData.stats.smoothness,
          weather:     trackData.weather,
          sector:      detail.sector,
          speed_level: detail.speedLevel,
          lap:         detail.lap,
        }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const token = line.slice(6)
          if (token === '[DONE]') break
          bufferRef.current += token
        }
      }
      tickTypewriter(true)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setStreaming(false)
    }
  }, [trackData, tickTypewriter])

  useEffect(() => {
    const handler = (e: Event) => fetchCommentary((e as CustomEvent<SectorEvent>).detail)
    window.addEventListener('sector-crossed', handler)
    return () => {
      window.removeEventListener('sector-crossed', handler)
      abortRef.current?.abort()
      clearLinger()
      clearTypewriter()
    }
  }, [fetchCommentary])

  const toggleMute = () => setMuted(m => !m)

  if (!visible) return null

  return (
    <div
      style={{
        position:      'fixed',
        bottom:        96,
        left:          8,
        width:         272,
        zIndex:        600,
        pointerEvents: 'auto',
        animation:     'pitwall-enter 0.28s cubic-bezier(0.22,1,0.36,1) both',
      }}
    >
      <style>{`
        @keyframes pitwall-enter {
          from { transform: translateY(14px); opacity: 0; }
          to   { transform: none; opacity: 1; }
        }
        @keyframes pitwall-cursor {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0; }
        }
      `}</style>

      <div style={{
        background:           'rgba(0,0,0,0.82)',
        backdropFilter:       'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border:               '1px solid rgba(245,197,24,0.30)',
        borderLeft:           '3px solid #f5c518',
        boxShadow:            '0 0 24px rgba(245,197,24,0.12), 0 8px 32px rgba(0,0,0,0.8)',
      }}>

        {/* Header */}
        <div style={{
          display:      'flex',
          alignItems:   'center',
          gap:           7,
          padding:      '7px 10px 6px 12px',
          borderBottom: '1px solid rgba(245,197,24,0.15)',
          background:   'rgba(245,197,24,0.06)',
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
            <rect x="3" y="0" width="4" height="6" rx="2" fill="#f5c518"/>
            <path d="M1.5 5.5a3.5 3.5 0 0 0 7 0" stroke="#f5c518" strokeWidth="1" fill="none"/>
            <line x1="5" y1="9" x2="5" y2="7" stroke="#f5c518" strokeWidth="1"/>
          </svg>

          <span style={{
            fontFamily:    '"JetBrains Mono", monospace',
            fontSize:       8,
            color:         '#f5c518',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            fontWeight:     700,
            flex:           1,
          }}>
            PIT WALL LIVE
          </span>

          {streaming && (
            <span style={{
              width:        6,
              height:       6,
              borderRadius: '50%',
              background:   '#f5c518',
              animation:    'pitwall-cursor 0.8s ease-in-out infinite',
              flexShrink:   0,
            }} />
          )}

          <button
            onClick={toggleMute}
            title={muted ? 'Unmute commentary' : 'Mute commentary'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '2px 4px', marginLeft: 4,
              opacity: muted ? 0.4 : 0.85, transition: 'opacity 0.15s', flexShrink: 0,
            }}
          >
            {muted ? (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 4.5h2l3-3v10l-3-3H1V4.5Z" fill="#f5c518"/>
                <line x1="9" y1="4" x2="12" y2="9"  stroke="#f5c518" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="12" y1="4" x2="9" y2="9"  stroke="#f5c518" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 4.5h2l3-3v10l-3-3H1V4.5Z" fill="#f5c518"/>
                <path d="M8.5 4.5a3 3 0 0 1 0 4"    stroke="#f5c518" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                <path d="M10 2.5a5.5 5.5 0 0 1 0 8" stroke="#f5c518" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        </div>

        {/* Commentary text */}
        <div style={{ padding: '10px 12px 11px' }}>
          <p style={{
            fontFamily:    "'Barlow Condensed', sans-serif",
            fontWeight:     600,
            fontSize:       14,
            color:         '#f0f0f0',
            lineHeight:     1.45,
            margin:         0,
            letterSpacing: '0.01em',
          }}>
            {text}
            {streaming && (
              <span style={{
                display:       'inline-block',
                width:          2,
                height:         13,
                background:    '#f5c518',
                marginLeft:     2,
                verticalAlign: 'middle',
                animation:     'pitwall-cursor 0.6s step-end infinite',
              }} />
            )}
          </p>
        </div>

      </div>
    </div>
  )
}
