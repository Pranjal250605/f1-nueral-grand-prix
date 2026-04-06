import { Suspense, useMemo, useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import NeonTrack        from './NeonTrack'
import DrivableCar      from './DrivableCar'
import FloatingDust     from './FloatingDust'
import SpeedLines     from './SpeedLines'
import RainEffect, { LightningOverlay } from './RainEffect'
import monacoPoints   from '@/data/monaco'
import Minimap        from '@/components/ui/Minimap'
import LapPopup       from '@/components/ui/LapPopup'
import { useTrack }   from '@/context/TrackContext'

const TRACK_SCALE_H = 100
const TRACK_SCALE_V = 17

const WEATHER_FOG = {
  CLEAR: { color: '#0a0005', near: 80, far: 250 },
  FOG:   { color: '#06000a', near: 50, far: 180 },
  STORM: { color: '#020204', near: 25, far: 130 },
} as const

// Skybox — texture darkened to ~25% so city shapes show but seams disappear.
// The CSS halftone + vignette layers hide any remaining inconsistencies.
function CyberpunkSkybox() {
  const skyMap  = useTexture('/cyberpunk_360.jpg')
  const { gl }  = useThree()
  const meshRef = useRef<THREE.Mesh>(null)

  useEffect(() => {
    skyMap.anisotropy = gl.capabilities.getMaxAnisotropy()
    skyMap.needsUpdate = true
  }, [skyMap, gl])

  useFrame(({ camera }) => {
    if (meshRef.current) meshRef.current.position.copy(camera.position)
  })
  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <sphereGeometry args={[500, 60, 40]} />
      <meshBasicMaterial map={skyMap} color="#cccccc" side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  )
}

function Scene() {
  const { trackData } = useTrack()
  const fogRef = useRef<THREE.Fog>(null)

  const curve = useMemo(() => {
    let vectors: THREE.Vector3[]

    if (trackData?.track_points && trackData.track_points.length > 0) {
      vectors = trackData.track_points.map(
        ({ x, y, z }) => new THREE.Vector3(x * TRACK_SCALE_H, y * TRACK_SCALE_V, z * TRACK_SCALE_H),
      )
    } else {
      vectors = monacoPoints.map(
        ([x, y, z]) => new THREE.Vector3(x * TRACK_SCALE_H, y * TRACK_SCALE_V, z * TRACK_SCALE_H),
      )
    }

    return new THREE.CatmullRomCurve3(vectors, true, 'centripetal', 0.1)
  }, [trackData])

  const weather = trackData?.weather ?? 'CLEAR'
  const fog     = WEATHER_FOG[weather]

  useEffect(() => {
    if (fogRef.current) {
      fogRef.current.color.set(fog.color)
      fogRef.current.near = fog.near
      fogRef.current.far  = fog.far
    }
  }, [fog])

  return (
    <>
      <Suspense fallback={null}>
        <CyberpunkSkybox />
      </Suspense>

      <fog ref={fogRef as any} attach="fog" args={['#0a0005', 80, 250]} />

      <Environment preset="dawn" />
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 8, 0]}    color="#ffffff" intensity={0.3} />
      <pointLight position={[-10, 4, -6]} color="#1a1050" intensity={1.0} />

      <NeonTrack curve={curve} />
      <DrivableCar curve={curve} />
      <FloatingDust />
      <SpeedLines />
      <RainEffect />

      <gridHelper args={[4000, 200, '#ff00ff', '#1a0524']} position={[0, -2, 0]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[10000, 10000]} />
        <meshStandardMaterial color="#050510" roughness={1} metalness={0} />
      </mesh>
    </>
  )
}

const CAMERA_CONFIG = { position: [0, 4, 8] as [number, number, number], fov: 75, near: 0.1, far: 5000 }
const DPR_CONFIG: [number, number] = [1, 2]
const GL_CONFIG = {
  antialias:           true,
  toneMapping:         THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.4,
}

