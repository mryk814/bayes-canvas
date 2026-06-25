import type { Edge, Node } from '@xyflow/react';
import type { BayesNodeData } from '../lib/modelIr';
import { initialEdges, initialNodes } from './hierarchicalRegression.js';

export interface ModelTemplate {
  id: string;
  name: string;
  family: string;
  description: string;
  status: 'clean' | 'draft';
  expectedDiagnostics: {
    errors: number;
    warnings: number;
  };
  reviewQuestions: string[];
  nodes: Node<BayesNodeData>[];
  edges: Edge[];
}

const retailDemandNodes: Node<BayesNodeData>[] = [
  {
    id: 'market_id',
    position: { x: 80, y: 260 },
    data: { kind: 'data', name: 'market_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'time_id',
    position: { x: 80, y: 360 },
    data: { kind: 'data', name: 'time_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'channel_id',
    position: { x: 80, y: 460 },
    data: { kind: 'data', name: 'channel_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'price_obs',
    position: { x: 80, y: 560 },
    data: {
      kind: 'data',
      name: 'price_obs[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      constraints: [{ kind: 'positive' }],
      observationProcess: { kind: 'measurement_error', latentTrueSymbol: 'price_true[i]', errorScaleSymbol: 'sigma_price' },
    },
  },
  {
    id: 'media_spend',
    position: { x: 80, y: 660 },
    data: {
      kind: 'data',
      name: 'media_spend[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'exposure',
    position: { x: 80, y: 760 },
    data: {
      kind: 'data',
      name: 'exposure[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'stockout_gap',
    position: { x: 80, y: 860 },
    data: {
      kind: 'data',
      name: 'stockout_gap[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      observationProcess: { kind: 'missing', strategy: 'latent_imputation' },
    },
  },
  {
    id: 'channel_alpha',
    position: { x: 90, y: 1040 },
    data: {
      kind: 'data',
      name: 'channel_alpha',
      eventShape: ['C'],
      observed: true,
      constraints: [{ kind: 'positive' }],
      notes: 'Prior concentration vector for the channel allocation simplex.',
    },
  },
  {
    id: 'market_effect_mu',
    position: { x: 380, y: 80 },
    data: {
      kind: 'data',
      name: 'market_effect_mu',
      eventShape: ['K'],
      observed: true,
      notes: 'Prior mean vector for market intercept and price-slope deviations.',
    },
  },
  {
    id: 'market_effect_chol',
    position: { x: 620, y: 80 },
    data: {
      kind: 'hyperparameter',
      name: 'market_effect_chol',
      eventShape: ['K'],
      distribution: { id: 'lkj_cholesky', name: 'LKJCholesky', args: { eta: '2' } },
      constraints: [{ kind: 'positive' }],
      notes: 'Cholesky factor for correlated market intercept and price-slope deviations.',
    },
  },
  {
    id: 'tau_season',
    position: { x: 860, y: 80 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_season',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.5' } },
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'sigma_price',
    position: { x: 1100, y: 80 },
    data: {
      kind: 'hyperparameter',
      name: 'sigma_price',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.2' } },
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'overdispersion',
    position: { x: 1340, y: 80 },
    data: {
      kind: 'parameter',
      name: 'overdispersion',
      distribution: { id: 'exponential', name: 'Exponential', args: { lam: '1' } },
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'tau_media',
    position: { x: 1580, y: 80 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_media',
      distribution: { id: 'halfcauchy', name: 'HalfCauchy', args: { beta: '0.5' } },
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'zi_tau_market',
    position: { x: 1820, y: 80 },
    data: {
      kind: 'hyperparameter',
      name: 'zi_tau_market',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.7' } },
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'market_effect',
    position: { x: 500, y: 250 },
    data: {
      kind: 'parameter',
      name: 'market_effect[m]',
      shape: ['M'],
      eventShape: ['K'],
      plate: 'market',
      distribution: { id: 'multivariate_normal', name: 'MultivariateNormal', args: { mu: 'market_effect_mu', chol: 'market_effect_chol' } },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
      notes: 'Two market effects: demand intercept and price-slope deviation.',
    },
  },
  {
    id: 'season',
    position: { x: 850, y: 250 },
    data: {
      kind: 'parameter',
      name: 'season[t]',
      shape: ['T'],
      plate: 'time',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: 'tau_season' } },
      constraints: [{ kind: 'sum_to_zero', overPlateId: 'time' }],
    },
  },
  {
    id: 'channel_weight',
    position: { x: 1180, y: 250 },
    data: {
      kind: 'parameter',
      name: 'channel_weight',
      eventShape: ['C'],
      distribution: { id: 'dirichlet', name: 'Dirichlet', args: { alpha: 'channel_alpha' } },
      constraints: [{ kind: 'simplex' }],
      notes: 'Simplex allocation across observed sales channels.',
    },
  },
  {
    id: 'media_decay',
    position: { x: 1510, y: 250 },
    data: {
      kind: 'parameter',
      name: 'media_decay',
      distribution: { id: 'beta', name: 'Beta', args: { alpha: '2', beta: '2' } },
      constraints: [{ kind: 'unit_interval' }],
    },
  },
  {
    id: 'beta_media',
    position: { x: 1740, y: 250 },
    data: {
      kind: 'parameter',
      name: 'beta_media',
      distribution: { id: 'horseshoe', name: 'Horseshoe', args: { scale: 'tau_media' } },
      notes: 'Sparse media effect. Expanded local/global shrinkage is left to handoff.',
    },
  },
  {
    id: 'beta_price',
    position: { x: 1980, y: 250 },
    data: {
      kind: 'parameter',
      name: 'beta_price',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '-0.4', sigma: '0.2' } },
      notes: 'Global price elasticity baseline on the log-demand scale.',
    },
  },
  {
    id: 'gamma_stockout',
    position: { x: 2220, y: 250 },
    data: {
      kind: 'parameter',
      name: 'gamma_stockout',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '0.5' } },
    },
  },
  {
    id: 'zi_alpha',
    position: { x: 2460, y: 250 },
    data: {
      kind: 'parameter',
      name: 'zi_alpha',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '-2', sigma: '1' } },
      notes: 'Baseline structural-zero tendency.',
    },
  },
  {
    id: 'zi_market',
    position: { x: 2700, y: 250 },
    data: {
      kind: 'parameter',
      name: 'zi_market[m]',
      shape: ['M'],
      plate: 'market',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: 'zi_tau_market' } },
    },
  },
  {
    id: 'price_true',
    position: { x: 350, y: 560 },
    data: {
      kind: 'latent',
      name: 'price_true[i]',
      shape: ['N'],
      plate: 'obs',
      distribution: { id: 'lognormal', name: 'LogNormal', args: { mu: 'log(price_obs[i])', sigma: 'sigma_price' } },
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'price_slope',
    position: { x: 700, y: 560 },
    data: {
      kind: 'deterministic',
      name: 'price_slope[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'beta_price + market_effect[market_id[i], 1]',
    },
  },
  {
    id: 'media_effect',
    position: { x: 1050, y: 560 },
    data: {
      kind: 'deterministic',
      name: 'media_effect[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'log(1 + media_spend[i]) * media_decay * channel_weight[channel_id[i]]',
    },
  },
  {
    id: 'log_mu',
    position: { x: 1400, y: 560 },
    data: {
      kind: 'deterministic',
      name: 'log_mu[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'log(exposure[i]) + market_effect[market_id[i], 0] + season[time_id[i]] + price_slope[i] * price_true[i] + beta_media * media_effect[i] + gamma_stockout * stockout_gap[i]',
    },
  },
  {
    id: 'demand_mu',
    position: { x: 1750, y: 560 },
    data: {
      kind: 'deterministic',
      name: 'demand_mu[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'exp(log_mu[i])',
      constraints: [{ kind: 'positive' }],
    },
  },
  {
    id: 'zero_prob',
    position: { x: 2100, y: 560 },
    data: {
      kind: 'deterministic',
      name: 'zero_prob[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'inv_logit(zi_alpha + zi_market[market_id[i]] + gamma_stockout * stockout_gap[i])',
      constraints: [{ kind: 'unit_interval' }],
    },
  },
  {
    id: 'sales',
    position: { x: 1930, y: 760 },
    data: {
      kind: 'likelihood',
      name: 'sales[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      distribution: {
        id: 'zero_inflated_negative_binomial',
        name: 'ZeroInflatedNegativeBinomial',
        args: { psi: 'zero_prob[i]', mu: 'demand_mu[i]', alpha: 'overdispersion' },
      },
      observationProcess: { kind: 'missing', strategy: 'latent_imputation' },
    },
  },
  {
    id: 'posterior_predictive_checks',
    position: { x: 2280, y: 760 },
    data: {
      kind: 'model_block',
      name: 'posterior_predictive_checks',
      expression: 'sales, demand_mu, zero_prob, market_effect, channel_weight',
      validationLevel: 'structured',
      notes: 'Check zero counts, tail mass, market-level calibration, and channel lift concentration.',
    },
  },
  {
    id: 'qoi_price_elasticity',
    position: { x: 700, y: 1000 },
    data: {
      kind: 'derived_quantity',
      name: 'price_elasticity',
      expression: 'beta_price',
      notes: 'Global log-demand response to a one-unit price change.',
    },
  },
  {
    id: 'qoi_media_lift',
    position: { x: 1050, y: 1000 },
    data: {
      kind: 'derived_quantity',
      name: 'media_lift_10pct',
      expression: 'exp(beta_media * log(1.1)) - 1',
      notes: 'Approximate lift from a 10 percent media-spend increase.',
    },
  },
  {
    id: 'qoi_stockout_zero',
    position: { x: 1400, y: 1000 },
    data: {
      kind: 'derived_quantity',
      name: 'stockout_zero_inflation_effect',
      expression: 'gamma_stockout',
      notes: 'Shared stockout effect used by demand and structural-zero components.',
    },
  },
];

