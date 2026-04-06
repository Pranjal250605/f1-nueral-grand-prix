import { useEffect, useRef } from 'react'

export interface PlayerControls {
  forward:  boolean
  backward: boolean
  left:     boolean
  right:    boolean
}

/**
 * Tracks physical key state via event.code (layout-independent).
 * Returns a ref so consumers inside useFrame read it without re-renders.
 */
export function usePlayerControls() {
  const keys = useRef<PlayerControls>({
    forward:  false,
    backward: false,
    left:     false,
    right:    false,
  })

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
        e.preventDefault()
      }
      switch (e.code) {
        case 'KeyW':     case 'ArrowUp':    keys.current.forward  = true; break
        case 'KeyS':     case 'ArrowDown':  keys.current.backward = true; break
        case 'KeyA':     case 'ArrowLeft':  keys.current.left     = true; break
        case 'KeyD':     case 'ArrowRight': keys.current.right    = true; break
      }
    }

    const up = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':     case 'ArrowUp':    keys.current.forward  = false; break
        case 'KeyS':     case 'ArrowDown':  keys.current.backward = false; break
        case 'KeyA':     case 'ArrowLeft':  keys.current.left     = false; break
        case 'KeyD':     case 'ArrowRight': keys.current.right    = false; break
      }
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup',   up)
    }
  }, [])

  return keys
}
