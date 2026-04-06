import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirrors backend Pydantic schemas exactly
// ─────────────────────────────────────────────────────────────────────────────
export interface TrackStats {
  total_commits:  number
  total_stars:    number
  open_issues:    number
  closed_issues:  number
  top_languages:  string[]
  complexity:     number   // 0–1
  smoothness:     number   // 0–1
}

export interface TrackData {
  username:     string
  weather:      'CLEAR' | 'FOG' | 'STORM'
  track_points: { x: number; y: number; z: number }[]
  colors:       string[]
  stats:        TrackStats
}

interface TrackState {
  trackData:  TrackData | null
  loading:    boolean
  error:      string | null
  fetchTrack: (username: string) => Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────
const TrackContext = createContext<TrackState | null>(null)

export function TrackProvider({ children }: { children: ReactNode }) {
  const [trackData, setTrackData] = useState<TrackData | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const fetchTrack = useCallback(async (username: string) => {
    setLoading(true)
    setError(null)
    try {
      const base = import.meta.env.VITE_API_URL ?? ''
      const res = await fetch(
        `${base}/api/track/${encodeURIComponent(username.trim())}`,
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { detail?: string }
        throw new Error(body.detail ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as TrackData
      setTrackData(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <TrackContext.Provider value={{ trackData, loading, error, fetchTrack }}>
      {children}
    </TrackContext.Provider>
  )
}

export function useTrack(): TrackState {
  const ctx = useContext(TrackContext)
  if (!ctx) throw new Error('useTrack must be used inside <TrackProvider>')
  return ctx
}
