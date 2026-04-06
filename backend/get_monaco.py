#!/usr/bin/env python3
"""
Fetch Monaco GP Qualifying telemetry and write a TypeScript data module
to frontend/src/data/monaco.ts.

FastF1 axis convention:
  X, Y  = horizontal plane (metres)
  Z     = elevation (metres above sea level)

Three.js mapping used here:
  fastf1 X  →  world X
  fastf1 Y  →  world Z  (negated so the circuit faces the correct direction)
  fastf1 Z  →  world Y  (elevation)

Output tuple format: [world_x, world_y, world_z]
Values are scaled by SCALE (metres → data-units) so that TrackCanvas.tsx's
TRACK_SCALE_H = 300 and TRACK_SCALE_V = 50 produce a circuit roughly
50 000 world-units in circumference — matching the physics tuning comments.
"""
import json
import os
import sys
import numpy as np

# ── Config ────────────────────────────────────────────────────────────────────
OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'frontend', 'src', 'data', 'monaco.ts'
)
N_POINTS = 1024
SCALE    = 0.05   # metres → data-units (TrackCanvas then applies ×300 / ×50)

# ── FastF1 acquisition ────────────────────────────────────────────────────────
def get_telemetry() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    import fastf1
    cache_dir = os.path.join(os.path.dirname(__file__), '.f1_cache')
    os.makedirs(cache_dir, exist_ok=True)
    fastf1.Cache.enable_cache(cache_dir)

    print('Loading 2023 Monaco GP Qualifying …')
    session = fastf1.get_session(2023, 'Monaco', 'Q')
    session.load(telemetry=True, weather=False, messages=False, laptimes=True)

    lap = session.laps.pick_fastest()
    tel = lap.get_telemetry()

    # Drop NaN rows so interpolation is clean
    df = tel[['X', 'Y', 'Z']].dropna()
    print(f'  {len(df)} raw telemetry samples loaded.')

    x_raw = df['X'].values.astype(float)   # horizontal
    z_raw = df['Y'].values.astype(float)   # horizontal (becomes world Z)
    y_raw = df['Z'].values.astype(float)   # elevation  (becomes world Y)
    return x_raw, y_raw, z_raw


# ── Accurate synthetic fallback ───────────────────────────────────────────────
# GPS-derived waypoints in real metres (x=east, elev, z=south from centroid).
# 55 points trace all key corners; np.interp fills to 1024.
def get_synthetic() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    pts = np.array([
        ( 770,  6,  -20),  # Start/Finish
        ( 730,  6,  -30),
        ( 680,  6,  -50),  # braking Ste Dévote
        ( 610,  7,  -90),  # Ste Dévote apex
        ( 540,  9, -150),  # exit – climbing
        ( 440, 14, -250),  # Beau Rivage
        ( 330, 22, -340),
        ( 220, 31, -420),
        ( 130, 38, -500),  # Massenet
        (  50, 42, -560),  # Casino entry
        ( -10, 43, -600),  # Casino apex
        ( -90, 42, -630),  # Casino exit
        (-150, 40, -650),  # Mirabeau Haut braking
        (-170, 38, -680),  # Mirabeau Haut apex
        (-130, 36, -710),
        ( -70, 33, -730),  # Mirabeau Bas
        ( -20, 30, -750),
        (  40, 28, -760),
        ( 110, 25, -770),
        ( 180, 22, -780),  # Loews entry
        ( 220, 20, -795),  # Loews apex (hairpin)
        ( 200, 19, -810),
        ( 140, 18, -800),
        (  60, 17, -780),
        ( -20, 15, -740),  # Portier entry
        (  40, 12, -700),  # Portier apex
        ( 130,  9, -660),
        ( 250,  6, -610),  # tunnel entry straight
        ( 380,  2, -570),
        ( 500, -2, -530),  # tunnel (underground)
        ( 620, -4, -480),
        ( 720, -3, -420),
        ( 780, -1, -360),  # tunnel exit
        ( 810,  1, -290),
        ( 820,  2, -210),  # Nouvelle Chicane
        ( 790,  3, -150),
        ( 760,  3,  -80),
        ( 710,  3,  -10),
        ( 660,  3,   50),  # Swimming Pool S1
        ( 600,  3,   90),
        ( 540,  3,   80),  # Swimming Pool S2
        ( 480,  3,   60),
        ( 420,  3,   40),  # Tabac
        ( 370,  3,   20),
        ( 320,  3,  -10),
        ( 270,  4,  -50),  # La Rascasse entry
        ( 230,  4,  -80),
        ( 210,  5, -110),  # La Rascasse apex (hairpin)
        ( 240,  5, -140),
        ( 310,  5, -150),  # Anthony Noghès approach
        ( 390,  5, -130),
        ( 450,  5, -100),  # Anthony Noghès apex
        ( 530,  5,  -60),
        ( 620,  5,  -30),
        ( 770,  6,  -20),  # close loop
    ], dtype=float)
    return pts[:, 0], pts[:, 1], pts[:, 2]

# ── Resampling ────────────────────────────────────────────────────────────────
def resample(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    n: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Resample (x,y,z) to exactly n evenly-spaced points and close the loop."""
    # Close the loop before resampling so the wrap-around segment interpolates
    x = np.append(x, x[0])
    y = np.append(y, y[0])
    z = np.append(z, z[0])
    t     = np.linspace(0.0, 1.0, len(x))
    t_new = np.linspace(0.0, 1.0, n, endpoint=False)
    return (
        np.interp(t_new, t, x),
        np.interp(t_new, t, y),
        np.interp(t_new, t, z),
    )

# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    try:
        x_raw, y_raw, z_raw = get_telemetry()
        print('Using real fastf1 telemetry.')
    except Exception as exc:
        print(f'fastf1 unavailable ({exc}) — using accurate synthetic layout.')
        x_raw, y_raw, z_raw = get_synthetic()

    # Centre each axis independently
    x = (x_raw - x_raw.mean()) * SCALE
    y = (y_raw - y_raw.mean()) * SCALE   # elevation relative to circuit mean
    z = (-z_raw + z_raw.mean()) * SCALE  # negate so circuit winds clockwise in Three.js

    print(f'Resampling to {N_POINTS} points …')
    xs, ys, zs = resample(x, y, z, N_POINTS)

    points: list[list[float]] = [
        [round(float(xs[i]), 4), round(float(ys[i]), 4), round(float(zs[i]), 4)]
        for i in range(N_POINTS)
    ]

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    ts_content = (
        '// Auto-generated by backend/get_monaco.py -- do not edit manually.\n'
        '// Points are [x, y, z] in data-units (0.05 x real metres).\n'
        '// TrackCanvas.tsx multiplies x/z by 300 and y by 50 for world-space.\n'
        f'const monacoPoints: [number, number, number][] = {json.dumps(points, separators=(",", ":"))}\n'
        'export default monacoPoints\n'
    )
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as fh:
        fh.write(ts_content)

    print(f'Saved {len(points)} points -> {OUTPUT_PATH}')
    print(f'  X: {min(p[0] for p in points):.3f} to {max(p[0] for p in points):.3f}')
    print(f'  Y: {min(p[1] for p in points):.3f} to {max(p[1] for p in points):.3f}')
    print(f'  Z: {min(p[2] for p in points):.3f} to {max(p[2] for p in points):.3f}')

if __name__ == '__main__':
    main()
