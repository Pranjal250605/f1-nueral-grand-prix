import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const COUNT       = 2000
const SPREAD_XZ   = 3000   // half-extent in X and Z (world units)
const SPREAD_Y    = 80     // height range above ground
const DRIFT_SPEED = 60     // world units per second (backward along Z)

// ─────────────────────────────────────────────────────────────────────────────
// FloatingDust
// 2000 tiny points scattered across the track bounds, drifting slowly backward
// along +Z each frame.  When driving, the oncoming stream creates the illusion
// of high speed.  No physics interaction — purely visual.
// ─────────────────────────────────────────────────────────────────────────────
export default function FloatingDust() {
  const pointsRef = useRef<THREE.Points>(null)

  const { geometry, initialPositions } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * SPREAD_XZ * 2
      positions[i * 3 + 1] = Math.random() * SPREAD_Y
      positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD_XZ * 2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return { geometry: geo, initialPositions: positions.slice() }
  }, [])

  useFrame((_, delta) => {
    const pts = pointsRef.current
    if (!pts) return
    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr  = attr.array as Float32Array
    const drift = DRIFT_SPEED * delta

    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 2] += drift
      // Wrap: when a particle drifts past +SPREAD_XZ, teleport back to -SPREAD_XZ
      if (arr[i * 3 + 2] > SPREAD_XZ) {
        arr[i * 3 + 2] -= SPREAD_XZ * 2
      }
    }
    attr.needsUpdate = true
  })

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color="#eab308"
        size={1.2}
        sizeAttenuation
        transparent
        opacity={0.35}
        depthWrite={false}
      />
    </points>
  )
}
