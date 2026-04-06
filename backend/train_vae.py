#!/usr/bin/env python3
"""
Train the ConditionalCircuitVAE on real F1 circuit layouts.

Usage
-----
  cd backend
  python train_vae.py                     # 600 epochs, saves to checkpoints/
  python train_vae.py --epochs 1200 --lr 5e-4

How it works
------------
1.  Attempt to fetch 10 real circuits via FastF1.  If FastF1 is unavailable
    (or a circuit fails) a hand-crafted synthetic layout is used instead.
2.  Each circuit is resampled to N_POINTS = 64 arc-length-equidistant points
    and normalised to [-1, 1] (matching SCALE_XZ / SCALE_Y in cvae.py).
3.  Data is augmented 20× per circuit: random rotation, random flip, tiny
    scale jitter → ~200 training samples total.
4.  The CVAE is trained with β-VAE ELBO + a closing-loss term that penalises
    circuits whose last control-point is far from their first.
5.  Best checkpoint is saved to backend/checkpoints/circuit_vae.pt.
"""

from __future__ import annotations

import argparse
import os
import sys
import math

import numpy as np
import torch
import torch.optim as optim

# Add backend root to path so we can import models
sys.path.insert(0, os.path.dirname(__file__))
from models.cvae import ConditionalCircuitVAE, SCALE_XZ, SCALE_Y, N_POINTS

CHECKPOINT_DIR  = os.path.join(os.path.dirname(__file__), "checkpoints")
CHECKPOINT_PATH = os.path.join(CHECKPOINT_DIR, "circuit_vae.pt")

