import { useEffect, useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const LINE_COUNT = 80
const MAX_SPEED  = 3.0   // must match DrivableCar

// Pre-allocated — zero GC in useFrame
const _rollQuat = new THREE.Quaternion()
const _rollAxis = new THREE.Vector3(0, 0, 1)  // camera local Z = roll axis

// ─────────────────────────────────────────────────────────────────────────────
// SpeedLines — manga-style radial action lines in camera space.
// Invisible at rest; full opacity + spin at MAX_SPEED.
// Follows the camera each frame so they always read as screen-space streaks.
// ─────────────────────────────────────────────────────────────────────────────
export default function SpeedLines() {
  const groupRef  = useRef<THREE.Group>(null)
  const matRef    = useRef<THREE.LineBasicMaterial>(null)
  const speedRef  = useRef(0)
  const rollAngle = useRef(0)

  // Receive car speed from DrivableCar event
  useEffect(() => {
    const handler = (e: Event) => {
      speedRef.current = (e as CustomEvent<{ speed: number }>).detail.speed
    }
    window.addEventListener('car-speed', handler)
    return () => window.removeEventListener('car-speed', handler)
  }, [])

  // 80 radial line segments: near point close to camera, far point deep ahead.
  // Lines at varying radii create the "tunnel of streaks" perspective.
  const geometry = useMemo(() => {
    const positions = new Float32Array(LINE_COUNT * 6)
    for (let i = 0; i < LINE_COUNT; i++) {
      const φ   = (i / LINE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.25
      const r   = 1.5 + Math.random() * 11     // radius from centre (screen edge variety)
      const len = 5   + Math.random() * 14     // streak depth (shorter near edge)
      const x   = Math.cos(φ) * r
      const y   = Math.sin(φ) * r
      // Near vertex — just inside near clip plane
      positions[i * 6 + 0] = x;   positions[i * 6 + 1] = y;   positions[i * 6 + 2] = -1.5
      // Far vertex
      positions[i * 6 + 3] = x;   positions[i * 6 + 4] = y;   positions[i * 6 + 5] = -(1.5 + len)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geo
  }, [])

  useFrame(({ camera }, delta) => {
    if (!groupRef.current || !matRef.current) return

    const t = Math.min(Math.abs(speedRef.current) / MAX_SPEED, 1)

    // Fade opacity in with speed (invisible at 0, 0.75 at top speed)
    matRef.current.opacity = t * 0.75

    // Slowly spin around the camera's forward axis — adds energy at high speed
    rollAngle.current += t * delta * 0.6
    groupRef.current.position.copy(camera.position)
    groupRef.current.quaternion.copy(camera.quaternion)
    _rollQuat.setFromAxisAngle(_rollAxis, rollAngle.current)
    groupRef.current.quaternion.multiply(_rollQuat)
  })

  return (
    <group ref={groupRef}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          ref={matRef}
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  )
}
