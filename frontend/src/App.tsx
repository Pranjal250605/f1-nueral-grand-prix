import { useState } from 'react'
import './index.css'
import { TrackProvider } from './context/TrackContext'
import TrackCanvas     from './components/3d/TrackCanvas'
import DashboardLayout from './components/stitch-ui/DashboardLayout'
import PersonaIntro    from './components/ui/PersonaIntro'

type Phase = 'intro' | 'preload' | 'ready'

export default function App() {
  const [phase, setPhase] = useState<Phase>('intro')

  return (
    <TrackProvider>
      <div className="relative w-screen h-screen overflow-hidden bg-black">

        {/*
          Canvas lifecycle — three phases to avoid the WebGL black-screen bug:
          ┌─────────┬──────────────────────────┬───────────────────────────────┐
          │ Phase   │ Canvas in DOM?           │ Why                           │
          ├─────────┼──────────────────────────┼───────────────────────────────┤
          │ intro   │ No                       │ Compositor conflict with the  │
          │         │                          │ fixed-overlay shards causes   │
          │         │                          │ black frames on WebGL canvas  │
          ├─────────┼──────────────────────────┼───────────────────────────────┤
          │ preload │ Yes — visibility:hidden  │ Canvas compiles shaders while │
          │         │                          │ overlay animates off-screen;  │
          │         │                          │ hidden so no compositor clash │
          ├─────────┼──────────────────────────┼───────────────────────────────┤
          │ ready   │ Yes — visible            │ Overlay fully gone; no clash  │
          └─────────┴──────────────────────────┴───────────────────────────────┘
        */}
        {phase !== 'intro' && (
          <div
            className="fixed inset-0 z-0"
            style={{ visibility: phase === 'ready' ? 'visible' : 'hidden' }}
          >
            <TrackCanvas />
          </div>
        )}

        {/* Dashboard — only after intro */}
        {phase === 'ready' && <DashboardLayout />}

        {/* Intro overlay — unmounted once canvas is ready */}
        {phase !== 'ready' && (
          <PersonaIntro
            onStart={()    => setPhase('preload')}
            onComplete={()  => setPhase('ready')}
          />
        )}

      </div>
    </TrackProvider>
  )
}
