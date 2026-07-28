# Model Coverage

Bayes Canvas separates Bayesian model semantics into four layers. A new palette item is complete only when its meaning survives editing, `ModelDocument` persistence, equations, review diagnostics, and implementation handoff.

| Layer | What it represents | Current editable coverage |
| --- | --- | --- |
| Distribution | The probability law of one random variable | Continuous, count, categorical, multivariate, zero-inflated, mixture, and shrinkage families |
| Observation process | How a latent or generated value becomes a recorded datum | Exact, missingness with mechanism/strategy and MNAR selection equation, measurement error, censoring, truncation/selection, rounding |
| Structural block | Dependence spanning multiple variables, coordinates, or time points | GAM smooth, Gaussian process, state space, hidden Markov, finite mixture, survival/competing risks, spatial CAR/GMRF, ODE/SDE, copula |
| Constraint / identification | Valid domain, transform, or an identifying restriction | Positive, unit interval, simplex, ordered, sum-to-zero, correlation and Cholesky-correlation forms, explicit forward/inverse transform and Jacobian owner |

## Canonical distinctions

### Truncation and censoring

- Distribution truncation changes the normalized probability law itself. It is stored as `distribution.truncation` beside the base distribution.
- Censoring is an observation process: the latent value exists, but the recorded value only identifies a side or interval.
- Sample selection can also be represented as an observation process when the selection rule, rather than the latent population distribution, is the modeling object.

The UI may offer `TruncatedNormal` as a convenient selection, but the canonical document stores `normal` plus explicit lower/upper truncation bounds. This keeps the modifier reusable for other continuous families.

### Missingness

Missingness keeps two decisions separate:

- mechanism: `MCAR`, `MAR`, `MNAR`, or `unspecified`;
- strategy: latent imputation, exclusion, or a review note.

Choosing a strategy does not silently claim a mechanism.
For `MNAR`, a separate selection equation is required before handoff. It describes the missingness assumption; the strategy still describes how inference handles missing values.

### Structural blocks

Structural blocks are boundary-checked contracts, not decorative grouping:

- Gaussian process: coordinates + kernel → latent function;
- GAM smooth: predictor + basis/coefficient definition → smooth effect;
- state space: initial state + transition + innovation → state sequence;
- hidden Markov: initial probabilities + transition matrix + emission → discrete state sequence;
- mixture: weights + component distributions → mixture value.
- survival: time + event + hazard + cumulative hazard → log likelihood, with explicit right/interval censoring;
- competing risks: cause-specific hazards + all-cause cumulative hazard → cause log likelihood;
- spatial CAR/GMRF: adjacency + spatial index + precision → spatial effect, with intrinsic and identification settings;
- ODE/SDE: initial state + dynamics + parameters + time + observation model → trajectory, with solver and tolerances;
- copula: marginal CDFs + uniform-scale inputs + dependence parameters → joint value, with Jacobian ownership.

Their internals remain implementation-specific, but ports, configuration, equations, and backend capability notes must be preserved.

## High-frequency distribution coverage

The registry includes Normal, Student-t, HalfNormal, Exponential, LogNormal, Uniform, Gamma, InverseGamma, Weibull, Logistic, Bernoulli, Binomial, Poisson, NegativeBinomial, Beta, Dirichlet, Categorical, multivariate Normal, LKJ forms, ordered logistic, multinomial forms, zero-inflated counts, mixture, shrinkage priors, and Wishart-with-warning.

Backend-specific names are capability claims. A distribution without a registered target name remains representable for review but is reported as unsupported for that implementation target.

### Explicit transforms

A random variable may carry a forward expression, inverse expression, and one Jacobian owner: `backend`, `model`, or `not_required`. This is separate from its support/domain constraint and is included in equations, review diagnostics, semantic diff, and backend capability reporting.

## Remaining intentional gaps

These are not represented as completed components yet:

- nonparametric random measures;
- causal intervention contracts;
- richer spatial SAR/continuous-field families beyond the current adjacency-based CAR/GMRF boundary;
- backend-native lowering and generated code for the advanced blocks.

They should be added as vertical contracts rather than isolated palette buttons.
