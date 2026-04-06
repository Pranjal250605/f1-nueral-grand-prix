import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { usePlayerControls } from '@/hooks/usePlayerControls'

// ── Tuning ────────────────────────────────────────────────────────────────────
const MAX_SPEED    = 3.0    // world units per frame at full throttle
const ACCELERATION = 0.03   // speed added per frame while key held
const FRICTION     = 0.96   // passive speed decay multiplier
const TURN_SPEED   = 0.025  // radians per frame (reduced sensitivity)
const RIDE_HEIGHT  = 0.5    // units above the surface hit point

// ── Pre-allocated vectors — zero GC in useFrame ───────────────────────────────
const _rayOrigin      = new THREE.Vector3()
const _rayDown        = new THREE.Vector3(0, -1, 0)
const _worldUp        = new THREE.Vector3(0, 1, 0)
const _currentUp      = new THREE.Vector3()
const _targetUp       = new THREE.Vector3()
const _alignQuat      = new THREE.Quaternion()
const _idealCamPos    = new THREE.Vector3()
const _prevPosition   = new THREE.Vector3()

// ── Car mesh ──────────────────────────────────────────────────────────────────
// Spider-Verse toon car — flat meshBasicMaterial, no BackSide outlines
// (BackSide technique breaks with the rotation={[Math.PI, Math.PI, 0]} flip)
function CarMesh() {
  return (
    <group rotation={[Math.PI, Math.PI, 0]}>
      {/* Main chassis */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[2.0, 0.5, 4.0]} />
        <meshBasicMaterial color="#f0f0f0" />
      </mesh>

      {/* Cockpit */}
      <mesh position={[0, 0.65, 0.2]}>
        <boxGeometry args={[0.9, 0.4, 1.2]} />
        <meshBasicMaterial color="#d0d0d0" />
      </mesh>

      {/* Front wing headlight strip */}
      <mesh position={[0, 0.05, -2.3]}>
        <boxGeometry args={[2.4, 0.1, 0.5]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3.0} roughness={0.1} metalness={1.0} />
      </mesh>

      {/* Rear wing — Spider-Verse red */}
      <mesh position={[0, 1.0, 1.9]}>
        <boxGeometry args={[1.8, 0.15, 0.4]} />
        <meshBasicMaterial color="#D32F2F" />
      </mesh>

      {/* Wing endplates */}
      {([-0.9, 0.9] as const).map((x) => (
        <mesh key={x} position={[x, 0.65, 1.9]}>
          <boxGeometry args={[0.1, 0.7, 0.45]} />
          <meshBasicMaterial color="#e0e0e0" />
        </mesh>
      ))}

      {/* Wheels */}
      {([[-1.15, 0.0, -1.1], [1.15, 0.0, -1.1], [-1.15, 0.0, 1.1], [1.15, 0.0, 1.1]] as [number,number,number][]).map(([x,y,z], i) => (
        <group key={i} position={[x, y, z]} rotation={[0, 0, Math.PI / 2]}>
          <mesh>
            <cylinderGeometry args={[0.4, 0.4, 0.5, 18]} />
            <meshBasicMaterial color="#1a1a1a" />
          </mesh>
          <mesh>
            <torusGeometry args={[0.3, 0.05, 8, 24]} />
            <meshBasicMaterial color="#cccccc" />
          </mesh>
        </group>
      ))}

      {/* Floor */}
      <mesh position={[0, -0.1, 0]}>
        <boxGeometry args={[1.5, 0.04, 3.6]} />
        <meshBasicMaterial color="#cccccc" />
      </mesh>

      {/* Headlight + fill light */}
      <pointLight position={[0, 0.4, -2.6]} color="#ffffff" intensity={20} distance={60} decay={2} />
      <pointLight position={[0, 4, 0]}       color="#ffffff" intensity={8}  distance={12} decay={2} />

      {/* Taillights */}
      {([-0.55, 0.55] as const).map((x) => (
        <mesh key={x} position={[x, 0.25, 2.1]}>
          <boxGeometry args={[0.35, 0.15, 0.05]} />
          <meshBasicMaterial color="#ff0000" />
        </mesh>
      ))}
    </group>
  )
}

// ── BlobShadow — flat circle underneath the car ───────────────────────────────
function BlobShadow() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
      <circleGeometry args={[2, 32]} />
      <meshBasicMaterial color="#000000" transparent opacity={0.6} depthWrite={false} />
    </mesh>
  )
}

