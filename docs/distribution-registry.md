# Distribution Registry

Bayes Canvas uses the distribution registry as the source of truth for distribution identity.

## Canonical IDs

Canonical IDs are lowercase snake-free identifiers unless the distribution name needs an existing separator such as `_t`.

| Canonical ID | UI label | Accepted aliases | PyMC | NumPyro | Stan |
| --- | --- | --- | --- | --- | --- |
| `normal` | Normal | `Gaussian` | `pm.Normal` | `dist.Normal` | `normal` |
| `student_t` | StudentT | `StudentT`, `Student-t`, `T` | `pm.StudentT` | `dist.StudentT` | `student_t` |
| `halfnormal` | HalfNormal | `HalfNormal`, `Half-Normal`, `half_normal` | `pm.HalfNormal` | `dist.HalfNormal` | `normal<lower=0>` |

Other registered distributions may be authored and reviewed, but they do not claim a backend-specific name until `backendNames` is set in `app/src/lib/distributionRegistry.ts`.

## Runtime Contract

- UI defaults, compiler validation, target profile names, and handoff capability notes all derive from `app/src/lib/distributionRegistry.ts`.
- `halfnormal` is the canonical HalfNormal ID. `half_normal` is accepted only as an alias for older documents or external input.
- Target profiles do not hand-maintain distribution name maps; they derive backend names from registry entries.
- Deprecated or discouraged distributions remain in the registry with `deprecated` and `notes` metadata so diagnostics and handoff review can explain the risk.