const retailDemandEdges: Edge[] = [
  { id: 'market_effect_mu-market_effect', source: 'market_effect_mu', target: 'market_effect', data: { role: 'prior-parameter' } },
  { id: 'market_effect_chol-market_effect', source: 'market_effect_chol', target: 'market_effect', data: { role: 'prior-parameter' } },
  { id: 'tau_season-season', source: 'tau_season', target: 'season', data: { role: 'prior-parameter' } },
  { id: 'channel_alpha-channel_weight', source: 'channel_alpha', target: 'channel_weight', data: { role: 'prior-parameter' } },
  { id: 'tau_media-beta_media', source: 'tau_media', target: 'beta_media', data: { role: 'prior-parameter' } },
  { id: 'zi_tau_market-zi_market', source: 'zi_tau_market', target: 'zi_market', data: { role: 'prior-parameter' } },
  { id: 'price_obs-price_true', source: 'price_obs', target: 'price_true', data: { role: 'observed-value' } },
  { id: 'sigma_price-price_true', source: 'sigma_price', target: 'price_true', data: { role: 'likelihood-parameter' } },
  { id: 'beta_price-price_slope', source: 'beta_price', target: 'price_slope', data: { role: 'deterministic-input' } },
  { id: 'market_effect-price_slope', source: 'market_effect', target: 'price_slope', data: { role: 'deterministic-input' } },
  { id: 'market_id-price_slope', source: 'market_id', target: 'price_slope', data: { role: 'index' } },
  { id: 'media_spend-media_effect', source: 'media_spend', target: 'media_effect', data: { role: 'data-input' } },
  { id: 'media_decay-media_effect', source: 'media_decay', target: 'media_effect', data: { role: 'deterministic-input' } },
  { id: 'channel_weight-media_effect', source: 'channel_weight', target: 'media_effect', data: { role: 'deterministic-input' } },
  { id: 'channel_id-media_effect', source: 'channel_id', target: 'media_effect', data: { role: 'index' } },
  { id: 'exposure-log_mu', source: 'exposure', target: 'log_mu', data: { role: 'offset' } },
  { id: 'market_effect-log_mu', source: 'market_effect', target: 'log_mu', data: { role: 'deterministic-input' } },
  { id: 'market_id-log_mu', source: 'market_id', target: 'log_mu', data: { role: 'index' } },
  { id: 'season-log_mu', source: 'season', target: 'log_mu', data: { role: 'deterministic-input' } },
  { id: 'time_id-log_mu', source: 'time_id', target: 'log_mu', data: { role: 'index' } },
  { id: 'price_slope-log_mu', source: 'price_slope', target: 'log_mu', data: { role: 'deterministic-input' } },
  { id: 'price_true-log_mu', source: 'price_true', target: 'log_mu', data: { role: 'latent-input' } },
  { id: 'media_effect-log_mu', source: 'media_effect', target: 'log_mu', data: { role: 'deterministic-input' } },
  { id: 'beta_media-log_mu', source: 'beta_media', target: 'log_mu', data: { role: 'deterministic-input' } },
  { id: 'gamma_stockout-log_mu', source: 'gamma_stockout', target: 'log_mu', data: { role: 'deterministic-input' } },
  { id: 'stockout_gap-log_mu', source: 'stockout_gap', target: 'log_mu', data: { role: 'data-input' } },
  { id: 'log_mu-demand_mu', source: 'log_mu', target: 'demand_mu', data: { role: 'deterministic-input' } },
  { id: 'zi_alpha-zero_prob', source: 'zi_alpha', target: 'zero_prob', data: { role: 'deterministic-input' } },
  { id: 'zi_market-zero_prob', source: 'zi_market', target: 'zero_prob', data: { role: 'deterministic-input' } },
  { id: 'market_id-zero_prob', source: 'market_id', target: 'zero_prob', data: { role: 'index' } },
  { id: 'gamma_stockout-zero_prob', source: 'gamma_stockout', target: 'zero_prob', data: { role: 'deterministic-input' } },
  { id: 'stockout_gap-zero_prob', source: 'stockout_gap', target: 'zero_prob', data: { role: 'data-input' } },
  { id: 'demand_mu-sales', source: 'demand_mu', target: 'sales', data: { role: 'likelihood-parameter' } },
  { id: 'zero_prob-sales', source: 'zero_prob', target: 'sales', data: { role: 'likelihood-parameter' } },
  { id: 'overdispersion-sales', source: 'overdispersion', target: 'sales', data: { role: 'likelihood-parameter' } },
  { id: 'sales-posterior_predictive_checks', source: 'sales', target: 'posterior_predictive_checks', data: { role: 'block-input' } },
  { id: 'demand_mu-posterior_predictive_checks', source: 'demand_mu', target: 'posterior_predictive_checks', data: { role: 'block-input' } },
  { id: 'zero_prob-posterior_predictive_checks', source: 'zero_prob', target: 'posterior_predictive_checks', data: { role: 'block-input' } },
  { id: 'market_effect-posterior_predictive_checks', source: 'market_effect', target: 'posterior_predictive_checks', data: { role: 'block-input' } },
  { id: 'channel_weight-posterior_predictive_checks', source: 'channel_weight', target: 'posterior_predictive_checks', data: { role: 'block-input' } },
  { id: 'beta_price-qoi_price_elasticity', source: 'beta_price', target: 'qoi_price_elasticity', data: { role: 'query-source' } },
  { id: 'beta_media-qoi_media_lift', source: 'beta_media', target: 'qoi_media_lift', data: { role: 'query-source' } },
  { id: 'gamma_stockout-qoi_stockout_zero', source: 'gamma_stockout', target: 'qoi_stockout_zero', data: { role: 'query-source' } },
];

