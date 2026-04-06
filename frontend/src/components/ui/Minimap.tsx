import { useEffect, useRef, useMemo } from 'react'
import * as THREE from 'three'
import monacoPoints from '@/data/monaco'
import { useTrack } from '@/context/TrackContext'

// Must match TrackCanvas.tsx exactly
const TRACK_SCALE_H = 100

const SIZE = 200  // canvas px
const PAD  = 14   // pixel padding on every side

// ── Build sampled minimap points from current track data ─────────────────────
function buildSampledPoints(
  trackPoints: { x: number; y: number; z: number }[] | null
): [number, number][] {
  const vectors: THREE.Vector3[] =
    trackPoints && trackPoints.length > 0
      ? trackPoints.map(({ x, z }) => new THREE.Vector3(x * TRACK_SCALE_H, 0, z * TRACK_SCALE_H))
      : monacoPoints.map(([x, _y, z]) => new THREE.Vector3(x * TRACK_SCALE_H, 0, z * TRACK_SCALE_H))

  const curve = new THREE.CatmullRomCurve3(vectors, true, 'centripetal', 0.1)

  const points: [number, number][] = []
  for (let i = 0; i < 600; i++) {
    const p = curve.getPointAt(i / 600)
    // Store in data-unit space so px() mapping matches car-position events
    points.push([p.x / TRACK_SCALE_H, p.z / TRACK_SCALE_H])
  }
  return points
}

// ── Minimap ───────────────────────────────────────────────────────────────────
export default function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotRef    = useRef({ x: 0, z: 0 })
  const { trackData } = useTrack()

  // Rebuild sampled track + coordinate mapping whenever trackData changes
  const { sampledPoints, scale, offX, offZ } = useMemo(() => {
    const points = buildSampledPoints(trackData?.track_points ?? null)

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const [sx, sz] of points) {
      if (sx < minX) minX = sx
      if (sx > maxX) maxX = sx
      if (sz < minZ) minZ = sz
      if (sz > maxZ) maxZ = sz
    }
    const rangeX = maxX - minX || 1
    const rangeZ = maxZ - minZ || 1
    const sc  = Math.min((SIZE - PAD * 2) / rangeX, (SIZE - PAD * 2) / rangeZ)
    const ox  = (SIZE - rangeX * sc) / 2 - minX * sc
    const oz  = (SIZE - rangeZ * sc) / 2 - minZ * sc

    return { sampledPoints: points, scale: sc, offX: ox, offZ: oz }
  }, [trackData])

  // Coordinate transform: data-unit → canvas pixel
  // Defined as stable closure using primitive deps (no new fn ref each render)
  const px = (x: number, z: number): [number, number] => [
    x * scale + offX,
    z * scale + offZ,
  ]

  // ── Listen for car world-space position, convert to data-unit space ─────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { x, z } = (e as CustomEvent<{ x: number; z: number }>).detail
      dotRef.current = { x: x / TRACK_SCALE_H, z: z / TRACK_SCALE_H }
    }
    window.addEventListener('car-position', handler)
    return () => window.removeEventListener('car-position', handler)
  }, [])

  // ── Rebuild static track image + restart draw loop when track changes ────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // ── Pre-render neon track line onto an offscreen canvas ───────────────────
    const offscreen        = document.createElement('canvas')
    offscreen.width        = SIZE
    offscreen.height       = SIZE
    const oc               = offscreen.getContext('2d')!

    const drawLine = (lineWidth: number, color: string) => {
      oc.beginPath()
      for (let i = 0; i < sampledPoints.length; i++) {
        const [cx, cz] = px(sampledPoints[i][0], sampledPoints[i][1])
        if (i === 0) oc.moveTo(cx, cz)
        else         oc.lineTo(cx, cz)
      }
      oc.closePath()
      oc.strokeStyle = color
      oc.lineWidth   = lineWidth
      oc.lineJoin    = 'round'
      oc.lineCap     = 'round'
      oc.stroke()
    }

    // Soft outer glow
    drawLine(8, 'rgba(0, 212, 255, 0.12)')
    // Mid glow
    drawLine(4, 'rgba(0, 212, 255, 0.35)')
    // Crisp neon core
    drawLine(1.5, 'rgba(0, 212, 255, 0.95)')

    // ── rAF draw loop: blit offscreen + animated dot ─────────────────────────
    let rafId: number

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.drawImage(offscreen, 0, 0)

      const { x, z } = dotRef.current
      const [cx, cz] = px(x, z)

      // Outermost pulse ring
      ctx.beginPath()
      ctx.arc(cx, cz, 9, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(245, 197, 24, 0.15)'
      ctx.fill()

      // Mid glow ring
      ctx.beginPath()
      ctx.arc(cx, cz, 5.5, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(245, 197, 24, 0.55)'
      ctx.fill()

      // Core dot — gold (#f5c518)
      ctx.beginPath()
      ctx.arc(cx, cz, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#f5c518'
      ctx.fill()

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampledPoints, scale, offX, offZ])

  return (
    <div
      style={{
        position:        'absolute',
        top:             20,
        left:            '50%',
        transform:       'translateX(-50%)',
        zIndex:          1000,
        width:           SIZE,
        height:          SIZE,
        background:      'rgba(0, 0, 0, 0.60)',
        backdropFilter:  'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border:          '1px solid rgba(34, 211, 238, 0.50)',
        borderTop:       '2px solid rgba(34, 211, 238, 0.80)',
        overflow:        'hidden',
        pointerEvents:   'none',
        boxShadow:       '0 0 24px rgba(34,211,238,0.25), 0 0 6px rgba(34,211,238,0.15), inset 0 0 40px rgba(0,0,0,0.6)',
        filter:          'drop-shadow(0 0 8px rgba(34,211,238,0.30))',
      }}
    >
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        style={{ display: 'block' }}
      />
      {/* Label */}
      <div style={{
        position:    'absolute',
        bottom:      6,
        left:        0,
        right:       0,
        textAlign:   'center',
        fontFamily:  "'IBM Plex Mono', monospace",
        fontSize:    '7px',
        letterSpacing: '0.18em',
        color:       'rgba(0, 212, 255, 0.5)',
        textTransform: 'uppercase',
        pointerEvents: 'none',
      }}>
        {trackData?.username ? `@${trackData.username}` : 'CIRCUIT'}
      </div>
    </div>
  )
}
