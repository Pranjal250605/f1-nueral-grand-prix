"""
Neural Grand Prix — Git-to-Track Backend  (v2.0)
-------------------------------------------------
  GitHub username
      → fetch stats (commits, stars, issues, languages)
      → map stats to physics parameters (complexity, smoothness, weather)
      → generate 3D circuit via trained CVAE  (falls back to procedural)
      → return JSON consumed by the Three.js frontend

Endpoints
---------
  GET  /                            health check
  GET  /api/track/{username}        full Git-to-Track pipeline
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import math
import os
from typing import Any

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ── Optional CVAE (loaded once at startup if checkpoint exists) ───────────────
_CVAE_MODEL = None   # type: ignore[assignment]

def _load_cvae() -> None:
    global _CVAE_MODEL
    ckpt_path = os.path.join(os.path.dirname(__file__), "checkpoints", "circuit_vae.pt")
    if not os.path.exists(ckpt_path):
        return
    try:
        import torch
        from models.cvae import ConditionalCircuitVAE
        model = ConditionalCircuitVAE()
        ckpt  = torch.load(ckpt_path, map_location="cpu", weights_only=True)
        model.load_state_dict(ckpt["state_dict"])
        model.eval()
        _CVAE_MODEL = model
        print(f"[CVAE] Loaded checkpoint (epoch {ckpt.get('epoch', '?')}, "
              f"loss {ckpt.get('best_loss', 0):.5f})")
    except Exception as exc:
        print(f"[CVAE] Could not load checkpoint: {exc} — using procedural fallback")

_load_cvae()

# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Neural Grand Prix — Git-to-Track API",
    version="2.0.0",
    description="Translates a GitHub user's statistics into a unique 3D race circuit.",
)

_cors_origins_env = os.getenv("CORS_ORIGINS", "*")
_cors_origins = (
    ["*"] if _cors_origins_env == "*"
    else [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# ─────────────────────────────────────────────────────────────────────────────
# Language → accent colour map
# Sourced from github-linguist for recognisable brand colours.
# ─────────────────────────────────────────────────────────────────────────────
LANGUAGE_COLOURS: dict[str, str] = {
    "Python":     "#3572A5",
    "JavaScript": "#f1e05a",
    "TypeScript": "#2b7489",
    "Java":       "#b07219",
    "C++":        "#f34b7d",
    "C":          "#555555",
    "C#":         "#178600",
    "Go":         "#00ADD8",
    "Rust":       "#dea584",
    "Ruby":       "#701516",
    "PHP":        "#4F5D95",
    "Swift":      "#ffac45",
    "Kotlin":     "#F18E33",
    "Scala":      "#c22d40",
    "HTML":       "#e34c26",
    "CSS":        "#563d7c",
    "Shell":      "#89e051",
    "Dart":       "#00B4AB",
    "Vue":        "#41b883",
    "Haskell":    "#5e5086",
    "Elixir":     "#6e4a7e",
    "Lua":        "#000080",
    "R":          "#198CE7",
    "Zig":        "#ec915c",
    "Nim":        "#ffc200",
    "Julia":      "#a270ba",
    "MATLAB":     "#e16737",
}
_DEFAULT_COLOUR = "#f5c518"   # design-system --color-volta gold for unknown languages


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic response schemas
# ─────────────────────────────────────────────────────────────────────────────
class Point3D(BaseModel):
    x: float
    y: float
    z: float


class TrackStats(BaseModel):
    total_commits:  int
    total_stars:    int
    open_issues:    int
    closed_issues:  int
    top_languages:  list[str]
    complexity:     float   # 0–1  (track length / control-point density)
    smoothness:     float   # 0–1  (1 = sweeping curves, 0 = sharp hairpins)


class TrackResponse(BaseModel):
    username:     str
    weather:      str        # "CLEAR" | "FOG" | "STORM"
    track_points: list[Point3D]
    colors:       list[str]  # hex accent colours from top languages
    stats:        TrackStats


# ─────────────────────────────────────────────────────────────────────────────
# GitHub API helpers
# ─────────────────────────────────────────────────────────────────────────────
def _gh_headers() -> dict[str, str]:
    """Build GitHub API request headers, injecting a bearer token if available."""
    h = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.getenv("GITHUB_TOKEN")
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def _fetch_github_stats(username: str) -> dict[str, Any]:
    """
    Fire 5 GitHub API calls concurrently and aggregate into a stats dict.

    Parallel requests
    -----------------
    1. /users/{username}                    → public_repos, basic profile
    2. /users/{username}/repos              → stars, primary languages
    3. /search/issues (open, authored)      → open issue count
    4. /search/issues (closed, authored)    → closed issue count
    5. /users/{username}/events/public      → recent push-event commit counts
    """
    headers = _gh_headers()
    base    = "https://api.github.com"

    async with httpx.AsyncClient(timeout=12.0, headers=headers) as client:
        (
            user_r,
            repos_r,
            open_r,
            closed_r,
            events_r,
        ) = await asyncio.gather(
            client.get(f"{base}/users/{username}"),
            client.get(f"{base}/users/{username}/repos?per_page=100&sort=stars"),
            client.get(
                f"{base}/search/issues",
                params={"q": f"author:{username} type:issue state:open", "per_page": 1},
            ),
            client.get(
                f"{base}/search/issues",
                params={"q": f"author:{username} type:issue state:closed", "per_page": 1},
            ),
            client.get(f"{base}/users/{username}/events/public?per_page=100"),
        )

    # ── Validate user ─────────────────────────────────────────────────────────
    if user_r.status_code == 404:
        raise HTTPException(404, detail=f"GitHub user '{username}' not found.")
    if user_r.status_code == 403:
        raise HTTPException(
            429,
            detail=(
                "GitHub API rate limit reached. "
                "Set the GITHUB_TOKEN environment variable to increase the limit."
            ),
        )
    if user_r.status_code != 200:
        raise HTTPException(502, detail=f"GitHub API returned {user_r.status_code}.")

    user_data = user_r.json()

    # ── Parse repos ───────────────────────────────────────────────────────────
    repos: list[dict] = repos_r.json() if repos_r.status_code == 200 else []
    if not isinstance(repos, list):
        repos = []

    total_stars = sum(r.get("stargazers_count", 0) for r in repos)

    # Weight each language by (stars + 1) so popular repos count more
    lang_weight: dict[str, int] = {}
    for r in repos:
        lang = r.get("language")
        if lang:
            lang_weight[lang] = lang_weight.get(lang, 0) + r.get("stargazers_count", 0) + 1
    top_languages: list[str] = sorted(lang_weight, key=lang_weight.get, reverse=True)[:3]  # type: ignore[arg-type]

    # ── Parse issue counts ────────────────────────────────────────────────────
    open_issues   = open_r.json().get("total_count",   0) if open_r.status_code   == 200 else 0
    closed_issues = closed_r.json().get("total_count", 0) if closed_r.status_code == 200 else 0

    # ── Parse commit activity ─────────────────────────────────────────────────
    events: list[dict] = events_r.json() if events_r.status_code == 200 else []
    if not isinstance(events, list):
        events = []

    total_commits = sum(
        len(e.get("payload", {}).get("commits", []))
        for e in events
        if e.get("type") == "PushEvent"
    )

    # Fallback: use public_repos × 3 as a rough proxy when event history is empty
    # (common for users with old or infrequent activity)
    if total_commits == 0:
        total_commits = max(user_data.get("public_repos", 1) * 3, 1)

    return {
        "total_commits":  total_commits,
        "total_stars":    total_stars,
        "public_repos":   max(user_data.get("public_repos", 1), 1),
        "open_issues":    open_issues,
        "closed_issues":  closed_issues,
        "top_languages":  top_languages,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Data → physics mapping
# ─────────────────────────────────────────────────────────────────────────────
def _compute_track_params(stats: dict[str, Any]) -> tuple[float, float, str]:
    """
    Map raw GitHub stats onto three track-physics scalars.

    complexity  [0, 1]
        Drives control-point count and circuit length.
        Derived from star popularity (45 %) + recent commit activity (35 %)
        + public repo count (20 %).  Stars saturate at 10 000, commits at 500,
        repos at 100.  All three use log scaling.

    smoothness  [0, 1]
        1 = wide sweeping curves (healthy repo, lots of closed issues).
        0 = tight hairpins (unhealthy repo, mostly open issues).
        Directly equals the closed-issue ratio.

    weather     "CLEAR" | "FOG" | "STORM"
        Bucketed from the open-issue percentage:
          < 10 %  → CLEAR  (pure neon void)
          10–30 % → FOG    (dense purple fog, reduced visibility)
          ≥ 30 %  → STORM  (glitch / rain effects)
    """
    commits = max(stats["total_commits"], 1)
    stars   = max(stats["total_stars"],   0)
    repos   = max(stats.get("public_repos", 1), 1)

    # Stars: saturate at 10 000 — captures everything from hobbyist to viral OSS project.
    # Commits: saturate at 500 (recent push events, a few weeks of active work).
    # Repos: saturate at 100 — lifetime breadth of contribution.
    #
    # Old formula was 65 % commits / 35 % stars and capped stars at log(1 000),
    # so a developer with 10 000 stars but 30 recent commits got a trivially simple
    # track. New weights give fame (stars) and breadth (repos) equal footing with
    # recent activity.
    commit_score = min(1.0, math.log(commits + 1) / math.log(500))
    star_score   = min(1.0, math.log(stars   + 1) / math.log(10_000))
    repo_score   = min(1.0, math.log(repos   + 1) / math.log(100))

    complexity = min(1.0,
        star_score   * 0.45
        + commit_score * 0.35
        + repo_score   * 0.20,
    )

    # Issue health
    total_issues = stats["open_issues"] + stats["closed_issues"]
    if total_issues == 0:
        smoothness  = 0.75   # assume reasonable default when no issues exist
        open_ratio  = 0.0
    else:
        smoothness  = stats["closed_issues"] / total_issues
        open_ratio  = stats["open_issues"]   / total_issues

    # Weather buckets
    if open_ratio < 0.10:
        weather = "CLEAR"
    elif open_ratio < 0.30:
        weather = "FOG"
    else:
        weather = "STORM"

    return float(complexity), float(smoothness), weather


# ─────────────────────────────────────────────────────────────────────────────
# Procedural track generation
# ─────────────────────────────────────────────────────────────────────────────
def _username_seed(username: str) -> int:
    """Deterministic integer seed from a username — same user always gets same track."""
    return int(hashlib.sha256(username.lower().encode()).hexdigest()[:8], 16)


def _resample_path(pts: np.ndarray, n: int) -> np.ndarray:
    """Arc-length resample an (M,2) path to exactly n points."""
    diffs  = np.diff(pts, axis=0)
    seg_d  = np.sqrt((diffs ** 2).sum(axis=1))
    cumlen = np.concatenate([[0.0], np.cumsum(seg_d)])
    total  = cumlen[-1]
    if total < 1e-6:
        return np.tile(pts[0], (n, 1))
    targets = np.linspace(0.0, total, n, endpoint=False)
    out = np.zeros((n, 2))
    for k, t in enumerate(targets):
        idx = np.searchsorted(cumlen, t, side="right") - 1
        idx = min(idx, len(pts) - 2)
        seg = cumlen[idx + 1] - cumlen[idx]
        frac = (t - cumlen[idx]) / seg if seg > 1e-9 else 0.0
        out[k] = pts[idx] + frac * (pts[idx + 1] - pts[idx])
    return out


def _walk_circuit(
    complexity: float,
    smoothness: float,
    seed: int,
    n_out: int = 64,
) -> list[dict[str, float]]:
    """
    Path-walking circuit generator.

    Builds the circuit by advancing a "turtle" forward and turning it at
    each corner.  Corners are chosen from three classes whose distribution
    is driven by complexity, giving genuinely non-circular F1-style layouts:

      low   complexity → 3-4 gentle 90° turns  (simple oval / hairpin oval)
      mid   complexity → 5-8 mixed corners      (D-shape, L-shape)
      high  complexity → 10-16 corners incl. hairpins and chicanes
    """
    rng = np.random.RandomState(seed)

    # ── Corner budget ─────────────────────────────────────────────────────────
    # n_corners: total turns that sum to ±360°.
    # Uses complexity^1.5 so low-complexity users get genuinely simple shapes.
    n_corners = max(3, round(3 + (complexity ** 1.5) * 13))   # 3 → 16

    # Draw corner sizes from three classes weighted by complexity.
    hairpin_prob = 0.05 + complexity * 0.30   # grows with complexity
    chicane_prob = 0.00 + complexity * 0.20
    # remaining probability → gentle/medium corner

    corners: list[tuple[float, float]] = []   # (turn_deg, radius_scale)
    budget = 360.0

    for i in range(n_corners):
        remaining = n_corners - i
        if remaining == 1:
            t = max(5.0, budget)    # last corner takes whatever remains
            r_scale = 1.0
        else:
            # Cap corner size so enough budget remains for all remaining corners
            max_t = budget - (remaining - 1) * 5.0
            p = rng.random()
            if p < hairpin_prob and max_t >= 100.0:
                t       = min(rng.uniform(160.0, 190.0), max_t)
                r_scale = 0.35 + (1.0 - smoothness) * 0.30
            elif p < hairpin_prob + chicane_prob and max_t >= 20.0:
                t       = min(rng.uniform(20.0, 50.0), max_t)
                r_scale = 0.6
            else:
                t       = min(rng.uniform(20.0, 90.0), max(20.0, max_t))
                r_scale = 0.8 + smoothness * 0.5
            budget -= t
        corners.append((t, r_scale))

    # Normalise to exactly 360°
    total_turn = sum(c[0] for c in corners)
    if abs(total_turn) > 1e-3:
        corners = [(t * 360.0 / total_turn, r) for t, r in corners]

    # ── Straight lengths ──────────────────────────────────────────────────────
    # Base straight length so the total circuit perimeter stays ≈ constant.
    # Complexity → shorter straights (more corners fit in same perimeter).
    perimeter_target = 120.0
    arc_total = sum(math.radians(abs(t)) * (3.0 * r) for t, r in corners)
    straight_share = max(perimeter_target - arc_total, n_corners * 2.0)
    straight_base  = straight_share / n_corners

    # One "main straight" is 1.5–2.5× longer for high-complexity circuits.
    main_idx = int(rng.randint(0, n_corners))

    straights: list[float] = []
    for i in range(n_corners):
        mult = rng.uniform(0.6, 1.4)
        if i == main_idx and complexity > 0.5:
            mult *= rng.uniform(1.5, 2.5)
        straights.append(max(1.5, straight_base * mult))

    # ── Walk ──────────────────────────────────────────────────────────────────
    x, z     = 0.0, 0.0
    heading  = math.pi / 2   # start pointing along +z
    raw_pts: list[tuple[float, float]] = [(x, z)]

    for i, ((turn_deg, r_scale), sl) in enumerate(zip(corners, straights)):
        # Straight
        x += sl * math.cos(heading)
        z += sl * math.sin(heading)
        raw_pts.append((x, z))

        # Corner arc (right-hand circuit)
        t_rad = math.radians(turn_deg)
        arc_r = 3.0 * r_scale
        # Centre of curvature is 90° right of current heading
        ccx = x + arc_r * math.cos(heading - math.pi / 2)
        ccz = z + arc_r * math.sin(heading - math.pi / 2)
        n_arc = max(3, int(turn_deg / 25))
        for j in range(1, n_arc + 1):
            alpha   = -(j / n_arc) * t_rad
            start_a = heading + math.pi / 2
            ax = ccx + arc_r * math.cos(start_a + alpha)
            az = ccz + arc_r * math.sin(start_a + alpha)
            raw_pts.append((ax, az))

        x, z    = raw_pts[-1]
        heading -= t_rad   # right-hand turn

    # No explicit closure here.
    # The frontend uses CatmullRomCurve3(closed=true), which smoothly
    # interpolates from raw_pts[-1] back to raw_pts[0].  Since the walk
    # accumulated exactly 360° of total turning the gap is typically 5-15 %
    # of the circuit perimeter — rendered as a smooth closing section of track.

    # ── Normalise ─────────────────────────────────────────────────────────────
    pts = np.array(raw_pts, dtype=float)
    cx, cz = pts[:, 0].mean(), pts[:, 1].mean()
    pts[:, 0] -= cx
    pts[:, 1] -= cz
    span = max(pts[:, 0].max() - pts[:, 0].min(), pts[:, 1].max() - pts[:, 1].min())
    if span > 1e-6:
        # Complex users get bigger circuits; multiply by TRACK_SCALE_H=100 on frontend.
        span_target = 25.0 + complexity * 30.0   # 25 (simple) → 55 (complex)
        pts *= (span_target / span)

    # ── Resample to n_out equidistant points ─────────────────────────────────
    pts_2d = _resample_path(pts, n_out)

    # ── Elevation ─────────────────────────────────────────────────────────────
    elev_amp  = complexity * 1.4
    t_arr     = np.linspace(0.0, 2.0 * math.pi, n_out, endpoint=False)
    y         = np.zeros(n_out)
    for octave in range(3):
        freq  = float(octave + 1)
        phase = float(rng.uniform(0.0, 2.0 * math.pi))
        y    += elev_amp * (0.5 ** octave) * np.sin(freq * t_arr + phase)

    return [
        {"x": float(pts_2d[i, 0]), "y": float(y[i]), "z": float(pts_2d[i, 1])}
        for i in range(n_out)
    ]


def _procedural_generate(
    complexity: float,
    smoothness: float,
    seed: int,
) -> list[dict[str, float]]:
    """Wrapper — always delegates to the path-walking generator."""
    return _walk_circuit(complexity, smoothness, seed)


def generate_track_points(
    complexity: float,
    smoothness: float,
    seed: int,
) -> list[dict[str, float]]:
    """
    Path-walking circuit generator (primary path).

    The CVAE trained on 10 synthetic circuits didn't learn to differentiate
    complexity — it produced near-circular shapes for all users.  The
    path-walking approach (_walk_circuit) explicitly builds sections
    (straights, corners, hairpins, chicanes) whose counts and radii are
    directly driven by complexity and smoothness, guaranteeing that
    high-complexity users get genuinely F1-like non-circular layouts.
    """
    return _procedural_generate(complexity, smoothness, seed)


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
async def root() -> dict[str, str]:
    return {
        "service": "Neural Grand Prix — Git-to-Track API",
        "status":  "ok",
        "version": "2.0.0",
    }


@app.get(
    "/api/track/{username}",
    response_model=TrackResponse,
    tags=["track"],
    summary="Generate a race circuit from a GitHub user's statistics",
)
async def get_track(username: str) -> TrackResponse:
    """
    Full Git-to-Track pipeline in one request.

    **Track parameters derived from GitHub stats:**

    | Stat | Effect |
    |---|---|
    | Commit count + Stars | Track complexity (control points, circuit length) |
    | Closed-issue ratio | Curve smoothness (high = sweeping, low = hairpins) |
    | Open-issue ratio | Weather: CLEAR < 10 %, FOG 10–30 %, STORM ≥ 30 % |
    | Top languages | Accent colours returned in `colors[]` |

    The same username always generates the same track (deterministic SHA-256 seed).
    """
    # Step 1: Fetch GitHub stats (5 parallel requests)
    raw = await _fetch_github_stats(username)

    # Step 2: Map stats → physics parameters
    complexity, smoothness, weather = _compute_track_params(raw)

    # Step 3: Generate procedural track geometry
    seed   = _username_seed(username)
    points = generate_track_points(complexity, smoothness, seed)

    # Step 4: Derive accent colours from top languages
    colors = [
        LANGUAGE_COLOURS.get(lang, _DEFAULT_COLOUR)
        for lang in raw["top_languages"]
    ] or [_DEFAULT_COLOUR]

    return TrackResponse(
        username     = username,
        weather      = weather,
        track_points = [Point3D(**p) for p in points],
        colors       = colors,
        stats        = TrackStats(
            total_commits  = raw["total_commits"],
            total_stars    = raw["total_stars"],
            open_issues    = raw["open_issues"],
            closed_issues  = raw["closed_issues"],
            top_languages  = raw["top_languages"],
            complexity     = round(complexity, 4),
            smoothness     = round(smoothness, 4),
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Commentary — AI Pit Wall
# ─────────────────────────────────────────────────────────────────────────────

# Circuit names: give each circuit a fictional grand prix name from the username
_CIRCUIT_WORDS = [
    "Apex", "Redline", "Vector", "Kernel", "Neural", "Volta", "Sigma",
    "Lambda", "Zenith", "Nexus", "Cipher", "Binary", "Quantum", "Flux",
]

def _circuit_name(username: str) -> str:
    seed = int(hashlib.sha256(username.lower().encode()).hexdigest()[:4], 16)
    word = _CIRCUIT_WORDS[seed % len(_CIRCUIT_WORDS)]
    return f"Circuit de {word} {username[:1].upper()}{username[1:4]}"


# Sector flavour so the AI knows what part of the lap we're on
_SECTOR_LABELS = {
    0: "Sector 1 — acceleration zone / main straight",
    1: "Sector 2 — technical complex / mid-sector",
    2: "Sector 3 — final push / run to the line",
}

_WEATHER_FLAVOUR = {
    "CLEAR": "perfect conditions — neon void, no grip issues",
    "FOG":   "reduced visibility — open issues lingering like fog banks",
    "STORM": "torrential rain, dramatic — many unresolved issues on track",
}


class CommentaryRequest(BaseModel):
    username:    str
    commits:     int
    stars:       int
    languages:   list[str]
    complexity:  float   # 0-1
    smoothness:  float   # 0-1
    weather:     str     # CLEAR | FOG | STORM
    sector:      int     # 0 | 1 | 2
    speed_level: str     # "LOW" | "MEDIUM" | "HIGH"
    lap:         int     # lap number (1-indexed)


@app.post("/api/commentary", tags=["commentary"])
async def stream_commentary(req: CommentaryRequest) -> StreamingResponse:
    """
    Stream 2–3 sentences of live F1 pit-wall commentary via Claude.
    Returns Server-Sent Events (text/event-stream).
    Gracefully degrades to a static fallback if ANTHROPIC_API_KEY is absent.
    """
    circuit  = _circuit_name(req.username)
    sector   = _SECTOR_LABELS.get(req.sector, "unknown sector")
    weather  = _WEATHER_FLAVOUR.get(req.weather, req.weather)
    langs    = ", ".join(req.languages) if req.languages else "unknown"
    stars_k  = f"{req.stars / 1000:.1f}k" if req.stars >= 1000 else str(req.stars)
    lap_word = f"Lap {req.lap}" if req.lap > 1 else "Opening lap"

    system_prompt = (
        "You are an electrifying Formula 1 pit-wall commentator — think Murray Walker "
        "meets a cyberpunk hacker. You narrate live race action in exactly 2 sentences. "
        "Weave the driver's GitHub identity naturally into the commentary: their commit "
        "count becomes raw aggression, their stars become fame, their top language "
        "defines the circuit character, high complexity means a brutal technical layout, "
        "high smoothness means clean sweeping curves. Never break the F1 fiction — "
        "treat everything as if it's a real race. Be dramatic, punchy, and vivid. "
        "Output ONLY the 2 commentary sentences, nothing else."
    )

    user_prompt = (
        f"Driver: @{req.username}\n"
        f"Circuit: {circuit}\n"
        f"Current situation: {lap_word}, {sector}, speed level: {req.speed_level}\n"
        f"Conditions: {weather}\n"
        f"Driver profile:\n"
        f"  - {req.commits} commits (raw racecraft / aggression index)\n"
        f"  - {stars_k} GitHub stars (fame / crowd support)\n"
        f"  - Primary language: {langs} (defines circuit character)\n"
        f"  - Circuit complexity: {req.complexity:.0%} (track brutality)\n"
        f"  - Circuit smoothness: {req.smoothness:.0%} (curve elegance)\n"
        f"\nGenerate exactly 2 sentences of live race commentary for this moment."
    )

    api_key = os.getenv("ANTHROPIC_API_KEY")

    if not api_key:
        # Graceful fallback — no key needed for this to stream something useful
        fallback = (
            f"@{req.username} charges through {circuit} on {lap_word.lower()}! "
            f"The {req.weather.lower()} conditions test every byte of those "
            f"{stars_k} stars of raw talent through {sector.split('—')[0].strip()}."
        )

        async def _fallback():
            for char in fallback:
                yield f"data: {char}\n\n"
                await asyncio.sleep(0.012)
            yield "data: [DONE]\n\n"

        return StreamingResponse(_fallback(), media_type="text/event-stream")

    async def _stream():
        try:
            import anthropic as _ant
            client = _ant.AsyncAnthropic(api_key=api_key)
            async with client.messages.stream(
                model       = "claude-haiku-4-5-20251001",
                max_tokens  = 120,
                system      = system_prompt,
                messages    = [{"role": "user", "content": user_prompt}],
            ) as stream:
                async for token in stream.text_stream:
                    # Escape newlines so SSE framing stays intact
                    safe = token.replace("\n", " ")
                    yield f"data: {safe}\n\n"
        except Exception as exc:
            yield f"data: Commentary unavailable: {exc}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ─────────────────────────────────────────────────────────────────────────────
# TTS — gTTS text-to-speech (free, no API key)
# ─────────────────────────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text: str


@app.post("/api/tts", tags=["commentary"])
async def text_to_speech(req: TTSRequest):
    """
    Convert text to MP3 using gTTS (Google Translate TTS — free, no key needed).
    Returns audio/mpeg bytes that the browser plays directly via the Audio API.
    Falls back to a 204 No Content if gTTS is not installed.
    """
    try:
        from gtts import gTTS
    except ImportError:
        from fastapi.responses import Response
        return Response(status_code=204)

    def _generate() -> bytes:
        tts = gTTS(text=req.text, lang="en", tld="co.uk")   # British accent
        buf = io.BytesIO()
        tts.write_to_fp(buf)
        buf.seek(0)
        return buf.read()

    # Run the blocking gTTS call in a thread so the event loop isn't blocked
    audio_bytes = await asyncio.get_event_loop().run_in_executor(None, _generate)
    return StreamingResponse(
        io.BytesIO(audio_bytes),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )
