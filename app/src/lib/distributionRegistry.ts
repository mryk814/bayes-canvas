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
  | 'df';

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
