# Model Coverage

Bayes Canvas separates Bayesian model semantics into four layers. A new palette item is complete only when its meaning survives editing, `ModelDocument` persistence, equations, review diagnostics, and implementation handoff.

| Layer | What it represents | Current editable coverage |
| --- | --- | --- |
| Distribution | The probability law of one random variable | Continuous, count, categorical, multivariate, zero-inflated, mixture, and shrinkage families |
| Observation process | How a latent or generated value becomes a recorded datum | Exact, missingness with mechanism/strategy, measurement error, censoring, truncation/selection, rounding |
| Structural block | Dependence spanning multiple variables, coordinates, or time points | GAM smooth, Gaussian process, state space, hidden Markov, finite mixture |
| Constraint / identification | Valid domain or an identifying restriction | Positive, unit interval, simplex, ordered, sum-to-zero, correlation and Cholesky-correlation forms |

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

### Structural blocks

Structural blocks are boundary-checked contracts, not decorative grouping:

- Gaussian process: coordinates + kernel → latent function;
- GAM smooth: predictor + basis/coefficient definition → smooth effect;
- state space: initial state + transition + innovation → state sequence;
- hidden Markov: initial probabilities + transition matrix + emission → discrete state sequence;
- mixture: weights + component distributions → mixture value.

Their internals remain implementation-specific, but ports, configuration, equations, and backend capability notes must be preserved.

## High-frequency distribution coverage

The registry includes Normal, Student-t, HalfNormal, Exponential, LogNormal, Uniform, Gamma, InverseGamma, Weibull, Logistic, Bernoulli, Binomial, Poisson, NegativeBinomial, Beta, Dirichlet, Categorical, multivariate Normal, LKJ forms, ordered logistic, multinomial forms, zero-inflated counts, mixture, shrinkage priors, and Wishart-with-warning.

Backend-specific names are capability claims. A distribution without a registered target name remains representable for review but is reported as unsupported for that implementation target.

## Remaining intentional gaps

These are not represented as completed components yet:

- ODE/SDE solver contracts;
- spatial CAR/SAR and Gaussian Markov random fields;
- survival-specific hazard and competing-risk blocks;
- copulas and custom multivariate dependence;
- nonparametric random measures;
- explicit transforms/Jacobians beyond domain constraints;
- causal intervention and missing-not-at-random selection submodels.

They should be added as vertical contracts rather than isolated palette buttons.