// ── DrivableCar — Kinematic Surface-Hover Engine ──────────────────────────────
// ── Sector-crossing detection helpers ────────────────────────────────────────
// Sampled once at mount; used to find the car's approximate t-value cheaply.
const SECTOR_SAMPLES        = 120   // points to sample along the curve for t-estimation
const SECTOR_CHECK_INTERVAL = 90    // frames between sector checks (~1.5 s at 60 fps)

// Finish-line proximity lap detection
const FINISH_ZONE_RADIUS  = 15     // world units — car must enter this sphere around start
const MIN_LAP_TIME_MS     = 12_000 // 12 s minimum — prevents re-trigger on slow reversal

function buildSectorLookup(curve: THREE.CatmullRomCurve3): THREE.Vector3[] {
  return Array.from({ length: SECTOR_SAMPLES }, (_, i) =>
    curve.getPointAt(i / SECTOR_SAMPLES)
  )
}

function estimateTValue(pos: THREE.Vector3, lut: THREE.Vector3[]): number {
  let best = 0, bestDist = Infinity
  for (let i = 0; i < lut.length; i++) {
    const d = pos.distanceToSquared(lut[i])
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best / SECTOR_SAMPLES
}

// ─────────────────────────────────────────────────────────────────────────────
export default function DrivableCar({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const carRef   = useRef<THREE.Group>(null)
  const controls = usePlayerControls()
  const { scene } = useThree()

  const speed       = useRef(0)
  const cameraRoll  = useRef(0)
  const raycaster   = useRef(new THREE.Raycaster())
  // Cached asphalt mesh — avoids full scene traversal every frame
  const asphaltMesh = useRef<THREE.Mesh | null>(null)

  // Sector / lap tracking refs
  const sectorLut     = useRef<THREE.Vector3[]>([])
  const currentSector = useRef(-1)
  const frameCounter  = useRef(0)
  const lapCount      = useRef(1)

  // Finish-line detection refs
  const finishPos     = useRef(new THREE.Vector3())  // world-space start/finish point
  const inFinishZone  = useRef(true)   // true while car is still in the spawn zone
  const lastCrossMs   = useRef(0)      // Date.now() of last confirmed crossing
  const bestLapMs     = useRef(Infinity)

  useEffect(() => {
    sectorLut.current     = buildSectorLookup(curve)
    currentSector.current = -1
    frameCounter.current  = 0
    lapCount.current      = 1
    inFinishZone.current  = true
    lastCrossMs.current   = Date.now()
    bestLapMs.current     = Infinity
    const p0 = curve.getPointAt(0)
    finishPos.current.set(p0.x, p0.y, p0.z)
  }, [curve])

  // Spawn car at track start, oriented along the track direction
  useEffect(() => {
    if (!carRef.current) return
    const p0 = curve.getPointAt(0)
    const p1 = curve.getPointAt(0.001)
    // Spawn 2 units higher than RIDE_HEIGHT so the car safely drops onto the track
    carRef.current.position.set(p0.x, p0.y + RIDE_HEIGHT + 2.0, p0.z)
    const dx = p1.x - p0.x
    const dz = p1.z - p0.z
    carRef.current.rotation.set(0, Math.atan2(-dx, -dz), 0)
    speed.current = 0
  }, [curve])

  useFrame((state) => {
    if (!carRef.current) return
    const car  = carRef.current
    const ctrl = controls.current

    // ── Save last known safe position before any movement ────────────────────
    _prevPosition.copy(car.position)

    // ── Cache asphalt mesh on first encounter ─────────────────────────────────
    if (!asphaltMesh.current) {
      const obj = scene.getObjectByName('Asphalt')
      if (obj instanceof THREE.Mesh) asphaltMesh.current = obj
    }

    // ── Movement: keyboard control ───────────────────────────────────────────
    if (ctrl.forward)  speed.current = Math.min(speed.current + ACCELERATION,  MAX_SPEED)
    if (ctrl.backward) speed.current = Math.max(speed.current - ACCELERATION, -MAX_SPEED * 0.4)
    speed.current *= FRICTION
    if (Math.abs(speed.current) < 0.001) speed.current = 0

    if (ctrl.left)  car.rotateY(-TURN_SPEED)
    if (ctrl.right) car.rotateY( TURN_SPEED)

    car.translateZ(-speed.current)

    // ── Surface hover raycaster ───────────────────────────────────────────────
    // Cast from 20 units above so the ray succeeds even if the car clips
    // below the surface on a steep section (was +5, which let the car drown).
    _rayOrigin.copy(car.position)
    _rayOrigin.y += 20
    raycaster.current.set(_rayOrigin, _rayDown)

    const hits = asphaltMesh.current
      ? raycaster.current.intersectObject(asphaltMesh.current, false)
      : []

    const trackHit = hits[0] ?? null

    if (trackHit) {
      car.position.y = trackHit.point.y + RIDE_HEIGHT

      const hitNormal = trackHit.face?.normal || _worldUp
      _targetUp
        .copy(hitNormal)
        .transformDirection(trackHit.object.matrixWorld)
        .normalize()
      _currentUp.copy(_worldUp).applyQuaternion(car.quaternion)
      _alignQuat.setFromUnitVectors(_currentUp, _targetUp)
      car.quaternion.premultiply(_alignQuat)
    } else if (asphaltMesh.current) {
      car.position.copy(_prevPosition)
      speed.current *= -0.4
    }

    // ── Chase camera ──────────────────────────────────────────────────────────────
    _idealCamPos.set(0, 3, 8).applyMatrix4(car.matrixWorld)
    _idealCamPos.y = Math.max(_idealCamPos.y, car.position.y + 1)

    if (state.camera.position.distanceTo(_idealCamPos) > 200) {
      state.camera.position.copy(_idealCamPos)
    } else {
      state.camera.position.lerp(_idealCamPos, 0.1)
    }
    state.camera.lookAt(car.position.x, car.position.y + 1, car.position.z)

    // ── Dynamic FOV — warps space at high speed ────────────────────────────────
    const cam       = state.camera as THREE.PerspectiveCamera
    const targetFov = 75 + (Math.abs(speed.current) / MAX_SPEED) * 15
    if (Math.abs(cam.fov - targetFov) > 0.1) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, 0.05)
      cam.updateProjectionMatrix()
    }

    // ── Camera roll — tilt into high-G corners ─────────────────────────────────
    const targetRoll = ctrl.left ? 0.04 : ctrl.right ? -0.04 : 0
    cameraRoll.current = THREE.MathUtils.lerp(cameraRoll.current, targetRoll, 0.08)
    state.camera.rotateZ(cameraRoll.current)

    // ── Finish-line lap detection (every frame, cheap distance check) ────────
    {
      const dist = car.position.distanceTo(finishPos.current)
      const now  = Date.now()

      if (dist > FINISH_ZONE_RADIUS) {
        // Car has left the zone — arm the detector
        inFinishZone.current = false
      } else if (!inFinishZone.current && now - lastCrossMs.current >= MIN_LAP_TIME_MS) {
        // Car re-entered zone after leaving AND minimum lap time elapsed → lap complete
        inFinishZone.current = true
        const lapTimeMs = now - lastCrossMs.current
        lastCrossMs.current = now
        lapCount.current++
        if (lapTimeMs < bestLapMs.current) {
          bestLapMs.current = lapTimeMs
        }
        window.dispatchEvent(new CustomEvent('lap-complete', {
          detail: {
            lap:       lapCount.current,
            lapTimeMs,
            bestLapMs: bestLapMs.current,
          },
        }))
      }
    }

    // ── Sector detection (throttled — drives AI commentary) ──────────────────
    frameCounter.current++
    if (
      frameCounter.current % SECTOR_CHECK_INTERVAL === 0 &&
      sectorLut.current.length > 0 &&
      Math.abs(speed.current) > 0.3
    ) {
      const t      = estimateTValue(car.position, sectorLut.current)
      const sector = t < 0.34 ? 0 : t < 0.67 ? 1 : 2

      if (sector !== currentSector.current) {
        currentSector.current = sector
        const sl = Math.abs(speed.current)
        const speedLevel = sl > MAX_SPEED * 0.66 ? 'HIGH' : sl > MAX_SPEED * 0.33 ? 'MEDIUM' : 'LOW'
        window.dispatchEvent(new CustomEvent('sector-crossed', {
          detail: { sector, speedLevel, lap: lapCount.current },
        }))
      }
    }

    // ── Broadcast position + speed (DOM events — zero React re-renders) ────────
    window.dispatchEvent(
      new CustomEvent('car-position', { detail: { x: car.position.x, z: car.position.z } })
    )
    window.dispatchEvent(
      new CustomEvent('car-speed', { detail: { speed: speed.current } })
    )
  })

  return (
    <group ref={carRef}>
      <CarMesh />
      <BlobShadow />
      {/* ── Soft localized drop shadow under the car (Replaces heavy ContactShadows) ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.48, 0]}>
        <planeGeometry args={[4, 8]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.6} blending={THREE.MultiplyBlending} depthWrite={false} premultipliedAlpha={true} />
      </mesh>
    </group>
  )
}
