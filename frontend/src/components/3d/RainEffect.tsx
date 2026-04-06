import { useRef, useMemo, useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useTrack } from '@/context/TrackContext'

// ── Per-weather config ────────────────────────────────────────────────────────
const RAIN_CFG = {
  FOG: {
    count:     700,
    speed:     0.55,
    spread:    110,
    streakLen: 1.0,
    opacity:   0.22,
    color:     '#99aacc',
    wind:      0.03,
  },
  STORM: {
    count:     2800,
    speed:     2.8,
    spread:    150,
    streakLen: 2.8,
    opacity:   0.48,
    color:     '#aabbdd',
    wind:      0.12,
  },
} as const

type Weather = 'CLEAR' | 'FOG' | 'STORM'
type ActiveWeather = 'FOG' | 'STORM'

// ── Main export — mounts nothing for CLEAR ────────────────────────────────────
export default function RainEffect() {
  const { trackData } = useTrack()
  const weather = (trackData?.weather ?? 'CLEAR') as Weather
  if (weather === 'CLEAR') return null
  // key forces full remount when weather tier changes
  return <RainStreaks key={weather} weather={weather as ActiveWeather} />
}

// ── Rain streak geometry ──────────────────────────────────────────────────────
function RainStreaks({ weather }: { weather: ActiveWeather }) {
  const cfg = RAIN_CFG[weather]
  const { camera } = useThree()
  const geoRef = useRef<THREE.BufferGeometry>(null)

  // Each drop = 2 vertices (line segment top → bottom)
  const { positions, speeds } = useMemo(() => {
    const pos = new Float32Array(cfg.count * 6)
    const spd = new Float32Array(cfg.count)
    const cam = camera.position

    for (let i = 0; i < cfg.count; i++) {
      const x = cam.x + (Math.random() - 0.5) * cfg.spread
      const y = cam.y + Math.random() * 55
      const z = cam.z + (Math.random() - 0.5) * cfg.spread
      pos[i * 6 + 0] = x
      pos[i * 6 + 1] = y
      pos[i * 6 + 2] = z
      pos[i * 6 + 3] = x + cfg.wind * cfg.streakLen
      pos[i * 6 + 4] = y - cfg.streakLen
      pos[i * 6 + 5] = z
      spd[i] = cfg.speed * (0.6 + Math.random() * 0.8)
    }
    return { positions: pos, speeds: spd }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg])

  useEffect(() => {
    if (!geoRef.current) return
    geoRef.current.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  }, [positions])

  useFrame(() => {
    if (!geoRef.current) return
    const pos = geoRef.current.attributes.position?.array as Float32Array | undefined
    if (!pos) return
    const cam = camera.position

    for (let i = 0; i < cfg.count; i++) {
      const base = i * 6
      // Fall
      pos[base + 1] -= speeds[i]
      pos[base + 4] -= speeds[i]
      // Wind drift
      pos[base + 0] += cfg.wind * 0.04
      pos[base + 3] += cfg.wind * 0.04

      // Reset when bottom vertex passes below camera
      if (pos[base + 4] < cam.y - 22) {
        const x = cam.x + (Math.random() - 0.5) * cfg.spread
        const z = cam.z + (Math.random() - 0.5) * cfg.spread
        const y = cam.y + 40 + Math.random() * 15
        pos[base + 0] = x
        pos[base + 1] = y
        pos[base + 2] = z
        pos[base + 3] = x + cfg.wind * cfg.streakLen
        pos[base + 4] = y - cfg.streakLen
        pos[base + 5] = z
      }
    }
    geoRef.current.attributes.position.needsUpdate = true
  })

  return (
    <lineSegments>
      <bufferGeometry ref={geoRef} />
      <lineBasicMaterial
        color={cfg.color}
        transparent
        opacity={cfg.opacity}
        depthWrite={false}
      />
    </lineSegments>
  )
}

// ── DOM lightning flash — exported separately, rendered outside <Canvas> ──────
// Fires random white flashes on STORM; nothing on FOG / CLEAR.
export function LightningOverlay() {
  const { trackData } = useTrack()
  const [flash, setFlash] = useState(0)  // 0 = off, > 0 = opacity
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (trackData?.weather !== 'STORM') return

    const schedule = () => {
      // Gap between strikes: 4–18 s
      const gap = 4000 + Math.random() * 14000
      timerRef.current = setTimeout(() => {
        // 1–3 rapid flickers per strike
        const flickers = Math.floor(Math.random() * 3) + 1
        let delay = 0
        for (let f = 0; f < flickers; f++) {
          setTimeout(() => setFlash(0.55 + Math.random() * 0.35), delay)
          delay += 60 + Math.random() * 60
          setTimeout(() => setFlash(0), delay)
          delay += 40 + Math.random() * 60
        }
        schedule()
      }, gap)
    }

    schedule()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [trackData?.weather])

  if (!flash) return null

  return (
    <div
      style={{
        position:       'fixed',
        inset:          0,
        background:     `rgba(180, 200, 255, ${flash})`,
        pointerEvents:  'none',
        zIndex:         50,
        mixBlendMode:   'screen',
      }}
    />
  )
}
