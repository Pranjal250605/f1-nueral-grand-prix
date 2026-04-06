import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ── Road geometry constants ───────────────────────────────────────────────────
const ROAD_WIDTH    = 24         // Scaled down to match TRACK_SCALE_H=100 to prevent overlapping corners
const ROAD_HALF     = ROAD_WIDTH / 2
const ROAD_DEPTH    = 2.0        // slab thickness, visible from the track-side
const KERB_RADIUS   = 0.6        // Thinner neon tubes to match the narrower track
const KERB_Y_OFFSET = 0.8        // Kerbs sit closer to the ground
const SEGMENTS      = 1000       // tessellation for the longer scaled curve

// Pre-allocated vectors — zero GC inside builders
const _up    = new THREE.Vector3(0, 1, 0)
const _point = new THREE.Vector3()
const _tan   = new THREE.Vector3()
const _right = new THREE.Vector3()

// Custom curve efficiently offsets a base curve without creating dense CurvePaths
class OffsetCurve extends THREE.Curve<THREE.Vector3> {
  baseCurve: THREE.CatmullRomCurve3
  offset: number

  constructor(baseCurve: THREE.CatmullRomCurve3, offset: number) {
    super()
    this.baseCurve = baseCurve
    this.offset = offset
  }

  getPoint(t: number, optionalTarget = new THREE.Vector3()) {
    this.baseCurve.getPoint(t, _point)
    this.baseCurve.getTangent(t, _tan).normalize()
    _right.crossVectors(_tan, _up).normalize()
    return optionalTarget.set(
      _point.x + _right.x * this.offset,
      _point.y + KERB_Y_OFFSET,
      _point.z + _right.z * this.offset
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// buildAsphaltRibbon
// Solid slab: top face + bottom face + left/right skirts.
// Manual BufferGeometry — guaranteed upward normals, no Frenet-frame flips.
// ─────────────────────────────────────────────────────────────────────────────
function buildAsphaltRibbon(curve: THREE.CatmullRomCurve3): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv:  number[] = []
  const idx: number[] = []

  // === Top face ===
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    curve.getPoint(t, _point)
    curve.getTangent(t, _tan).normalize()
    _right.crossVectors(_tan, _up).normalize()

    pos.push(_point.x - _right.x * ROAD_HALF, _point.y,              _point.z - _right.z * ROAD_HALF)
    nor.push(0, 1, 0)
    uv.push(0, t * 20)

    pos.push(_point.x + _right.x * ROAD_HALF, _point.y,              _point.z + _right.z * ROAD_HALF)
    nor.push(0, 1, 0)
    uv.push(1, t * 20)
  }

  const topVerts = (SEGMENTS + 1) * 2

  // === Bottom face ===
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    curve.getPoint(t, _point)
    curve.getTangent(t, _tan).normalize()
    _right.crossVectors(_tan, _up).normalize()

    pos.push(_point.x - _right.x * ROAD_HALF, _point.y - ROAD_DEPTH, _point.z - _right.z * ROAD_HALF)
    nor.push(0, -1, 0)
    uv.push(0, t * 20)

    pos.push(_point.x + _right.x * ROAD_HALF, _point.y - ROAD_DEPTH, _point.z + _right.z * ROAD_HALF)
    nor.push(0, -1, 0)
    uv.push(1, t * 20)
  }

  // Top indices
  for (let i = 0; i < SEGMENTS; i++) {
    const b = i * 2
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
  }

  // Bottom indices (winding reversed)
  for (let i = 0; i < SEGMENTS; i++) {
    const b = topVerts + i * 2
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
  }