# ─────────────────────────────────────────────────────────────────────────────
# F1 circuit library
# Each entry: approximate waypoints in metres (x_east, z_south, y_elev),
# plus a complexity label in [0, 1].
# Waypoints only need to capture the essential circuit shape — FastF1 data
# is used when available for higher fidelity.
# ─────────────────────────────────────────────────────────────────────────────
_RAW_CIRCUITS: list[dict] = [
    # ── Monza (fast, few corners, long straights) ─────────────────────────────
    {
        "name": "monza", "complexity": 0.30, "smoothness": 0.85,
        "pts": [
            (-440,   40,   0), (-380,  -30,   0), (-280,  -80,   0),
            (-160, -100,   0), ( -40,  -90,   0), (  80,  -60,   0),
            ( 200,  -20,   0), ( 340,   60,   0), ( 420,  140,   0),
            ( 380,  260,   0), ( 240,  340,   0), (  60,  380,   0),
            (-140,  360,   0), (-300,  280,   0), (-400,  160,   0),
            (-440,   40,   0),
        ],
    },
    # ── Bahrain (medium, flowing layout) ─────────────────────────────────────
    {
        "name": "bahrain", "complexity": 0.50, "smoothness": 0.75,
        "pts": [
            (-380,    0,   5), (-280,  -80,   5), (-140, -140,   5),
            (   0, -160,   5), ( 140, -140,   5), ( 280,  -80,   5),
            ( 380,    0,   5), ( 340,  120,   5), ( 200,  200,   5),
            (  60,  220,   5), ( -80,  200,   5), (-160,  140,   5),
            (-140,   60,   5), (-200,    0,   5), (-260,  -40,   5),
            (-320,   60,   5), (-380,    0,   5),
        ],
    },
    # ── Hungary (very twisty, tight, low-speed) ───────────────────────────────
    {
        "name": "hungary", "complexity": 0.62, "smoothness": 0.70,
        "pts": [
            (-200, -360,  12), (-100, -380,  14), (   0, -340,  16),
            ( 100, -260,  16), ( 180, -160,  14), ( 200,  -40,  12),
            ( 160,   60,  10), (  80,  120,   8), (   0,  140,   6),
            ( -80,  120,   4), (-160,   40,   2), (-200,  -60,   0),
            (-160, -160,   2), (-100, -240,   6), (-140, -320,  10),
            (-200, -360,  12),
        ],
    },
    # ── Silverstone (high-speed sweepers, Maggotts/Becketts complex) ─────────
    {
        "name": "silverstone", "complexity": 0.68, "smoothness": 0.80,
        "pts": [
            (-400,    0,   0), (-320,  -80,   0), (-200, -140,   5),
            ( -60, -180,   5), (  80, -180,   5), ( 220, -140,   5),
            ( 360,  -60,   5), ( 420,   60,   5), ( 380,  180,   5),
            ( 240,  280,   5), (  80,  340,   5), ( -80,  360,   0),
            (-240,  320,   0), (-340,  200,   0), (-380,   80,   0),
            (-400,    0,   0),
        ],
    },
    # ── Spa-Francorchamps (long, varied: Eau Rouge, Kemmel, Pouhon) ───────────
    {
        "name": "spa", "complexity": 0.75, "smoothness": 0.72,
        "pts": [
            (-480,   20,  10), (-400,  -40,   5), (-280, -100,   0),
            (-120, -160,  -5), (  40, -200, -10), ( 200, -180, -10),
            ( 360, -120,  -5), ( 480,  -20,   0), ( 460,  100,  10),
            ( 340,  200,  20), ( 180,  280,  25), (  40,  300,  25),
            (-120,  280,  20), (-260,  220,  15), (-380,  140,  10),
            (-480,   20,  10),
        ],
    },
    # ── Monaco (very tight, urban, Loews hairpin, elevation changes) ──────────
    {
        "name": "monaco", "complexity": 0.78, "smoothness": 0.65,
        "pts": [
            ( -80, -340,  20), (  40, -360,  25), ( 160, -300,  30),
            ( 220, -180,  35), ( 240,  -40,  35), ( 220,   80,  30),
            ( 160,  160,  25), (  80,  200,  20), (   0,  220,  15),
            ( -80,  180,  10), (-160,   80,   5), (-200,  -40,   0),
            (-160, -140,  -5), ( -60, -200,  -5), (  20, -160,   0),
            (  80, -100,   5), (  20,  -60,  10), ( -60,  -80,  15),
            (-120, -160,  15), (-100, -260,  18), ( -80, -340,  20),
        ],
    },
    # ── Baku (long straight + very tight castle section) ─────────────────────
    {
        "name": "baku", "complexity": 0.80, "smoothness": 0.68,
        "pts": [
            (-480,   10,   3), (-320,   10,   3), (-160,   10,   3),
            (   0,   10,   3), ( 160,   10,   3), ( 320,   -2,   3),
            ( 440,  -60,   3), ( 480, -160,   3), ( 420, -280,   3),
            ( 260, -360,   3), (  80, -380,   3), ( -80, -360,   3),
            (-180, -300,   3), (-200, -220,   3), (-160, -140,   3),
            (-100,  -80,   3), ( -60, -120,   3), (-100, -180,   3),
            (-160, -200,   3), (-200, -140,   3), (-220,  -60,   3),
            (-200,   30,   3), (-480,   10,   3),
        ],
    },
    # ── COTA (many turns, big elevation, Turn 1 blind entry) ─────────────────
    {
        "name": "cota", "complexity": 0.85, "smoothness": 0.73,
        "pts": [
            ( -80, -400,  25), (  60, -360,  18), ( 200, -280,  10),
            ( 300, -160,   5), ( 320,  -20,   0), ( 280,  100,  -2),
            ( 180,  200,  -4), (  60,  240,  -4), ( -60,  220,  -2),
            (-160,  160,   0), (-240,   60,   2), (-280,  -60,   4),
            (-260, -180,   6), (-180, -280,  10), (-100, -360,  18),
            ( -80, -400,  25),
        ],
    },
    # ── Suzuka (S-curves, 130R, Casio Triangle, overpass section) ────────────
    {
        "name": "suzuka", "complexity": 0.88, "smoothness": 0.78,
        "pts": [
            (-160, -360,   5), ( -60, -340,   3), (  60, -280,   0),
            ( 160, -180,  -2), ( 220,  -60,  -2), ( 200,   60,   0),
            ( 140,  160,   2), (  40,  220,   4), ( -60,  220,   4),
            (-160,  160,   2), (-220,   60,   0), (-200,  -60,  -2),
            (-120, -140,  -4), ( -40, -160,  -4), (  40, -120,  -2),
            (  80,  -40,   0), (  40,   40,   2), ( -40,   60,   2),
            (-100,   20,   0), (-100,  -80,  -2), (-160, -200,   0),
            (-160, -280,   2), (-160, -360,   5),
        ],
    },
    # ── Singapore (night race, very tight urban, many 90° corners) ───────────
    {
        "name": "singapore", "complexity": 0.92, "smoothness": 0.58,
        "pts": [
            (-400,  -40,   0), (-320, -100,   0), (-220, -120,   0),
            (-120, -100,   0), ( -60,  -40,   0), ( -80,   40,   0),
            (-160,   80,   0), (-240,   40,   0), (-280,  -40,   0),
            (-240, -120,   0), (-160, -160,   0), ( -40, -180,   0),
            (  80, -160,   0), ( 180, -100,   0), ( 240,    0,   0),
            ( 200,  100,   0), ( 100,  160,   0), (   0,  180,   0),
            (-100,  160,   0), (-200,  100,   0), (-300,   40,   0),
            (-360,  -40,   0), (-400,  -40,   0),
        ],
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# FastF1 data collection (best-effort; falls back to synthetic if unavailable)
# ─────────────────────────────────────────────────────────────────────────────
_F1_SESSIONS = [
    (2023, "Monza",     "R"),
    (2023, "Bahrain",   "R"),
    (2023, "Hungary",   "R"),
    (2023, "Silverstone", "R"),
    (2023, "Spa",       "R"),
    (2023, "Monaco",    "Q"),
    (2023, "Baku",      "R"),
    (2023, "COTA",      "R"),
    (2023, "Japan",     "R"),
    (2023, "Singapore", "R"),
]


def _try_fastf1(idx: int) -> np.ndarray | None:
    """Return (n, 3) array of [x_m, z_m, y_m] for circuit idx, or None."""
    try:
        import fastf1
        cache = os.path.join(os.path.dirname(__file__), ".f1_cache")
        os.makedirs(cache, exist_ok=True)
        fastf1.Cache.enable_cache(cache)

        year, gp, ses = _F1_SESSIONS[idx]
        print(f"  FastF1: loading {year} {gp} {ses} …", end=" ", flush=True)
        session = fastf1.get_session(year, gp, ses)
        session.load(telemetry=True, weather=False, messages=False, laptimes=True)

        lap = session.laps.pick_fastest()
        tel = lap.get_telemetry()[["X", "Y", "Z"]].dropna()

        x = tel["X"].values.astype(float)
        z = tel["Y"].values.astype(float)   # FastF1 Y → circuit horizontal (world Z)
        y = tel["Z"].values.astype(float)   # FastF1 Z → elevation
        print("ok")
        return np.column_stack([x, z, y])
    except Exception as exc:
        print(f"unavailable ({type(exc).__name__}) — using synthetic")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Resampling
# ─────────────────────────────────────────────────────────────────────────────
def _resample(pts: np.ndarray, n: int = N_POINTS) -> np.ndarray:
    """Resample a circuit to exactly n arc-length-equidistant points."""
    # Close the loop
    if not np.allclose(pts[0], pts[-1], atol=1.0):
        pts = np.vstack([pts, pts[0]])

    diffs    = np.diff(pts[:, :2], axis=0)
    seg_len  = np.sqrt((diffs ** 2).sum(axis=1))
    cum_dist = np.concatenate([[0.0], np.cumsum(seg_len)])
    total    = cum_dist[-1]

    t_new = np.linspace(0.0, total, n, endpoint=False)
    out   = np.zeros((n, 3))
    for col in range(3):
        out[:, col] = np.interp(t_new, cum_dist, pts[:, col])
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Normalise / denormalise
# ─────────────────────────────────────────────────────────────────────────────
def _normalise(pts: np.ndarray) -> np.ndarray:
    """Centre and scale to [-1, 1] (X/Z) and [-1, 1] (Y)."""
    pts = pts.copy().astype(float)
    pts[:, 0] -= pts[:, 0].mean()
    pts[:, 1] -= pts[:, 1].mean()
    pts[:, 2] -= pts[:, 2].mean()

    max_r = np.sqrt((pts[:, 0] ** 2 + pts[:, 1] ** 2).max())
    if max_r > 1e-6:
        scale = SCALE_XZ / max_r      # fit within SCALE_XZ data-units
        pts[:, 0] *= scale
        pts[:, 1] *= scale
        pts[:, 2] *= scale * (SCALE_XZ / SCALE_Y) * 0.02  # gentle elevation

    # Final clamp to model output range
    pts[:, :2] = np.clip(pts[:, :2], -SCALE_XZ, SCALE_XZ)
    pts[:,  2] = np.clip(pts[:,  2], -SCALE_Y,   SCALE_Y)

    pts[:, :2] /= SCALE_XZ
    pts[:,  2] /= SCALE_Y
    return pts.astype(np.float32)


# ─────────────────────────────────────────────────────────────────────────────
# Augmentation
# ─────────────────────────────────────────────────────────────────────────────
def _augment(pts: np.ndarray, rng: np.random.RandomState, n: int = 20) -> list[np.ndarray]:
    """Return n rotated / flipped / scaled variants."""
    variants = []
    for _ in range(n):
        p = pts.copy()
        # Random rotation in XZ plane
        theta = rng.uniform(0.0, 2 * math.pi)
        cos_t, sin_t = math.cos(theta), math.sin(theta)
        x2 =  cos_t * p[:, 0] - sin_t * p[:, 1]
        z2 =  sin_t * p[:, 0] + cos_t * p[:, 1]
        p[:, 0], p[:, 1] = x2, z2
        # Random reflection
        if rng.random() < 0.5:
            p[:, 0] = -p[:, 0]
        # Tiny scale jitter ±8 %
        s = rng.uniform(0.92, 1.08)
        p[:, :2] *= s
        p[:, :2]  = np.clip(p[:, :2], -1.0, 1.0)
        variants.append(p.astype(np.float32))
    return variants


# ─────────────────────────────────────────────────────────────────────────────
# Dataset builder
# ─────────────────────────────────────────────────────────────────────────────
def build_dataset(rng: np.random.RandomState) -> tuple[torch.Tensor, torch.Tensor]:
    """Returns (points_tensor [N, 64, 3], cond_tensor [N, 2])."""
    all_pts:  list[np.ndarray] = []
    all_cond: list[np.ndarray] = []

    for i, circuit in enumerate(_RAW_CIRCUITS):
        print(f"[{i+1}/{len(_RAW_CIRCUITS)}] {circuit['name']}")

        raw = _try_fastf1(i)
        if raw is None:
            raw = np.array(circuit["pts"], dtype=float)

        resampled  = _resample(raw)
        normalised = _normalise(resampled)
        variants   = _augment(normalised, rng, n=20)

        cond = np.array([circuit["complexity"], circuit["smoothness"]], dtype=np.float32)
        for v in variants:
            all_pts.append(v)
            all_cond.append(cond)

    pts_t  = torch.tensor(np.stack(all_pts),  dtype=torch.float32)
    cond_t = torch.tensor(np.stack(all_cond), dtype=torch.float32)
    return pts_t, cond_t


# ─────────────────────────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────────────────────────
def train(epochs: int = 600, lr: float = 1e-3) -> None:
    print("=" * 60)
    print("Neural Grand Prix — CVAE Training")
    print("=" * 60)

    rng    = np.random.RandomState(42)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}\n")

    print("Building dataset …")
    pts_t, cond_t = build_dataset(rng)
    n_samples = pts_t.shape[0]
    print(f"\nTotal samples: {n_samples}  |  shape: {tuple(pts_t.shape)}\n")

    pts_t  = pts_t.to(device)
    cond_t = cond_t.to(device)

    model     = ConditionalCircuitVAE().to(device)
    optimizer = optim.Adam(model.parameters(), lr=lr)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)

    best_loss = float("inf")
    os.makedirs(CHECKPOINT_DIR, exist_ok=True)

    # Contrastive condition pairs: indices of sample pairs from DIFFERENT circuit types.
    # Used to penalise outputs that look identical for very different complexity scores.
    samples_per_circuit = n_samples // len(_RAW_CIRCUITS)  # 20 augmentations each
    pair_a, pair_b = [], []
    for i in range(len(_RAW_CIRCUITS)):
        for j in range(i + 1, len(_RAW_CIRCUITS)):
            # one representative per circuit type
            pair_a.append(i * samples_per_circuit)
            pair_b.append(j * samples_per_circuit)
    pair_a_t = torch.tensor(pair_a, device=device)
    pair_b_t = torch.tensor(pair_b, device=device)

    print(f"Training for {epochs} epochs  (beta=4.0 + contrastive) ...")
    for epoch in range(1, epochs + 1):
        model.train()
        optimizer.zero_grad()

        recon, mu, log_var = model(pts_t, cond_t)

        # β-VAE ELBO — β=0.8 balances reconstruction quality and condition usage
        loss = ConditionalCircuitVAE.elbo(recon, pts_t, mu, log_var, beta=0.8)

        # Closing loss — penalise circuits where last point is far from first
        closing = ((recon[:, -1] - recon[:, 0]) ** 2).mean()
        loss = loss + 0.15 * closing

        # Contrastive loss — circuits with different complexity MUST look different.
        # For each pair (i,j) with complexity gap > 0.1, push outputs apart.
        cond_diff  = (cond_t[pair_a_t, 0] - cond_t[pair_b_t, 0]).abs()   # complexity gap
        recon_diff = ((recon[pair_a_t] - recon[pair_b_t]) ** 2).mean(dim=(1, 2))
        margin     = cond_diff * 6.0   # circuits 0.6 apart should differ by at least 3.6
        contrast   = torch.clamp(margin - recon_diff, min=0.0).mean()
        loss       = loss + 0.4 * contrast

        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        scheduler.step()

        if epoch % 50 == 0 or epoch == 1:
            print(f"  Epoch {epoch:4d}/{epochs}  loss={loss.item():.5f}")

        if loss.item() < best_loss:
            best_loss = loss.item()
            torch.save({
                "epoch":      epoch,
                "state_dict": model.state_dict(),
                "best_loss":  best_loss,
            }, CHECKPOINT_PATH)

    print(f"\nTraining complete.  Best loss: {best_loss:.5f}")
    print(f"Checkpoint saved -> {CHECKPOINT_PATH}")


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train CircuitVAE")
    parser.add_argument("--epochs", type=int, default=600)
    parser.add_argument("--lr",     type=float, default=1e-3)
    args = parser.parse_args()
    train(epochs=args.epochs, lr=args.lr)
