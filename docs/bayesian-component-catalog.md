# Bayesian Component Catalog

Bayes Canvas treats Bayesian modeling parts as authoring components, not only as backend distribution names. Each component should keep a readable UI label, a compact IR representation, TeX output, AI handoff notes, and a statement about what can be linted locally.

## Distribution

| Component | Represents | UI label | IR expression | TeX | AI handoff | Lint |
|---|---|---|---|---|---|---|
| Normal | Real-valued location-scale variable | Normal | `Normal(mu, sigma)` | `\mathcal{N}(\mu,\sigma)` | Preserve parameterization | Required args, positive scale |
| StudentT | Robust real-valued variable | StudentT | `StudentT(nu, mu, sigma)` | `StudentT(\nu,\mu,\sigma)` | Note heavy tails | Required args, positive `nu`/scale |
| HalfNormal | Positive scale prior | HalfNormal | `HalfNormal(sigma)` | `HalfNormal(\sigma)` | Use for constrained positive scales | Positive support |
| Laplace | Lasso-style shrinkage prior | Laplace | `Laplace(mu, b)` | `Laplace(\mu,b)` | Explain shrinkage intent | Required args, positive scale |
| Cauchy | Heavy-tailed real prior | Cauchy | `Cauchy(alpha, beta)` | `Cauchy(\alpha,\beta)` | Flag tail behavior | Positive scale |
| HalfCauchy | Heavy-tailed positive scale prior | HalfCauchy | `HalfCauchy(beta)` | `HalfCauchy(\beta)` | Common hierarchy scale prior | Positive support |
| MultivariateNormal | Vector normal variable | MVN | `MultivariateNormal(mu, cov)` | `MVN(\mu,\Sigma)` | State covariance or Cholesky form | Required location and covariance/chol choice |
| LKJCorrelation | Correlation matrix prior | LKJ correlation | `LKJCorrelation(eta)` | `LKJ(\eta)` | Preserve matrix dimension | Positive eta |
| LKJCholesky | Cholesky correlation prior | LKJ Cholesky | `LKJCholesky(eta)` | `LKJCholesky(\eta)` | Prefer for implementation stability | Positive eta |
| OrderedLogistic | Ordered category likelihood | Ordered logistic | `OrderedLogistic(eta, cutpoints)` | `OrderedLogistic(\eta,c)` | Cutpoints must be ordered | Ordered cutpoints |
| ZeroInflatedPoisson | Zero-inflated counts | ZIP | `ZeroInflatedPoisson(psi, lambda)` | `ZIP(\psi,\lambda)` | State zero-inflation probability | `psi` in unit interval, positive rate |

## Prior Recipe

| Component | Represents | UI label | IR expression | TeX | AI handoff | Lint |
|---|---|---|---|---|---|---|
| Weak Normal | Weakly informative coefficient prior | Weak Normal | `beta ~ Normal(0, scale)` | `\beta \sim N(0,s)` | Explain scale rationale | Positive scale |
| Laplace Shrinkage | Lasso-like coefficient shrinkage | Laplace recipe | `beta ~ Laplace(0, b)` | `\beta \sim Laplace(0,b)` | Preserve sparsity intent | Positive scale |
| Horseshoe | Sparse coefficient shrinkage | Horseshoe | collapsed plus expanded local/global scales | expanded Normal/HalfCauchy lines | Include collapsed and expanded forms | Expanded refs and positive scales |
| Regularized Horseshoe | Horseshoe with slab scale | Regularized Horseshoe | recipe block | expanded hierarchy | Include slab and global shrinkage terms | Partial; warn if slab missing |
| Hierarchical Normal | Group-level effects | Hierarchical Normal | `alpha[j] ~ Normal(mu_alpha, tau_alpha)` | `\alpha_j \sim N(\mu_\alpha,\tau_\alpha)` | Include plate and non-centered hint | Plate/index and scale checks |
| LKJ Correlated Effects | Correlated varying effects | Correlated effects | MVN + LKJ Cholesky recipe | matrix form | Explain Cholesky factor and dimensions | Partial; correlation support |

## Regression Component

| Component | Represents | UI label | IR expression | TeX | AI handoff | Lint |
|---|---|---|---|---|---|---|
| Intercept | Constant additive term | Intercept | `alpha` | `\alpha` | State target predictor | Symbol exists |
| Linear Term | Numeric covariate effect | Linear term | `beta * x[i]` | `\beta x_i` | Include covariate and coefficient | Symbol and index refs |
| Interaction | Product of covariates | Interaction | `beta_ab * a[i] * b[i]` | `\beta_{ab}a_i b_i` | Preserve interaction meaning | Symbol refs |
| Group Intercept | Varying intercept | Group intercept | `alpha[group_id[i]]` | `\alpha_{group\_id_i}` | Include index mapping | Mapping/plate check |
| Group Slope | Varying slope | Group slope | `beta[group_id[i]] * x[i]` | `\beta_{group\_id_i}x_i` | Include mapping and slope covariate | Mapping/plate check |
| GAM Smooth | Smooth function | Smooth term | `f_smooth[i]` | `f_{smooth,i}` | Include basis and smoothness prior | Structured block only |
| GP Term | Gaussian process effect | GP term | `f_gp[i]` | `f_{gp,i}` | Include kernel, lengthscale, sparse/exact hint | Structured block only |
| BNN Term | Neural network effect | BNN term | `f_bnn[i]` | `f_{bnn,i}` | Include architecture and priors | Opaque/structured |
| Offset | Known additive contribution | Offset | `offset[i]` | `offset_i` | Do not estimate coefficient unless specified | Symbol and plate refs |

