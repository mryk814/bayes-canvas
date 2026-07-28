# Distribution Registry

Bayes Canvas uses the distribution registry as the source of truth for distribution identity.

## Canonical IDs

Canonical IDs are lowercase snake-free identifiers unless the distribution name needs an existing separator such as `_t`.

| Canonical ID | UI label | Accepted aliases | PyMC | NumPyro | Stan |
| --- | --- | --- | --- | --- | --- |
| `normal` | Normal | `Gaussian` | `pm.Normal` | `dist.Normal` | `normal` |
| `student_t` | StudentT | `StudentT`, `Student-t`, `T` | `pm.StudentT` | `dist.StudentT` | `student_t` |
| `halfnormal` | HalfNormal | `HalfNormal`, `Half-Normal`, `half_normal` | `pm.HalfNormal` | `dist.HalfNormal` | `normal<lower=0>` |
| `uniform` | Uniform | — | `pm.Uniform` | `dist.Uniform` | `uniform` |
| `gamma` | Gamma | — | `pm.Gamma` | `dist.Gamma` | `gamma` |
| `inverse_gamma` | InverseGamma | `Inverse Gamma`, `InvGamma` | `pm.InverseGamma` | `dist.InverseGamma` | `inv_gamma` |
| `weibull` | Weibull | — | `pm.Weibull` | `dist.Weibull` | `weibull` |
| `logistic` | Logistic | — | `pm.Logistic` | `dist.Logistic` | `logistic` |

Other registered distributions may be authored and reviewed, but they do not claim a backend-specific name until `backendNames` is set in `app/src/lib/distributionRegistry.ts`.

## Runtime Contract

- UI defaults, compiler validation, target profile names, and handoff capability notes all derive from `app/src/lib/distributionRegistry.ts`.
- `halfnormal` is the canonical HalfNormal ID. `half_normal` is accepted only as an alias for older documents or external input.
- Target profiles do not hand-maintain distribution name maps; they derive backend names from registry entries.
- `TruncatedNormal` is a UI recipe, not a second canonical distribution ID. It is stored as `normal` plus `distribution.truncation`, and the same modifier may be used with another compatible continuous base distribution.
- Distribution truncation and observation censoring are separate contracts. Truncation changes the normalized law; censoring describes how a latent value was recorded.
- Deprecated or discouraged distributions remain in the registry with `deprecated` and `notes` metadata so diagnostics and handoff review can explain the risk.