  // === Left skirt ===
  const sLL = pos.length / 3
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    curve.getPoint(t, _point)
    curve.getTangent(t, _tan).normalize()
    _right.crossVectors(_tan, _up).normalize()
    const lx = _point.x - _right.x * ROAD_HALF
    const lz = _point.z - _right.z * ROAD_HALF
    pos.push(lx, _point.y,              lz); nor.push(-_right.x, 0, -_right.z); uv.push(0, t * 20)
    pos.push(lx, _point.y - ROAD_DEPTH, lz); nor.push(-_right.x, 0, -_right.z); uv.push(1, t * 20)
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const b = sLL + i * 2
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
  }

  // === Right skirt ===
  const sRL = pos.length / 3
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    curve.getPoint(t, _point)
    curve.getTangent(t, _tan).normalize()
    _right.crossVectors(_tan, _up).normalize()
    const rx = _point.x + _right.x * ROAD_HALF
    const rz = _point.z + _right.z * ROAD_HALF
    pos.push(rx, _point.y,              rz); nor.push(_right.x, 0, _right.z); uv.push(0, t * 20)
    pos.push(rx, _point.y - ROAD_DEPTH, rz); nor.push(_right.x, 0, _right.z); uv.push(1, t * 20)
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const b = sRL + i * 2
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,  2))
  geo.setIndex(idx)
  return geo
}

// ─────────────────────────────────────────────────────────────────────────────
// buildEdgeCurve (removed in favor of OffsetCurve for massive performance gain)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// NeonTrack
// ─────────────────────────────────────────────────────────────────────────────
export default function NeonTrack({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const leftKerbRef  = useRef<THREE.Mesh>(null)
  const rightKerbRef = useRef<THREE.Mesh>(null)

  const { asphaltGeo, leftGeo, rightGeo } = useMemo(() => {
    const asphaltGeo = buildAsphaltRibbon(curve)
    
    // Evaluate geometric offsets dynamically without heavily-nested paths
    const leftPath  = new OffsetCurve(curve, -ROAD_HALF)
    const rightPath = new OffsetCurve(curve, ROAD_HALF)

    const leftGeo  = new THREE.TubeGeometry(leftPath,  1000, KERB_RADIUS, 8, true)
    const rightGeo = new THREE.TubeGeometry(rightPath, 1000, KERB_RADIUS, 8, true)

    return { asphaltGeo, leftGeo, rightGeo }
  }, [curve])

  // Heartbeat pulse on kerbs — "live circuit" feel
  useFrame(({ clock }) => {
    const intensity = 2.5 + Math.sin(clock.getElapsedTime() * 1.4) * 0.8
    for (const ref of [leftKerbRef, rightKerbRef]) {
      if (ref.current) {
        (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity
      }
    }
  })

  return (
    <group>

      {/* ── Solid asphalt slab — meshBasicMaterial: no lighting dependency, no black patches ── */}
      <mesh geometry={asphaltGeo} name="Asphalt">
        <meshBasicMaterial color="#1c1c1c" side={THREE.DoubleSide} />
      </mesh>

      {/* ── Left kerb outline ── */}
      <mesh geometry={leftGeo} scale={[1.18, 1.18, 1.18]}>
        <meshBasicMaterial color="#000000" side={THREE.BackSide} />
      </mesh>
      {/* ── Left kerb — cyberpunk cyan neon tube ── */}
      <mesh ref={leftKerbRef} geometry={leftGeo}>
        <meshStandardMaterial color="#111111" emissive="#00ffff" emissiveIntensity={2.5} toneMapped={false} roughness={0.1} metalness={0.8} />
      </mesh>

      {/* ── Right kerb outline ── */}
      <mesh geometry={rightGeo} scale={[1.18, 1.18, 1.18]}>
        <meshBasicMaterial color="#000000" side={THREE.BackSide} />
      </mesh>
      {/* ── Right kerb — cyberpunk cyan neon tube ── */}
      <mesh ref={rightKerbRef} geometry={rightGeo}>
        <meshStandardMaterial color="#111111" emissive="#00ffff" emissiveIntensity={2.5} toneMapped={false} roughness={0.1} metalness={0.8} />
      </mesh>

      {/* ── Reflective ground plane ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -ROAD_DEPTH - 0.01, 0]}>
        <planeGeometry args={[10000, 10000]} />
        <meshStandardMaterial color="#050505" roughness={0.15} metalness={0.8} />
      </mesh>

    </group>
  )
}
