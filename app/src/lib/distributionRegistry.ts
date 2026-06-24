export type DistributionFamily = 'continuous' | 'discrete' | 'multivariate' | 'count' | 'categorical';

export type DistributionSupport =
  | 'real'
  | 'positive'
  | 'unit_interval'
  | 'simplex'
  | 'integer'
  | 'nonnegative_integer'
  | string;

export type DistributionParamRole =
  | 'location'
  | 'scale'
  | 'shape'
  | 'probability'
  | 'rate'
  | 'concentration'
  | 'df'
  | 'correlation'
  | 'covariance'
  | 'component'
  | 'weight';

export interface DistributionParamDefinition {
  name: string;
  required: boolean;
  role?: DistributionParamRole;
  defaultExpression?: string;
  support?: DistributionSupport;
}

export interface DistributionDefinition {
  id: string;
  name: string;
  aliases?: string[];
  family?: DistributionFamily;
  support: DistributionSupport;
  params: DistributionParamDefinition[];
  latexTemplate: string;
  textTemplate: string;
  description?: string;
  notes?: string;
  deprecated?: boolean;
}

export interface DistributionSpec {
  id?: string;
  name: string;
  args: Record<string, string>;
}

export const DISTRIBUTIONS: DistributionDefinition[] = [
  {
    id: 'normal',
    name: 'Normal',
    aliases: ['Gaussian'],
    family: 'continuous',
    support: 'real',
    params: [
      { name: 'mu', required: true, role: 'location', defaultExpression: '0', support: 'real' },
      { name: 'sigma', required: true, role: 'scale', defaultExpression: '1', support: 'positive' },
    ],
    latexTemplate: '\\mathcal{N}({mu}, {sigma})',
    textTemplate: 'Normal({mu}, {sigma})',
    description: 'Real-valued normal distribution parameterized by location and positive scale.',
  },
  {
    id: 'student_t',
    name: 'StudentT',
    aliases: ['StudentT', 'Student-t', 'T'],
    family: 'continuous',
    support: 'real',
    params: [
      { name: 'nu', required: true, role: 'df', defaultExpression: '4', support: 'positive' },
      { name: 'mu', required: true, role: 'location', defaultExpression: '0', support: 'real' },
      { name: 'sigma', required: true, role: 'scale', defaultExpression: '1', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{StudentT}({nu}, {mu}, {sigma})',
    textTemplate: 'StudentT({nu}, {mu}, {sigma})',
  },
  {
    id: 'halfnormal',
    name: 'HalfNormal',
    aliases: ['HalfNormal', 'Half-Normal'],
    family: 'continuous',
    support: 'positive',
    params: [{ name: 'sigma', required: true, role: 'scale', defaultExpression: '1', support: 'positive' }],
    latexTemplate: '\\operatorname{HalfNormal}({sigma})',
    textTemplate: 'HalfNormal({sigma})',
  },
  {
    id: 'exponential',
    name: 'Exponential',
    aliases: ['Exp'],
    family: 'continuous',
    support: 'positive',
    params: [{ name: 'lam', required: true, role: 'rate', defaultExpression: '1', support: 'positive' }],
    latexTemplate: '\\operatorname{Exponential}({lam})',
    textTemplate: 'Exponential({lam})',
  },
  {
    id: 'lognormal',
    name: 'LogNormal',
    aliases: ['Lognormal'],
    family: 'continuous',
    support: 'positive',
    params: [
      { name: 'mu', required: true, role: 'location', defaultExpression: '0', support: 'real' },
      { name: 'sigma', required: true, role: 'scale', defaultExpression: '1', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{LogNormal}({mu}, {sigma})',
    textTemplate: 'LogNormal({mu}, {sigma})',
  },
  {
    id: 'bernoulli',
    name: 'Bernoulli',
    family: 'discrete',
    support: 'integer',
    params: [{ name: 'p', required: true, role: 'probability', defaultExpression: 'p', support: 'unit_interval' }],
    latexTemplate: '\\operatorname{Bernoulli}({p})',
    textTemplate: 'Bernoulli({p})',
  },
  {
    id: 'binomial',
    name: 'Binomial',
    family: 'discrete',
    support: 'nonnegative_integer',
    params: [
      { name: 'n', required: true, role: 'shape', defaultExpression: 'n', support: 'nonnegative_integer' },
      { name: 'p', required: true, role: 'probability', defaultExpression: 'p', support: 'unit_interval' },
    ],
    latexTemplate: '\\operatorname{Binomial}({n}, {p})',
    textTemplate: 'Binomial({n}, {p})',
  },
  {
    id: 'poisson',
    name: 'Poisson',
    family: 'count',
    support: 'nonnegative_integer',
    params: [{ name: 'lambda', required: true, role: 'rate', defaultExpression: 'lambda', support: 'positive' }],
    latexTemplate: '\\operatorname{Poisson}({lambda})',
    textTemplate: 'Poisson({lambda})',
  },
  {
    id: 'negative_binomial',
    name: 'NegativeBinomial',
    aliases: ['NegBinomial', 'Negative Binomial'],
    family: 'count',
    support: 'nonnegative_integer',
    params: [
      { name: 'mu', required: true, role: 'location', defaultExpression: 'mu', support: 'positive' },
      { name: 'alpha', required: true, role: 'shape', defaultExpression: 'alpha', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{NegativeBinomial}({mu}, {alpha})',
    textTemplate: 'NegativeBinomial({mu}, {alpha})',
    description: 'Count distribution using mean and overdispersion parameters.',
  },
  {
    id: 'beta',
    name: 'Beta',
    family: 'continuous',
    support: 'unit_interval',
    params: [
      { name: 'alpha', required: true, role: 'shape', defaultExpression: '1', support: 'positive' },
      { name: 'beta', required: true, role: 'shape', defaultExpression: '1', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{Beta}({alpha}, {beta})',
    textTemplate: 'Beta({alpha}, {beta})',
  },
  {
    id: 'dirichlet',
    name: 'Dirichlet',
    family: 'multivariate',
    support: 'simplex',
    params: [{ name: 'alpha', required: true, role: 'concentration', defaultExpression: 'alpha', support: 'positive' }],
    latexTemplate: '\\operatorname{Dirichlet}({alpha})',
    textTemplate: 'Dirichlet({alpha})',
  },
  {
    id: 'categorical',
    name: 'Categorical',
    family: 'categorical',
    support: 'integer',
    params: [{ name: 'p', required: true, role: 'probability', defaultExpression: 'p', support: 'simplex' }],
    latexTemplate: '\\operatorname{Categorical}({p})',
    textTemplate: 'Categorical({p})',
  },
  {
    id: 'laplace',
    name: 'Laplace',
    aliases: ['DoubleExponential', 'Double Exponential'],
    family: 'continuous',
    support: 'real',
    params: [
      { name: 'mu', required: true, role: 'location', defaultExpression: '0', support: 'real' },
      { name: 'b', required: true, role: 'scale', defaultExpression: '1', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{Laplace}({mu}, {b})',
    textTemplate: 'Laplace({mu}, {b})',
    description: 'Sharp-peaked robust prior often used for lasso-style shrinkage.',
  },
  {
    id: 'cauchy',
    name: 'Cauchy',
    family: 'continuous',
    support: 'real',
    params: [
      { name: 'alpha', required: true, role: 'location', defaultExpression: '0', support: 'real' },
      { name: 'beta', required: true, role: 'scale', defaultExpression: '1', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{Cauchy}({alpha}, {beta})',
    textTemplate: 'Cauchy({alpha}, {beta})',
    description: 'Heavy-tailed continuous distribution.',
  },
  {
    id: 'halfcauchy',
    name: 'HalfCauchy',
    aliases: ['Half-Cauchy'],
    family: 'continuous',
    support: 'positive',
    params: [{ name: 'beta', required: true, role: 'scale', defaultExpression: '1', support: 'positive' }],
    latexTemplate: '\\operatorname{HalfCauchy}({beta})',
    textTemplate: 'HalfCauchy({beta})',
    description: 'Positive heavy-tailed scale prior used in hierarchical and shrinkage models.',
  },
  {
    id: 'horseshoe',
    name: 'Horseshoe',
    family: 'continuous',
    support: 'real',
    params: [{ name: 'scale', required: true, role: 'scale', defaultExpression: 'tau0', support: 'positive' }],
    latexTemplate: '\\operatorname{Horseshoe}({scale})',
    textTemplate: 'Horseshoe({scale})',
    description: 'Collapsed shrinkage prior. Expanded structure should be represented as a prior recipe.',
    notes: 'Use the Horseshoe prior recipe when local and global shrinkage variables must be explicit.',
  },
  {
    id: 'multivariate_normal',
    name: 'MultivariateNormal',
    aliases: ['MvNormal', 'MVN'],
    family: 'multivariate',
    support: 'real',
    params: [
      { name: 'mu', required: true, role: 'location', defaultExpression: 'mu', support: 'real' },
      { name: 'cov', required: false, role: 'covariance', defaultExpression: 'Sigma', support: 'positive' },
      { name: 'chol', required: false, role: 'covariance', defaultExpression: 'L', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{MVN}({mu}, {cov})',
    textTemplate: 'MultivariateNormal({mu}, {cov})',
    description: 'Vector-valued normal distribution using covariance or Cholesky parameterization.',
    notes: 'Prefer either cov or chol, not both. Cholesky parameterization is usually more stable.',
  },
  {
    id: 'lkj_correlation',
    name: 'LKJCorrelation',
    aliases: ['LKJ'],
    family: 'multivariate',
    support: 'correlation_matrix',
    params: [{ name: 'eta', required: true, role: 'shape', defaultExpression: '1', support: 'positive' }],
    latexTemplate: '\\operatorname{LKJCorrelation}({eta})',
    textTemplate: 'LKJCorrelation({eta})',
    description: 'Prior over correlation matrices.',
  },
  {
    id: 'lkj_cholesky',
    name: 'LKJCholesky',
    family: 'multivariate',
    support: 'cholesky_factor_corr',
    params: [
      { name: 'eta', required: true, role: 'shape', defaultExpression: '1', support: 'positive' },
      { name: 'sd_dist', required: false, role: 'scale', defaultExpression: 'HalfNormal(1)', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{LKJCholesky}({eta})',
    textTemplate: 'LKJCholesky({eta})',
    description: 'Cholesky-factor representation for correlated random effects.',
  },
  {
    id: 'ordered_logistic',
    name: 'OrderedLogistic',
    family: 'categorical',
    support: 'ordered_category',
    params: [
      { name: 'eta', required: true, role: 'location', defaultExpression: 'eta', support: 'real' },
      { name: 'cutpoints', required: true, role: 'component', defaultExpression: 'cutpoints', support: 'ordered' },
    ],
    latexTemplate: '\\operatorname{OrderedLogistic}({eta}, {cutpoints})',
    textTemplate: 'OrderedLogistic({eta}, {cutpoints})',
    description: 'Likelihood for ordered categorical outcomes.',
  },
  {
    id: 'multinomial',
    name: 'Multinomial',
    family: 'categorical',
    support: 'nonnegative_integer',
    params: [
      { name: 'n', required: true, role: 'shape', defaultExpression: 'n', support: 'nonnegative_integer' },
      { name: 'p', required: true, role: 'probability', defaultExpression: 'p', support: 'simplex' },
    ],
    latexTemplate: '\\operatorname{Multinomial}({n}, {p})',
    textTemplate: 'Multinomial({n}, {p})',
  },
  {
    id: 'dirichlet_multinomial',
    name: 'DirichletMultinomial',
    family: 'categorical',
    support: 'nonnegative_integer',
    params: [
      { name: 'n', required: true, role: 'shape', defaultExpression: 'n', support: 'nonnegative_integer' },
      { name: 'alpha', required: true, role: 'concentration', defaultExpression: 'alpha', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{DirichletMultinomial}({n}, {alpha})',
    textTemplate: 'DirichletMultinomial({n}, {alpha})',
  },
  {
    id: 'zero_inflated_poisson',
    name: 'ZeroInflatedPoisson',
    family: 'count',
    support: 'nonnegative_integer',
    params: [
      { name: 'psi', required: true, role: 'probability', defaultExpression: 'psi', support: 'unit_interval' },
      { name: 'lambda', required: true, role: 'rate', defaultExpression: 'lambda', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{ZIP}({psi}, {lambda})',
    textTemplate: 'ZeroInflatedPoisson({psi}, {lambda})',
  },
  {
    id: 'zero_inflated_negative_binomial',
    name: 'ZeroInflatedNegativeBinomial',
    family: 'count',
    support: 'nonnegative_integer',
    params: [
      { name: 'psi', required: true, role: 'probability', defaultExpression: 'psi', support: 'unit_interval' },
      { name: 'mu', required: true, role: 'location', defaultExpression: 'mu', support: 'positive' },
      { name: 'alpha', required: true, role: 'shape', defaultExpression: 'alpha', support: 'positive' },
    ],
    latexTemplate: '\\operatorname{ZINB}({psi}, {mu}, {alpha})',
    textTemplate: 'ZeroInflatedNegativeBinomial({psi}, {mu}, {alpha})',
  },
  {
    id: 'mixture',
    name: 'Mixture',
    family: 'multivariate',
    support: 'custom',
    params: [
      { name: 'weights', required: true, role: 'weight', defaultExpression: 'w', support: 'simplex' },
      { name: 'components', required: true, role: 'component', defaultExpression: 'components' },
    ],
    latexTemplate: '\\operatorname{Mixture}({weights}, {components})',
    textTemplate: 'Mixture({weights}, {components})',
    description: 'Generic mixture wrapper; component distributions should be listed in handoff notes.',
  },
  {
    id: 'wishart',
    name: 'Wishart',
    family: 'multivariate',
    support: 'positive_definite_matrix',
    params: [
      { name: 'nu', required: true, role: 'df', defaultExpression: 'K + 1', support: 'positive' },
      { name: 'scale', required: true, role: 'scale', defaultExpression: 'S', support: 'positive_definite_matrix' },
    ],
    latexTemplate: '\\operatorname{Wishart}({nu}, {scale})',
    textTemplate: 'Wishart({nu}, {scale})',
    notes: 'Often discouraged for covariance modeling; consider LKJ plus scale priors.',
    deprecated: true,
  },
];

const distributionLookup = new Map<string, DistributionDefinition>();

for (const distribution of DISTRIBUTIONS) {
  distributionLookup.set(distribution.id.toLowerCase(), distribution);
  distributionLookup.set(distribution.name.toLowerCase(), distribution);
  for (const alias of distribution.aliases ?? []) {
    distributionLookup.set(alias.toLowerCase(), distribution);
  }
}

export function findDistribution(value?: string): DistributionDefinition | undefined {
  return value ? distributionLookup.get(value.trim().toLowerCase()) : undefined;
}

export function createDefaultDistribution(idOrName: string): DistributionSpec {
  const definition = findDistribution(idOrName);

  if (!definition) {
    return { name: idOrName, args: {} };
  }

  return {
    id: definition.id,
    name: definition.name,
    args: Object.fromEntries(
      definition.params
        .filter((param) => param.defaultExpression !== undefined)
        .map((param) => [param.name, param.defaultExpression ?? '']),
    ),
  };
}

export function normalizeDistribution(distribution: DistributionSpec): DistributionSpec {
  const definition = findDistribution(distribution.id ?? distribution.name);

  if (!definition) {
    return distribution;
  }

  return {
    id: definition.id,
    name: definition.name,
    args: distribution.args,
  };
}

export function formatDistributionText(distribution: DistributionSpec): string {
  const normalized = normalizeDistribution(distribution);
  const definition = findDistribution(normalized.id ?? normalized.name);

  if (!definition) {
    const args = Object.entries(normalized.args)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return `${normalized.name}(${args})`;
  }

  return applyTemplate(definition.textTemplate, normalized.args);
}

export function formatDistributionTex(distribution: DistributionSpec): string {
  const normalized = normalizeDistribution(distribution);
  const definition = findDistribution(normalized.id ?? normalized.name);

  if (!definition) {
    const args = Object.values(normalized.args).map(formatTexExpression).join(', ');
    return `\\operatorname{${normalized.name}}(${args})`;
  }

  return applyTemplate(definition.latexTemplate, normalized.args, formatTexExpression);
}

export function getDistributionSupport(distribution: DistributionSpec): string | undefined {
  return findDistribution(distribution.id ?? distribution.name)?.support;
}

function applyTemplate(
  template: string,
  args: Record<string, string>,
  formatValue: (value: string) => string = (value) => value,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (key in args) return formatValue(args[key]);
    if (/^[a-z][a-z0-9_]*$/.test(key)) return formatValue(key);
    return match;
  });
}

const GREEK_LETTERS: Record<string, string> = {
  alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
  epsilon: '\\epsilon', lambda: '\\lambda', mu: '\\mu', nu: '\\nu',
  sigma: '\\sigma', tau: '\\tau', theta: '\\theta', phi: '\\phi',
  psi: '\\psi', omega: '\\omega',
};

export function formatTexExpression(value: string): string {
  let result = value;

  // Iteratively replace innermost bracket subscripts: alpha[group_id[i]] → alpha_{group_id_{i}}
  let prev = '';
  while (result !== prev) {
    prev = result;
    result = result.replace(/\[([^\[\]]+)\]/g, '_{$1}');
  }

  result = result.replace(/\*/g, ' ');

  // Replace identifiers: Greek letters and underscore-separated names
  result = result.replace(/[a-zA-Z][a-zA-Z0-9]*(?:_(?!\{)[a-zA-Z][a-zA-Z0-9]*)*/g, (match) => {
    if (GREEK_LETTERS[match]) return GREEK_LETTERS[match];

    const parts = match.split('_');
    if (parts.length > 1 && GREEK_LETTERS[parts[0]]) {
      const base = GREEK_LETTERS[parts[0]];
      const sub = parts.slice(1).map((p) => GREEK_LETTERS[p] ?? p).join(',');
      return `${base}_{${sub}}`;
    }

    if (parts.length > 1) {
      return match.replace(/_/g, '\\_');
    }

    return match;
  });

  return result;
}
