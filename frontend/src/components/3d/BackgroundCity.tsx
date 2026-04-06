import { useMemo } from 'react'

interface Building {
  x:         number
  z:         number
  h:         number
  w:         number
  d:         number
  neonColor: string | null
}

const NEON_COLORS = ['#00d4ff', '#ff00ff', '#a3e635', '#eab308'] as const

// ─────────────────────────────────────────────────────────────────────────────
// BackgroundCity
// 120 skyscrapers in a distant ring (800–1 300 units from origin) that looms
// over the horizon as the car moves.  World is now ~1 600 × 2 000 units wide,
// so buildings must be placed far outside the track to avoid clipping.
// Heights 50–250 units make them visible against the dawn sky from any point.
// ─────────────────────────────────────────────────────────────────────────────
export default function BackgroundCity() {
  const buildings = useMemo<Building[]>(() =>
    Array.from({ length: 120 }, (_, i) => {
      const angle  = (i / 120) * Math.PI * 2 + Math.sin(i * 2.3) * 0.35
      const radius = 1500 + Math.abs(Math.sin(i * 1.71 + 0.5)) * 1000  // 1 500–2 500
      return {
        x:         Math.cos(angle) * radius,
        z:         Math.sin(angle) * radius,
        h:         1000,                                                // fixed tall slab
        w:         20  + Math.abs(Math.sin(i * 5.70))        * 50,     // 20–70
        d:         20  + Math.abs(Math.sin(i * 4.23 + 2.0))  * 50,    // 20–70
        neonColor: i % 5 === 0 ? NEON_COLORS[i % 4] : null,
      }
    }), [])

  return (
    <group>
      {buildings.map(({ x, z, h, w, d, neonColor }, i) => (
        <group key={i} position={[x, -400, z]}>

          {/* Dark glass tower — mesh centre at h/2 so base sits at group Y */}
          <mesh position={[0, h / 2, 0]}>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color="#060608" roughness={0.85} metalness={0.25} />
          </mesh>

          {/* Neon window strip — fixed at ~60 units above ground (world Y≈-340) */}
          {neonColor !== null && (
            <mesh position={[0, 460, d / 2 + 0.1]}>
              <boxGeometry args={[w * 0.75, 1.8, 0.15]} />
              <meshStandardMaterial
                color={neonColor}
                emissive={neonColor}
                emissiveIntensity={4}
                roughness={0.1}
              />
            </mesh>
          )}

        </group>
      ))}
    </group>
  )
}
