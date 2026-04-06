"""
CircuitVAE — Variational Autoencoder for F1 Circuit Generation
---------------------------------------------------------------
Architecture overview
  Encoder : commit-feature vector → (μ, log σ²) in latent space Z
  Decoder : z ∈ Z → 3D spline control-point sequence (x, y, z coords)

Input representation
  A GitHub commit history is reduced to a fixed-length feature vector by the
  data pipeline (commit_to_features.py, TBD).  Expected shape: [B, INPUT_DIM].

Output representation
  A flat tensor of shape [B, N_POINTS * 3] that is reshaped into
  [B, N_POINTS, 3] by the caller and passed through a CatmullRom spline
  interpolator before being served to the frontend.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


# ---------------------------------------------------------------------------
# Hyper-parameters (override via CircuitVAE constructor kwargs)
# ---------------------------------------------------------------------------
INPUT_DIM  = 128   # dimensionality of encoded commit-feature vector
LATENT_DIM = 64    # VAE bottleneck size
N_POINTS   = 64    # number of 3D spline control points to generate
HIDDEN_DIM = 256


class Encoder(nn.Module):
    """Maps an input feature vector to (mu, log_var) in latent space."""

    def __init__(self, input_dim: int, hidden_dim: int, latent_dim: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.SiLU(),
        )
        self.fc_mu      = nn.Linear(hidden_dim, latent_dim)
        self.fc_log_var = nn.Linear(hidden_dim, latent_dim)

    def forward(self, x: torch.Tensor):
        h       = self.net(x)
        mu      = self.fc_mu(h)
        log_var = self.fc_log_var(h)
        return mu, log_var


class Decoder(nn.Module):
    """Maps a latent vector z to a sequence of 3D control points."""

    def __init__(self, latent_dim: int, hidden_dim: int, n_points: int):
        super().__init__()
        self.n_points  = n_points
        self.output_dim = n_points * 3

        self.net = nn.Sequential(
            nn.Linear(latent_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, self.output_dim),
        )

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        out = self.net(z)                              # [B, N*3]
        return out.view(-1, self.n_points, 3)          # [B, N, 3]


class CircuitVAE(nn.Module):
    """
    Full VAE: encode → reparameterise → decode.

    Usage
    -----
    model = CircuitVAE()
    points, mu, log_var = model(feature_vector)   # training
    points = model.generate(z)                    # inference from sampled z
    """

    def __init__(
        self,
        input_dim:  int = INPUT_DIM,
        hidden_dim: int = HIDDEN_DIM,
        latent_dim: int = LATENT_DIM,
        n_points:   int = N_POINTS,
    ):
        super().__init__()
        self.latent_dim = latent_dim
        self.encoder    = Encoder(input_dim, hidden_dim, latent_dim)
        self.decoder    = Decoder(latent_dim, hidden_dim, n_points)

    # ------------------------------------------------------------------
    # Reparameterisation trick:  z = μ + ε·σ,  ε ~ N(0, I)
    # ------------------------------------------------------------------
    @staticmethod
    def reparameterise(mu: torch.Tensor, log_var: torch.Tensor) -> torch.Tensor:
        std = torch.exp(0.5 * log_var)
        eps = torch.randn_like(std)
        return mu + eps * std

    def forward(self, x: torch.Tensor):
        mu, log_var = self.encoder(x)
        z           = self.reparameterise(mu, log_var)
        points      = self.decoder(z)
        return points, mu, log_var

    def generate(self, z: torch.Tensor) -> torch.Tensor:
        """Pure decode — used during inference / serving."""
        return self.decoder(z)

    # ------------------------------------------------------------------
    # Loss helpers
    # ------------------------------------------------------------------
    @staticmethod
    def reconstruction_loss(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        """MSE over all control-point coordinates."""
        return F.mse_loss(pred, target, reduction='mean')

    @staticmethod
    def kl_divergence(mu: torch.Tensor, log_var: torch.Tensor) -> torch.Tensor:
        """Analytically closed-form KL against N(0, I)."""
        return -0.5 * torch.mean(1 + log_var - mu.pow(2) - log_var.exp())

    def elbo(
        self,
        pred:    torch.Tensor,
        target:  torch.Tensor,
        mu:      torch.Tensor,
        log_var: torch.Tensor,
        beta:    float = 1.0,
    ) -> torch.Tensor:
        """β-VAE ELBO:  recon_loss + β · KL"""
        return self.reconstruction_loss(pred, target) + beta * self.kl_divergence(mu, log_var)