export default function TrackCanvas() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        camera={CAMERA_CONFIG}
        dpr={DPR_CONFIG}
        gl={GL_CONFIG}
        style={{ filter: 'saturate(1.4) contrast(1.08)' }}
      >
        <Scene />
      </Canvas>

      {/* ── Spider-Verse layered CSS treatment ─────────────────────────────────
          All layers use pure alpha compositing (no mix-blend-mode, no opacity
          animation) so Chrome's WebGL compositor is never disturbed.        */}

      {/* Ben-Day magenta halftone — primary comic dot layer */}
      <div style={{
        position:        'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, rgba(210,0,90,0.32) 1.5px, transparent 1.5px)',
        backgroundSize:  '7px 7px',
        pointerEvents:   'none',
        zIndex:          1,
      }} />

      {/* Cyan secondary halftone — CMYK offset, creates ink-print depth */}
      <div style={{
        position:           'absolute', inset: 0,
        backgroundImage:    'radial-gradient(circle, rgba(0,200,255,0.18) 1.2px, transparent 1.2px)',
        backgroundSize:     '9px 9px',
        backgroundPosition: '4.5px 4.5px',
        pointerEvents:      'none',
        zIndex:             2,
      }} />

      {/* Diagonal speed lines — Into the Spider-Verse action energy */}
      <div style={{
        position:        'absolute', inset: 0,
        backgroundImage: 'repeating-linear-gradient(-45deg, transparent 0px, transparent 18px, rgba(255,255,255,0.035) 18px, rgba(255,255,255,0.035) 19px)',
        pointerEvents:   'none',
        zIndex:          3,
      }} />

      {/* Hard angular vignette — rectangular, not soft ellipse */}
      <div style={{
        position:  'absolute', inset: 0,
        background: [
          'linear-gradient(to right,  rgba(0,0,0,0.88) 0,   rgba(0,0,0,0.35) 9%,  transparent 22%, transparent 78%, rgba(0,0,0,0.35) 91%, rgba(0,0,0,0.88) 100%)',
          'linear-gradient(to bottom, rgba(0,0,0,0.75) 0,   rgba(0,0,0,0.18) 7%,  transparent 18%, transparent 82%, rgba(0,0,0,0.18) 93%, rgba(0,0,0,0.75) 100%)',
        ].join(', '),
        pointerEvents: 'none',
        zIndex:        4,
      }} />

      {/* Corner black cut — top-left */}
      <div style={{ position:'absolute', top:0, left:0, width:160, height:160, background:'rgba(0,0,0,0.72)', clipPath:'polygon(0 0,100% 0,0 100%)', pointerEvents:'none', zIndex:5 }} />
      {/* Corner black cut — top-right */}
      <div style={{ position:'absolute', top:0, right:0, width:160, height:160, background:'rgba(0,0,0,0.72)', clipPath:'polygon(0 0,100% 0,100% 100%)', pointerEvents:'none', zIndex:5 }} />
      {/* Corner black cut — bottom-left */}
      <div style={{ position:'absolute', bottom:0, left:0, width:160, height:160, background:'rgba(0,0,0,0.72)', clipPath:'polygon(0 0,0 100%,100% 100%)', pointerEvents:'none', zIndex:5 }} />
      {/* Corner black cut — bottom-right */}
      <div style={{ position:'absolute', bottom:0, right:0, width:160, height:160, background:'rgba(0,0,0,0.72)', clipPath:'polygon(100% 0,0 100%,100% 100%)', pointerEvents:'none', zIndex:5 }} />

      {/* Color bleed — magenta left strip */}
      <div style={{ position:'absolute', top:0, left:0, width:3, height:'100%', background:'linear-gradient(to bottom, #D32F2F, #ff006e, #D32F2F)', pointerEvents:'none', zIndex:6 }} />
      {/* Color bleed — cyan right strip */}
      <div style={{ position:'absolute', top:0, right:0, width:3, height:'100%', background:'linear-gradient(to bottom, #00d4ff, #0044ff, #00d4ff)', pointerEvents:'none', zIndex:6 }} />

      {/* Top bar — bold red → magenta → gold */}
      <div style={{
        position:      'absolute', top:0, left:0,
        width:         '100%', height: 5,
        background:    'linear-gradient(90deg, #D32F2F 0%, #ff006e 35%, #f5c518 65%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none',
        zIndex:        7,
      }} />
      {/* Bottom bar — cyan */}
      <div style={{
        position:      'absolute', bottom:0, left:0,
        width:         '100%', height: 3,
        background:    'linear-gradient(90deg, rgba(0,0,0,0) 0%, #00d4ff 50%, #0044ff 100%)',
        pointerEvents: 'none',
        zIndex:        7,
      }} />

      <Minimap />
      <LapPopup />
      <LightningOverlay />
    </div>
  )
}
