# Neural Grand Prix

A full-stack data visualisation web app that converts any GitHub user's commit history into a unique 3D Formula 1 circuit using procedural generation and a custom Variational Autoencoder.

**Live Demo:** [f1-nueral-grand-prix.vercel.app](https://f1-nueral-grand-prix.vercel.app)  
**Backend API:** [f1-nueral-grand-prix-production.up.railway.app](https://f1-nueral-grand-prix-production.up.railway.app)

---

## How It Works

1. Enter any GitHub username
2. The backend fetches live GitHub stats via 5 parallel API calls
3. Stats are mapped to track physics parameters (complexity, smoothness, weather)
4. A procedural path-walking algorithm generates 64 3D control points
5. A CatmullRom spline interpolates them into a smooth closed circuit
6. The circuit is rendered in Three.js with a drivable car, neon kerbs, and dynamic weather
7. As you drive, Claude streams live F1 pit-wall commentary

---

## Architecture

```
f1project/
├── frontend/          # React 19 + Vite 8 + TypeScript + Three.js
└── backend/           # Python 3.11 + FastAPI + PyTorch VAE
```

---

## Tech Stack

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| React | 19.2.4 | UI framework |
| TypeScript | 5.9.3 | Type safety |
| Vite | 8.0.1 | Build tool & dev server |
| Three.js | 0.183.2 | 3D rendering engine |
| @react-three/fiber | 9.5.0 | React renderer for Three.js |
| @react-three/drei | 10.7.7 | Three.js helpers & utilities |
| Tailwind CSS | 4.2.2 | Utility-first CSS |
| Framer Motion | 12.38.0 | Animations |

### Backend

| Technology | Version | Purpose |
|---|---|---|
| Python | 3.11+ | Runtime |
| FastAPI | 0.111.0+ | API framework |
| PyTorch | 2.0+ | Deep learning (VAE) |
| NumPy | 1.26.0+ | Numerical computation |
| httpx | 0.27.0+ | Async GitHub API calls |
| Anthropic SDK | 0.31.0+ | Claude AI commentary |
| gTTS | 2.5.0+ | Text-to-speech |
| uvicorn | 0.29.0+ | ASGI server |

---

## Deep Learning Model

### Variational Autoencoder (VAE)

Located in `backend/models/vae.py`. The `CircuitVAE` is a generative model that learns a compressed latent representation of F1 circuit geometry.

**Architecture:**

```
Input: [B, 128]  ← encoded GitHub commit-feature vector

Encoder
  Linear(128 → 256) → LayerNorm → SiLU
  Linear(256 → 256) → LayerNorm → SiLU
    ├─ fc_mu:      Linear(256 → 64)   ← mean μ
    └─ fc_log_var: Linear(256 → 64)   ← log variance

Reparameterisation
  z = μ + ε·σ,  ε ~ N(0, I)          ← differentiable sampling

Decoder
  Linear(64 → 256) → LayerNorm → SiLU
  Linear(256 → 256) → LayerNorm → SiLU
  Linear(256 → 192)
  reshape → [B, 64, 3]               ← 64 3D control points
```

| Hyperparameter | Value |
|---|---|
| INPUT_DIM | 128 |
| LATENT_DIM | 64 |
| HIDDEN_DIM | 256 |
| N_POINTS | 64 |

**Loss function (β-VAE ELBO):**
```
L = MSE(pred, target) + β · KL(N(μ,σ²) ‖ N(0,I))
KL = -0.5 · mean(1 + log_var - μ² - exp(log_var))
```

**Design choices:**
- `SiLU` (Swish) activation — smoother gradients than ReLU for regression
- `LayerNorm` instead of BatchNorm — correct at batch size 1 during inference
- β-VAE support — β > 1 disentangles the latent space

### Conditional VAE (CVAE)

Located in `backend/models/cvae.py`. The `ConditionalCircuitVAE` extends the VAE by conditioning generation on track physics parameters.

**Architecture:**

```
Encoder: Input [B, 192] (flattened 64×3 circuit points)
  Linear(192 → 256) → LayerNorm → SiLU
  Linear(256 → 256) → LayerNorm → SiLU
    ├─ fc_mu:      Linear(256 → 32)
    └─ fc_log_var: Linear(256 → 32)

Decoder: Input z[B,32] ⊕ cond[B,2] = [B, 34]
  Linear(34 → 256) → LayerNorm → SiLU
  Linear(256 → 256) → LayerNorm → SiLU
  Linear(256 → 192) → reshape [B, 64, 3]
```

| Hyperparameter | Value |
|---|---|
| LATENT_DIM | 32 |
| HIDDEN_DIM | 256 |
| N_POINTS | 64 |
| COND_DIM | 2 (complexity, smoothness) |
| SCALE_XZ | 26.0 |
| SCALE_Y | 1.6 |

> **Note:** The CVAE was trained on 10 synthetic circuits. The active generation path uses the procedural algorithm below, which produces more differentiated layouts than the current CVAE checkpoint.

---

## GitHub Stats → Track Parameters

The backend fetches 5 GitHub API endpoints in parallel and maps them to physics parameters:

| GitHub Stat | Track Parameter | Formula |
|---|---|---|
| Stars (total) | Complexity (45%) | `min(1, log(stars+1) / log(10000))` |
| Commits (recent pushes) | Complexity (35%) | `min(1, log(commits+1) / log(500))` |
| Public repos | Complexity (20%) | `min(1, log(repos+1) / log(100))` |
| Closed issue ratio | Smoothness (0–1) | `closed / (open + closed)` |
| Open issue ratio | Weather | `<10%` → CLEAR, `10–30%` → FOG, `≥30%` → STORM |
| Top 3 languages | Accent colours | Mapped via github-linguist colour table |

**Complexity formula:**
```python
complexity = star_score * 0.45 + commit_score * 0.35 + repo_score * 0.20
```

**Username → Seed:** `SHA-256(username.lower())[:8]` — same username always generates the same track.

---

## Procedural Track Generation

The path-walking algorithm (`_walk_circuit`) builds F1-style circuits with genuine sector variety:

**Corner budget:**
```
n_corners = max(3, round(3 + complexity^1.5 * 13))   → 3 to 16 corners
hairpin_prob = 0.05 + complexity * 0.30
chicane_prob = complexity * 0.20
```

**Geometry:**
- Perimeter target: 120 world units
- Span target: `25 + complexity * 30` units (25 → 55)
- 3-octave elevation noise, amplitude = `complexity * 1.4`
- Arc-length resampled to exactly 64 equidistant output points
- CatmullRomCurve3 (closed, centripetal, tension 0.1) on the frontend

---

## Weather System

| Weather | Open Issue % | Fog Near | Fog Far | Fog Colour |
|---|---|---|---|---|
| CLEAR | < 10% | 80 | 250 | #0a0005 |
| FOG | 10–30% | 50 | 180 | #06000a |
| STORM | ≥ 30% | 25 | 130 | #020204 |

STORM triggers dynamic rain particles and lightning overlay.

---

## 3D Scene

### Track Rendering (`NeonTrack.tsx`)

| Constant | Value |
|---|---|
| ROAD_WIDTH | 24 units |
| ROAD_DEPTH | 2.0 units |
| KERB_RADIUS | 0.6 units |
| SEGMENTS | 1000 tessellation points |

- Asphalt ribbon: `meshBasicMaterial` #1c1c1c, custom UV-mapped geometry
- Neon kerbs: `TubeGeometry` on offset curves (±12 units), cyan #00ffff, emissive intensity 2.5
- Pulse animation: `intensity = 2.5 + sin(t × 1.4) × 0.8` per frame

### Car Physics (`DrivableCar.tsx`)

| Constant | Value |
|---|---|
| MAX_SPEED | 3.0 world units/frame |
| ACCELERATION | 0.03 units/frame |
| FRICTION | 0.96× per frame |
| TURN_SPEED | 0.025 rad/frame |
| RIDE_HEIGHT | 0.5 units above surface |

- Surface hover: downward raycast from +20 units, aligns car normal to track face
- Dynamic FOV: `75 + (speed / MAX_SPEED) × 15` degrees
- Camera roll: ±0.04 rad into corners, lerp 0.08
- Lap detection: 15-unit finish sphere, 12s minimum lap time
- Sector boundaries: t < 0.34 → S1, t < 0.67 → S2, t ≥ 0.67 → S3

### Camera

```
Position:   [0, 4, 8]  (chase, local to car)
FOV:        75° base → up to 90° at top speed
Near/Far:   0.1 / 5000
Tone map:   ACESFilmic, exposure 1.4
DPR:        [1, 2]
```

---

## AI Commentary (PitWall)

Powered by `claude-haiku-4-5-20251001` via Server-Sent Events:

- Triggers on each sector crossing fired by `DrivableCar`
- Streams 2-sentence F1 commentary weaving GitHub identity into race narrative
- Typed out character-by-character at 28ms/char
- Spoken via gTTS (British accent) decoded through Web Audio API
- Graceful degradation: static template if `ANTHROPIC_API_KEY` absent

---

## API Reference

### `GET /`
Health check.
```json
{ "service": "Neural Grand Prix — Git-to-Track API", "status": "ok", "version": "2.0.0" }
```

### `GET /api/track/{username}`
Full pipeline. Returns track geometry + stats.
```json
{
  "username": "torvalds",
  "weather": "CLEAR",
  "track_points": [{ "x": 0.0, "y": 0.0, "z": 0.0 }, "...×64"],
  "colors": ["#3572A5", "#f1e05a"],
  "stats": {
    "total_commits": 412, "total_stars": 18500,
    "open_issues": 12, "closed_issues": 340,
    "top_languages": ["C", "Python"],
    "complexity": 0.8821, "smoothness": 0.9657
  }
}
```

### `POST /api/commentary`
Stream SSE commentary. Request body:
```json
{
  "username": "torvalds", "commits": 412, "stars": 18500,
  "languages": ["C"], "complexity": 0.88, "smoothness": 0.96,
  "weather": "CLEAR", "sector": 1, "speed_level": "HIGH", "lap": 2
}
```

### `POST /api/tts`
Convert text to MP3.
```json
{ "text": "Commentary sentence here." }
```
Returns `audio/mpeg`. Returns `204` if gTTS not installed.

---

## Environment Variables

### Backend (Railway)
| Variable | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | Recommended | Raises rate limit from 60 to 5000 req/hr |
| `ANTHROPIC_API_KEY` | Optional | Enables live Claude commentary |
| `CORS_ORIGINS` | Optional | Allowed origins (default `*`) |

### Frontend (Vercel)
| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | Yes | Backend base URL, e.g. `https://...railway.app` |

---

## Running Locally

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env          # fill in GITHUB_TOKEN
uvicorn main:app --reload     # http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```
The Vite dev server proxies `/api/*` → `http://localhost:8000` automatically.

---

## Deployment

| Service | Platform | Config file |
|---|---|---|
| Frontend | Vercel | `frontend/vercel.json` |
| Backend | Railway | `backend/railway.toml` |
| Docker (self-host) | Any | `docker-compose.yml` |

```bash
# Self-host with Docker
cp backend/.env.example backend/.env
docker compose up --build
# Frontend → http://localhost:80
# Backend  → http://localhost:8000
```

---

## Design System

Dark-mode only. Aesthetic: Onitsuka Tiger / Stussy minimalism × Persona 4 Golden diagonal energy × Spider-Verse comic treatment.

| Token | Value | Usage |
|---|---|---|
| `--color-volta` | #f5c518 | Gold accent, UI highlights |
| `--color-redline` | #D32F2F | Danger, rear wing |
| `--color-azure` | #00d4ff | Cyan, right kerb |
| `--color-neon` | #a3e635 | Status indicators |

**Typefaces:** JetBrains Mono (monospace UI), Barlow Condensed (telemetry values)

**Spider-Verse CSS layers:** Ben-Day halftone (magenta 7px + cyan 9px offset), diagonal speed lines, hard angular vignette, corner black cuts, colour-bleed strips.

---

## Project Structure

```
f1project/
├── backend/
│   ├── main.py                 # FastAPI app, all endpoints, generation pipeline
│   ├── requirements.txt
│   ├── models/
│   │   ├── vae.py              # CircuitVAE (β-VAE, INPUT_DIM=128, LATENT=64)
│   │   └── cvae.py             # ConditionalCircuitVAE (LATENT=32, COND=2)
│   ├── checkpoints/
│   │   └── circuit_vae.pt      # Trained weights (~1 MB)
│   ├── Dockerfile
│   ├── railway.toml
│   └── nixpacks.toml
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── 3d/
│   │   │   │   ├── TrackCanvas.tsx     # Main R3F scene
│   │   │   │   ├── DrivableCar.tsx     # Car physics + camera
│   │   │   │   ├── NeonTrack.tsx       # Asphalt + neon kerbs
│   │   │   │   ├── FloatingDust.tsx    # 2000-point dust system
│   │   │   │   ├── SpeedLines.tsx      # Speed line effect
│   │   │   │   └── RainEffect.tsx      # Storm weather particles
│   │   │   ├── ui/
│   │   │   │   ├── PitWall.tsx         # AI commentary + TTS
│   │   │   │   ├── Minimap.tsx         # 2D track minimap
│   │   │   │   ├── LapPopup.tsx        # Lap time notification
│   │   │   │   └── UsernameModal.tsx   # GitHub username input
│   │   │   └── stitch-ui/
│   │   │       ├── TelemetryCard.tsx   # GitHub stats display
│   │   │       ├── DashboardLayout.tsx # Panel layout
│   │   │       └── CommitTicker.tsx    # Live commit ticker
│   │   ├── context/
│   │   │   └── TrackContext.tsx        # Global track state
│   │   └── hooks/
│   │       └── usePlayerControls.ts   # WASD / arrow key input
│   ├── Dockerfile
│   ├── nginx.conf
│   └── vercel.json
└── docker-compose.yml
```

---

## Author

**Pranjal Rai** — [github.com/Pranjal250605](https://github.com/Pranjal250605)