## Observation Process

| Component | Represents | UI label | IR expression | TeX | AI handoff | Lint |
|---|---|---|---|---|---|---|
| Exact | Direct observation | Exact | `{kind:"exact"}` | observation note | Default likelihood | No special lint |
| Missing Imputation | Missing data modeled as latent | Missing | `{kind:"missing", strategy:"latent_imputation"}` | observation note | Ask implementation to impute | Strategy present |
| Measurement Error | Noisy observed covariate | Measurement error | latent true + error scale | observation note | Include `x_obs` and `x_true` relationship | Symbol refs |
| Censored | Bounds hide true value | Censored | direction + bound | observation note | Use censoring likelihood | Bound when needed |
| Truncated | Sample restricted by bounds | Truncated | lower/upper | observation note | Use truncated distribution | Bound syntax |
| Rounded | Observed after rounding | Rounded | unit | observation note | Preserve rounding mechanism | Unit optional |
| Known Standard Error | Meta-analysis observation | Known SE | likelihood uses `se[i]` | likelihood line | Treat SE as data, not parameter | Symbol refs |

## Latent Process

| Component | Represents | UI label | IR expression | TeX | AI handoff | Lint |
|---|---|---|---|---|---|---|
| State Space | Latent dynamic state | State-space | transition + observation blocks | recurrence | Include transition and observation equations | Structured block |
| HMM | Discrete latent state sequence | HMM | transition/emission blocks | recurrence | Mention discrete marginalization if needed | Opaque/structured |
| GP Latent Function | Latent function prior | GP latent | `f ~ GP(...)` | GP notation | Include kernel and input domain | Structured block |
| ODE Process | Deterministic latent dynamics | ODE | state derivative block | differential equation | Include solver and parameters | Opaque |
| Mixture Assignment | Latent component assignment | Mixture assignment | categorical latent plus component likelihood | mixture notation | Prefer marginalization where backend supports it | Partial |

## Constraint / Transform

| Component | Represents | UI label | IR expression | TeX | AI handoff | Lint |
|---|---|---|---|---|---|---|
| Positive | Positive variable | Positive | `{kind:"positive"}` | `>0` | Declare constrained parameter | Prior support warning |
| Unit Interval | Probability variable | Unit interval | `{kind:"unit_interval"}` | `[0,1]` | Use bounded/logit transform | Support warning |
| Simplex | Probability vector | Simplex | `{kind:"simplex"}` | simplex note | Use simplex declaration | Support warning |
| Ordered | Ordered cutpoints | Ordered | `{kind:"ordered"}` | ordered note | Use ordered transform | Ordered likelihood compatibility |
| Sum-to-zero | Identifiability constraint | Sum-to-zero | `{kind:"sum_to_zero"}` | sum note | Preserve contrast constraint | Plate target present |
| Correlation Matrix | Valid correlation matrix | Correlation matrix | `{kind:"correlation_matrix"}` | correlation note | Prefer Cholesky implementation | Distribution support |
| Non-centered | Parameterization hint | Non-centered | hint block | note | Implement hierarchy non-centered | Handoff only |

## Implementation Hint

| Component | Represents | UI label | IR expression | TeX | AI handoff | Lint |
|---|---|---|---|---|---|---|
| Centered | Centered hierarchy | Centered | hint block | note | Use direct parameterization | Handoff only |
| Non-centered | Non-centered hierarchy | Non-centered | hint block | note | Use auxiliary standard normal | Handoff only |
| Sparse GP | Approximate GP implementation | Sparse GP | hint block | note | Ask for inducing point strategy | Handoff only |
| QR | Regression reparameterization | QR | hint block | note | Apply QR only if preserving coefficients | Handoff only |
| Marginalize Discrete | Avoid sampled discrete latent | Marginalize discrete | hint block | note | Use marginal likelihood where possible | Handoff only |

## Workflow / Handoff Note

| Component | Represents | UI label | IR expression | TeX | AI handoff | Lint |
|---|---|---|---|---|---|---|
| Prior Rationale | Why a prior was chosen | Prior note | notes field | note | Keep rationale near prior | Required text only |
| Identifiability Warning | Known model risk | Warning | warning hint | note | Put before implementation steps | Handoff only |
| Assumption | Data/model assumption | Assumption | notes field | note | Do not invent absent assumptions | Handoff only |
| Review Question | Clarification request | Review question | handoff mode | note | Ask before implementation | Handoff only |
