# Neural Grand Prix — CLAUDE.md

## Project Overview

Full-stack monorepo: a data visualization web app that generates 3D Formula 1 circuits from GitHub commit history using a custom VAE deep learning model.

## Repo Structure

```
f1project/
├── frontend/          # React 19 + Vite 8 + TypeScript
└── backend/           # Python + FastAPI + PyTorch
```

## Frontend

**Stack:** React 19, Vite 8, TypeScript, Tailwind CSS v4, Three.js r183, @react-three/fiber v9, @react-three/drei

**Start dev server:**
```bash
cd frontend && npm run dev       # runs on http://localhost:5173
```

**Build:**
```bash
cd frontend && npm run build
```

**Component conventions:**
- `src/components/3d/` — React Three Fiber scene components
- `src/components/stitch-ui/` — Google Stitch imported components (do not modify)
- Keep R3F scene logic inside `TrackCanvas.tsx`; lift geometry/material into named sub-components

**Tailwind v4 notes:**
- No `tailwind.config.js` — configured via `@theme {}` block in `src/index.css`
- Plugin wired via `@tailwindcss/vite` in `vite.config.ts`
- Do not run `npx tailwindcss init`

**Design system** (`src/index.css`):
- Dark-mode only (`color-scheme: dark`, bg `#0a0a0f`)
- Aesthetic: Onitsuka Tiger / Stussy minimalism × Persona 4 Golden diagonal energy
- Monospace-first (JetBrains Mono)
- Key CSS vars: `--color-volta` (gold #f5c518), `--color-redline`, `--color-azure`, `--color-neon`
- Utility classes: `.panel`, `.stripe`, `.card-cut`, `.label`, `.btn-volta`, `.canvas-wrap`

## Backend

**Stack:** Python 3.11+, FastAPI, PyTorch, FastF1, uvicorn

**Start dev server:**
```bash
cd backend && uvicorn main:app --reload   # runs on http://localhost:8000
```

**Install dependencies:**
```bash
cd backend && pip install -r requirements.txt
```

**API endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| POST | `/api/generate` | `{ github_username, seed? }` → circuit spline |
| GET | `/api/sample` | Random prior sample → circuit spline |

**VAE architecture** (`backend/models/vae.py`):
- `INPUT_DIM=128` → `HIDDEN=256` → `LATENT_DIM=64` → `N_POINTS=64 × 3`
- Weights loaded from `backend/checkpoints/circuit_vae.pt` if present
- Falls back to random weights gracefully (scaffold mode)
- Set `GITHUB_TOKEN` env var to avoid GitHub API rate limits

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `GITHUB_TOKEN` | backend | GitHub API auth (avoids 60 req/hr limit) |
| `MODEL_PATH` | backend | Override VAE checkpoint path |

## Skills

This project uses the `frontend-design` skill (`.claude/skills/frontend-design.md`) — invoke it when building new UI components to enforce the project's design standards and avoid generic aesthetics.

## Code Style

- TypeScript: strict mode, no `any`, prefer `const`
- Python: type hints on all function signatures, `snake_case`
- No commented-out code, no TODO comments (open an issue instead)
- Keep R3F components pure — no side effects outside `useEffect`/`useMemo`
