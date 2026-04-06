"""
ConditionalCircuitVAE
---------------------
Architecture:
  Encoder : flattened circuit points  →  (mu, log_var) in 32-d latent space
  Decoder : z (32-d) + condition (2-d: complexity, smoothness)  →  circuit points

Condition vector:
  condition[0] = complexity  in [0, 1]
  condition[1] = smoothness  in [0, 1]

Coordinate normalisation (applied before training, inverted before serving):
  X / Z :  divide by SCALE_XZ  (≈ max radius of training circuits)
  Y     :  divide by SCALE_Y
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

# ── Hyper-parameters ─────────────────────────────────────────────────────────
LATENT_DIM = 32
HIDDEN_DIM = 256
N_POINTS   = 64
COND_DIM   = 2          # [complexity, smoothness]
POINT_DIM  = N_POINTS * 3

# Coordinate normalisation constants (must match train_vae.py)
SCALE_XZ   = 26.0
SCALE_Y    = 1.6


class _Encoder(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(POINT_DIM, HIDDEN_DIM),
            nn.LayerNorm(HIDDEN_DIM),
            nn.SiLU(),
            nn.Linear(HIDDEN_DIM, HIDDEN_DIM),
            nn.LayerNorm(HIDDEN_DIM),
            nn.SiLU(),
        )
        self.fc_mu      = nn.Linear(HIDDEN_DIM, LATENT_DIM)
        self.fc_log_var = nn.Linear(HIDDEN_DIM, LATENT_DIM)

    def forward(self, pts: torch.Tensor):
        h = self.net(pts.view(-1, POINT_DIM))
        return self.fc_mu(h), self.fc_log_var(h)


class _Decoder(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(LATENT_DIM + COND_DIM, HIDDEN_DIM),
            nn.LayerNorm(HIDDEN_DIM),
            nn.SiLU(),
            nn.Linear(HIDDEN_DIM, HIDDEN_DIM),
            nn.LayerNorm(HIDDEN_DIM),
            nn.SiLU(),
            nn.Linear(HIDDEN_DIM, POINT_DIM),
            # No Tanh — linear output so the model can reach the full ±1 normalised range.
            # _cvae_generate clamps to ±SCALE_XZ / ±SCALE_Y after denormalisation.
        )

    def forward(self, z: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        x = torch.cat([z, cond], dim=-1)
        return self.net(x).view(-1, N_POINTS, 3)


class ConditionalCircuitVAE(nn.Module):
    """
    Conditional VAE that maps (latent_noise, complexity, smoothness) → circuit.

    Training  : call forward(points, cond) and optimise elbo().
    Inference : call generate(z, cond) with a seed-derived z.
    """

    latent_dim = LATENT_DIM

    def __init__(self) -> None:
        super().__init__()
        self.encoder = _Encoder()
        self.decoder = _Decoder()

    @staticmethod
    def reparameterise(mu: torch.Tensor, log_var: torch.Tensor) -> torch.Tensor:
        std = torch.exp(0.5 * log_var)
        return mu + torch.randn_like(std) * std

    def forward(self, pts: torch.Tensor, cond: torch.Tensor):
        """Training pass.  Returns (reconstruction, mu, log_var)."""
        mu, log_var = self.encoder(pts)
        z           = self.reparameterise(mu, log_var)
        recon       = self.decoder(z, cond)
        return recon, mu, log_var

    def generate(self, z: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        """Inference pass.  z should be sampled from N(0,I) via a seed-derived RNG."""
        with torch.no_grad():
            return self.decoder(z, cond)

    # ── Loss helpers ─────────────────────────────────────────────────────────
    @staticmethod
    def elbo(
        recon:   torch.Tensor,
        target:  torch.Tensor,
        mu:      torch.Tensor,
        log_var: torch.Tensor,
        beta:    float = 0.5,
    ) -> torch.Tensor:
        recon_loss = F.mse_loss(recon, target, reduction="mean")
        kl         = -0.5 * torch.mean(1 + log_var - mu.pow(2) - log_var.exp())
        return recon_loss + beta * kl