export const modelTemplates: ModelTemplate[] = [
  {
    id: 'hierarchical-regression',
    name: 'Hierarchical regression',
    family: 'Regression',
    description: 'Group-level intercepts with an observed outcome and QoI-ready slope.',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      'Are groups exchangeable for the current study design?',
      'Is the observation process censored, rounded, or exact?',
    ],
    nodes: initialNodes,
    edges: initialEdges,
  },
  {
    id: 'logistic-regression',
    name: 'Logistic regression',
    family: 'Binary outcome',
    description: 'Binary likelihood with linear predictor and treatment-effect coefficient.',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      'Should the coefficient be reported on log-odds or probability scale?',
      'Are class imbalance or separation risks expected?',
    ],
    nodes: [
      {
        id: 'x',
        position: { x: 120, y: 220 },
        data: { kind: 'data', name: 'x[i]', shape: ['N'], plate: 'obs', observed: true },
      },
      {
        id: 'alpha',
        position: { x: 300, y: 60 },
        data: {
          kind: 'parameter',
          name: 'alpha',
          distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '2' } },
        },
      },
      {
        id: 'beta',
        position: { x: 500, y: 60 },
        data: {
          kind: 'parameter',
          name: 'beta',
          distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } },
          notes: 'Primary log-odds effect. Review scale before handoff.',
        },
      },
      {
        id: 'logit_p',
        position: { x: 300, y: 300 },
        data: {
          kind: 'deterministic',
          name: 'logit_p[i]',
          shape: ['N'],
          plate: 'obs',
          expression: 'alpha + beta * x[i]',
        },
      },
      {
        id: 'y',
        position: { x: 300, y: 470 },
        data: {
          kind: 'likelihood',
          name: 'y[i]',
          plate: 'obs',
          observed: true,
          distribution: { id: 'bernoulli', name: 'Bernoulli', args: { p: 'inv_logit(logit_p[i])' } },
        },
      },
      {
        id: 'qoi_beta',
        position: { x: 560, y: 300 },
        data: {
          kind: 'derived_quantity',
          name: 'treatment_effect',
          expression: 'beta',
          notes: 'QoI placeholder for implementation handoff.',
        },
      },
    ],
    edges: [
      { id: 'x-logit_p', source: 'x', target: 'logit_p', data: { role: 'data-input' } },
      { id: 'alpha-logit_p', source: 'alpha', target: 'logit_p', data: { role: 'deterministic-input' } },
      { id: 'beta-logit_p', source: 'beta', target: 'logit_p', data: { role: 'deterministic-input' } },
      { id: 'logit_p-y', source: 'logit_p', target: 'y', data: { role: 'likelihood-parameter' } },
      { id: 'beta-qoi_beta', source: 'beta', target: 'qoi_beta', data: { role: 'query-source' } },
    ],
  },
  {
    id: 'poisson-count',
    name: 'Poisson count model',
    family: 'Count outcome',
    description: 'Log-rate model for count data with exposure offset.',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      'Does the data show overdispersion that needs Negative Binomial?',
      'Is exposure measured reliably for every observation?',
    ],
    nodes: [
      {
        id: 'x',
        position: { x: 100, y: 220 },
        data: { kind: 'data', name: 'x[i]', shape: ['N'], plate: 'obs', observed: true },
      },
      {
        id: 'exposure',
        position: { x: 320, y: 220 },
        data: { kind: 'data', name: 'exposure[i]', shape: ['N'], plate: 'obs', observed: true, constraints: [{ kind: 'positive' }] },
      },
      {
        id: 'alpha',
        position: { x: 220, y: 60 },
        data: { kind: 'parameter', name: 'alpha', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '2' } } },
      },
      {
        id: 'beta',
        position: { x: 440, y: 60 },
        data: { kind: 'parameter', name: 'beta', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } } },
      },
      {
        id: 'log_rate',
        position: { x: 300, y: 340 },
        data: {
          kind: 'deterministic',
          name: 'log_rate[i]',
          shape: ['N'],
          plate: 'obs',
          expression: 'alpha + beta * x[i] + log(exposure[i])',
        },
      },
      {
        id: 'y',
        position: { x: 300, y: 500 },
        data: {
          kind: 'likelihood',
          name: 'y[i]',
          plate: 'obs',
          observed: true,
          distribution: { id: 'poisson', name: 'Poisson', args: { lambda: 'exp(log_rate[i])' } },
        },
      },
    ],
    edges: [
      { id: 'x-log_rate', source: 'x', target: 'log_rate', data: { role: 'data-input' } },
      { id: 'exposure-log_rate', source: 'exposure', target: 'log_rate', data: { role: 'offset' } },
      { id: 'alpha-log_rate', source: 'alpha', target: 'log_rate', data: { role: 'deterministic-input' } },
      { id: 'beta-log_rate', source: 'beta', target: 'log_rate', data: { role: 'deterministic-input' } },
      { id: 'log_rate-y', source: 'log_rate', target: 'y', data: { role: 'likelihood-parameter' } },
    ],
  },
  {
    id: 'hierarchical-retail-demand',
    name: 'Hierarchical retail demand',
    family: 'Demand forecasting',
    description: 'ZINB demand model with market, time, channel, media, measurement-error, and QoI structure.',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      'Are market, channel, and time indices stable across the exported dataset?',
      'Should stockouts enter demand, zero inflation, or both components?',
      'Is media carryover better represented by an explicit lagged adstock block before handoff?',
    ],
    nodes: retailDemandNodes,
    edges: retailDemandEdges,
  },
];
