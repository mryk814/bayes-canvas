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
    position: { x: 432, y: 1904 },
    data: { kind: 'data', name: 'market_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'time_id',
    position: { x: 768, y: 1904 },
    data: { kind: 'data', name: 'time_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'channel_id',
    position: { x: 432, y: 2072 },
    data: { kind: 'data', name: 'channel_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'price_obs',
    position: { x: 432, y: 2240 },
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
    position: { x: 432, y: 2408 },
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
    position: { x: 768, y: 2576 },
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
    position: { x: 768, y: 2744 },
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
    position: { x: 96, y: 764 },
    data: {
      kind: 'data',
      name: 'channel_alpha',
      eventShape: ['C'],
      observed: true,
      constraints: [{ kind: 'positive' }],
      notes: 'チャネル配分 simplex の事前集中度ベクトル。',
    },
  },
  {
    id: 'market_effect_mu',
    position: { x: 96, y: 596 },
    data: {
      kind: 'data',
      name: 'market_effect_mu',
      eventShape: ['K'],
      observed: true,
      notes: '市場別の切片と価格傾きのずれに使う事前平均ベクトル。',
    },
  },
  {
    id: 'market_effect_chol',
    position: { x: 96, y: 428 },
    data: {
      kind: 'hyperparameter',
      name: 'market_effect_chol',
      eventShape: ['K', 'K'],
      distribution: { id: 'lkj_cholesky', name: 'LKJCholesky', args: { eta: '2', sd_dist: 'HalfNormal(1)' } },
      notes: '市場別の切片と価格傾きの相関とスケールを表す Cholesky 因子。',
    },
  },
  {
    id: 'tau_season',
    position: { x: 432, y: 428 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_season',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.5' } },
    },
  },
  {
    id: 'sigma_price',
    position: { x: 432, y: 596 },
    data: {
      kind: 'hyperparameter',
      name: 'sigma_price',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.2' } },
    },
  },
  {
    id: 'overdispersion',
    position: { x: 1440, y: 428 },
    data: {
      kind: 'parameter',
      name: 'overdispersion',
      distribution: { id: 'exponential', name: 'Exponential', args: { lam: '1' } },
    },
  },
  {
    id: 'tau_media',
    position: { x: 432, y: 764 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_media',
      distribution: { id: 'halfcauchy', name: 'HalfCauchy', args: { beta: '0.5' } },
    },
  },
  {
    id: 'zi_tau_market',
    position: { x: 768, y: 428 },
    data: {
      kind: 'hyperparameter',
      name: 'zi_tau_market',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.7' } },
    },
  },
  {
    id: 'market_effect',
    position: { x: 432, y: 1586 },
    data: {
      kind: 'parameter',
      name: 'market_effect[m]',
      shape: ['M'],
      eventShape: ['K'],
      plate: 'market',
      distribution: { id: 'multivariate_normal', name: 'MultivariateNormal', args: { mu: 'market_effect_mu', chol: 'market_effect_chol' } },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
      notes: '需要切片と価格傾きのずれをまとめた市場別効果。',
    },
  },
  {
    id: 'season',
    position: { x: 768, y: 110 },
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
    position: { x: 432, y: 932 },
    data: {
      kind: 'parameter',
      name: 'channel_weight',
      eventShape: ['C'],
      distribution: { id: 'dirichlet', name: 'Dirichlet', args: { alpha: 'channel_alpha' } },
      notes: '観測された販売チャネル間の simplex 配分。',
    },
  },
  {
    id: 'media_decay',
    position: { x: 432, y: 1100 },
    data: {
      kind: 'parameter',
      name: 'media_decay',
      distribution: { id: 'beta', name: 'Beta', args: { alpha: '2', beta: '2' } },
    },
  },
  {
    id: 'beta_media',
    position: { x: 768, y: 764 },
    data: {
      kind: 'parameter',
      name: 'beta_media',
      distribution: { id: 'horseshoe', name: 'Horseshoe', args: { scale: 'tau_media' } },
      notes: '疎なメディア効果。local/global shrinkage の展開は handoff 側で確認する。',
    },
  },
  {
    id: 'beta_price',
    position: { x: 432, y: 1268 },
    data: {
      kind: 'parameter',
      name: 'beta_price',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '-0.4', sigma: '0.2' } },
      notes: 'log 需要スケールでの価格弾力性の全体基準。',
    },
  },
  {
    id: 'gamma_stockout',
    position: { x: 768, y: 596 },
    data: {
      kind: 'parameter',
      name: 'gamma_stockout',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '0.5' } },
    },
  },
  {
    id: 'zi_alpha',
    position: { x: 1104, y: 428 },
    data: {
      kind: 'parameter',
      name: 'zi_alpha',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '-2', sigma: '1' } },
      notes: '構造的ゼロが出やすい度合いの基準。',
    },
  },
  {
    id: 'zi_market',
    position: { x: 1104, y: 1586 },
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
    position: { x: 768, y: 2240 },
    data: {
      kind: 'latent',
      name: 'price_true[i]',
      shape: ['N'],
      plate: 'obs',
      distribution: { id: 'lognormal', name: 'LogNormal', args: { mu: 'log(price_obs[i])', sigma: 'sigma_price' } },
    },
  },
  {
    id: 'price_slope',
    position: { x: 768, y: 2072 },
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
    position: { x: 768, y: 2408 },
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
    position: { x: 1104, y: 1904 },
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
    position: { x: 1440, y: 1904 },
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
    position: { x: 1440, y: 2072 },
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
    position: { x: 1776, y: 1904 },
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
    id: 'qoi_sales_ppc_gap',
    position: { x: 2112, y: 428 },
    data: {
      kind: 'derived_quantity',
      name: 'sales_mean_gap',
      expression: 'mean(sales) - mean(demand_mu)',
      notes: '観測販売数と期待需要の平均差を見る posterior predictive check。',
    },
  },
  {
    id: 'qoi_zero_share',
    position: { x: 2112, y: 2072 },
    data: {
      kind: 'derived_quantity',
      name: 'mean_zero_probability',
      expression: 'mean(zero_prob)',
      notes: '構造的ゼロがどの程度の比率で発生しそうかを見る確認量。',
    },
  },
  {
    id: 'qoi_market_spread',
    position: { x: 2112, y: 1586 },
    data: {
      kind: 'derived_quantity',
      name: 'market_effect_spread',
      expression: 'max(market_effect[:, 0]) - min(market_effect[:, 0])',
      notes: '市場別切片の広がりを、calibration 確認の入口として見る。',
    },
  },
  {
    id: 'qoi_channel_concentration',
    position: { x: 2112, y: 932 },
    data: {
      kind: 'derived_quantity',
      name: 'top_channel_weight',
      expression: 'max(channel_weight)',
      notes: 'チャネル配分が一部チャネルへ寄りすぎていないかを見る確認量。',
    },
  },
  {
    id: 'qoi_price_elasticity',
    position: { x: 2112, y: 1268 },
    data: {
      kind: 'derived_quantity',
      name: 'price_elasticity',
      expression: 'beta_price',
      notes: '価格が1単位変わったときの log 需要の全体反応。',
    },
  },
  {
    id: 'qoi_media_lift',
    position: { x: 2112, y: 596 },
    data: {
      kind: 'derived_quantity',
      name: 'media_lift_10pct',
      expression: 'exp(beta_media * media_decay * mean(channel_weight) * log(1.1)) - 1',
      notes: '平均的なチャネル配分でメディア支出が10%増えたときの lift 近似。',
    },
  },
  {
    id: 'qoi_stockout_zero',
    position: { x: 2112, y: 764 },
    data: {
      kind: 'derived_quantity',
      name: 'stockout_zero_inflation_effect',
      expression: 'gamma_stockout',
      notes: '需要成分と構造的ゼロ成分で共有する欠品効果。',
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
  { id: 'sales-qoi_sales_ppc_gap', source: 'sales', target: 'qoi_sales_ppc_gap', data: { role: 'query-source' } },
  { id: 'demand_mu-qoi_sales_ppc_gap', source: 'demand_mu', target: 'qoi_sales_ppc_gap', data: { role: 'query-source' } },
  { id: 'zero_prob-qoi_zero_share', source: 'zero_prob', target: 'qoi_zero_share', data: { role: 'query-source' } },
  { id: 'market_effect-qoi_market_spread', source: 'market_effect', target: 'qoi_market_spread', data: { role: 'query-source' } },
  { id: 'channel_weight-qoi_channel_concentration', source: 'channel_weight', target: 'qoi_channel_concentration', data: { role: 'query-source' } },
  { id: 'beta_price-qoi_price_elasticity', source: 'beta_price', target: 'qoi_price_elasticity', data: { role: 'query-source' } },
  { id: 'beta_media-qoi_media_lift', source: 'beta_media', target: 'qoi_media_lift', data: { role: 'query-source' } },
  { id: 'media_decay-qoi_media_lift', source: 'media_decay', target: 'qoi_media_lift', data: { role: 'query-source' } },
  { id: 'channel_weight-qoi_media_lift', source: 'channel_weight', target: 'qoi_media_lift', data: { role: 'query-source' } },
  { id: 'gamma_stockout-qoi_stockout_zero', source: 'gamma_stockout', target: 'qoi_stockout_zero', data: { role: 'query-source' } },
];

const correlatedPanelNodes: Node<BayesNodeData>[] = [
  {
    id: 'dose',
    position: { x: 432, y: 596 },
    data: { kind: 'data', name: 'dose[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'zero_vec',
    position: { x: 96, y: 278 },
    data: {
      kind: 'data',
      name: 'zero_vec',
      eventShape: ['K'],
      observed: true,
      notes: 'アウトカム次元ごとの係数事前分布で共有するゼロベクトル。',
    },
  },
  {
    id: 'coef_chol',
    position: { x: 96, y: 110 },
    data: {
      kind: 'hyperparameter',
      name: 'coef_chol',
      eventShape: ['K', 'K'],
      distribution: { id: 'lkj_cholesky', name: 'LKJCholesky', args: { eta: '2', sd_dist: 'HalfNormal(1)' } },
      notes: 'アウトカム次元間で共有する係数相関とスケールの Cholesky 因子。',
    },
  },
  {
    id: 'outcome_chol',
    position: { x: 768, y: 110 },
    data: {
      kind: 'hyperparameter',
      name: 'outcome_chol',
      eventShape: ['K', 'K'],
      distribution: { id: 'lkj_cholesky', name: 'LKJCholesky', args: { eta: '3', sd_dist: 'HalfNormal(1)' } },
      notes: '多変量尤度で共有する残差相関とスケールの Cholesky 因子。',
    },
  },
  {
    id: 'alpha',
    position: { x: 432, y: 110 },
    data: {
      kind: 'parameter',
      name: 'alpha',
      eventShape: ['K'],
      distribution: { id: 'multivariate_normal', name: 'MultivariateNormal', args: { mu: 'zero_vec', chol: 'coef_chol' } },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
      notes: 'アウトカムベクトルの相関した基準水準。',
    },
  },
  {
    id: 'beta',
    position: { x: 432, y: 278 },
    data: {
      kind: 'parameter',
      name: 'beta',
      eventShape: ['K'],
      distribution: { id: 'multivariate_normal', name: 'MultivariateNormal', args: { mu: 'zero_vec', chol: 'coef_chol' } },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
      notes: 'アウトカム次元間で相関する dose 効果。',
    },
  },
  {
    id: 'mu',
    position: { x: 768, y: 596 },
    data: {
      kind: 'deterministic',
      name: 'mu[i]',
      shape: ['N'],
      eventShape: ['K'],
      plate: 'obs',
      expression: 'alpha + beta * dose[i]',
    },
  },
  {
    id: 'y',
    position: { x: 1104, y: 596 },
    data: {
      kind: 'likelihood',
      name: 'y[i]',
      shape: ['N'],
      eventShape: ['K'],
      plate: 'obs',
      observed: true,
      distribution: { id: 'multivariate_normal', name: 'MultivariateNormal', args: { mu: 'mu[i]', chol: 'outcome_chol' } },
      notes: '残差相関を持つ観測ベクトルアウトカム。',
    },
  },
  {
    id: 'qoi_beta',
    position: { x: 1104, y: 278 },
    data: {
      kind: 'derived_quantity',
      name: 'dose_effect_vector',
      expression: 'beta',
      notes: 'ベクトルアウトカムスケールでの主要な関心量。',
    },
  },
];

const correlatedPanelEdges: Edge[] = [
  { id: 'zero_vec-alpha', source: 'zero_vec', target: 'alpha', data: { role: 'prior-parameter' } },
  { id: 'coef_chol-alpha', source: 'coef_chol', target: 'alpha', data: { role: 'prior-parameter' } },
  { id: 'zero_vec-beta', source: 'zero_vec', target: 'beta', data: { role: 'prior-parameter' } },
  { id: 'coef_chol-beta', source: 'coef_chol', target: 'beta', data: { role: 'prior-parameter' } },
  { id: 'dose-mu', source: 'dose', target: 'mu', data: { role: 'data-input' } },
  { id: 'alpha-mu', source: 'alpha', target: 'mu', data: { role: 'deterministic-input' } },
  { id: 'beta-mu', source: 'beta', target: 'mu', data: { role: 'deterministic-input' } },
  { id: 'mu-y', source: 'mu', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'outcome_chol-y', source: 'outcome_chol', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'beta-qoi_beta', source: 'beta', target: 'qoi_beta', data: { role: 'query-source' } },
];

const unevenBinomialNodes: Node<BayesNodeData>[] = [
  {
    id: 'site_id',
    position: { x: 432, y: 914 },
    data: { kind: 'data', name: 'site_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'x',
    position: { x: 432, y: 1082 },
    data: {
      kind: 'data',
      name: 'x[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      observationProcess: { kind: 'missing', strategy: 'note_only' },
      notes: '調査努力が低い行では predictor が欠測しうる。実装時に補完するか除外するかを決める。',
    },
  },
  {
    id: 'trials',
    position: { x: 768, y: 1082 },
    data: {
      kind: 'data',
      name: 'trials[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      notes: '行ごとの分母。観測努力が行によって異なる。',
    },
  },
  {
    id: 'alpha_bar',
    position: { x: 96, y: 110 },
    data: { kind: 'hyperparameter', name: 'alpha_bar', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1.5' } } },
  },
  {
    id: 'tau_site',
    position: { x: 96, y: 278 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_site',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '1' } },
    },
  },
  {
    id: 'alpha_site',
    position: { x: 432, y: 596 },
    data: {
      kind: 'parameter',
      name: 'alpha_site[s]',
      shape: ['S'],
      plate: 'site',
      distribution: { id: 'normal', name: 'Normal', args: { mu: 'alpha_bar', sigma: 'tau_site' } },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
    },
  },
  {
    id: 'beta',
    position: { x: 432, y: 110 },
    data: { kind: 'parameter', name: 'beta', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } } },
  },
  {
    id: 'logit_p',
    position: { x: 768, y: 914 },
    data: {
      kind: 'deterministic',
      name: 'logit_p[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'alpha_site[site_id[i]] + beta * x[i]',
    },
  },
  {
    id: 'successes',
    position: { x: 1104, y: 914 },
    data: {
      kind: 'likelihood',
      name: 'successes[i]',
      plate: 'obs',
      observed: true,
      distribution: { id: 'binomial', name: 'Binomial', args: { n: 'trials[i]', p: 'inv_logit(logit_p[i])' } },
      notes: '行ごとの試行数で条件づけてから比較できる count。',
    },
  },
  {
    id: 'qoi_site_spread',
    position: { x: 1104, y: 596 },
    data: {
      kind: 'derived_quantity',
      name: 'site_probability_spread',
      expression: 'max(inv_logit(alpha_site)) - min(inv_logit(alpha_site))',
      notes: '不均一な分母を考慮したあとのサイト間の運用上の差。',
    },
  },
];

const unevenBinomialEdges: Edge[] = [
  { id: 'alpha_bar-alpha_site', source: 'alpha_bar', target: 'alpha_site', data: { role: 'prior-parameter' } },
  { id: 'tau_site-alpha_site', source: 'tau_site', target: 'alpha_site', data: { role: 'prior-parameter' } },
  { id: 'site_id-logit_p', source: 'site_id', target: 'logit_p', data: { role: 'index' } },
  { id: 'x-logit_p', source: 'x', target: 'logit_p', data: { role: 'data-input' } },
  { id: 'alpha_site-logit_p', source: 'alpha_site', target: 'logit_p', data: { role: 'deterministic-input' } },
  { id: 'beta-logit_p', source: 'beta', target: 'logit_p', data: { role: 'deterministic-input' } },
  { id: 'trials-successes', source: 'trials', target: 'successes', data: { role: 'likelihood-parameter' } },
  { id: 'logit_p-successes', source: 'logit_p', target: 'successes', data: { role: 'likelihood-parameter' } },
  { id: 'alpha_site-qoi_site_spread', source: 'alpha_site', target: 'qoi_site_spread', data: { role: 'query-source' } },
];

const censoredAssayNodes: Node<BayesNodeData>[] = [
  {
    id: 'batch_id',
    position: { x: 432, y: 746 },
    data: { kind: 'data', name: 'batch_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'dilution',
    position: { x: 432, y: 914 },
    data: {
      kind: 'data',
      name: 'dilution[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      constraints: [{ kind: 'positive' }],
      notes: '行ごとの希釈率が、尤度評価前の測定スケールを変える。',
    },
  },
  {
    id: 'lod',
    position: { x: 768, y: 914 },
    data: {
      kind: 'data',
      name: 'lod[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      constraints: [{ kind: 'positive' }],
      notes: '検出限界は単一定数ではなく行ごとに異なる。',
    },
  },
  {
    id: 'mu_base',
    position: { x: 432, y: 110 },
    data: { kind: 'parameter', name: 'mu_base', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '2' } } },
  },
  {
    id: 'tau_batch',
    position: { x: 96, y: 110 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_batch',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.5' } },
    },
  },
  {
    id: 'batch_offset',
    position: { x: 432, y: 428 },
    data: {
      kind: 'parameter',
      name: 'batch_offset[b]',
      shape: ['B'],
      plate: 'batch',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: 'tau_batch' } },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
      notes: '分析対象そのものではなく、測定機器 batch による補正項。',
    },
  },
  {
    id: 'sigma_assay',
    position: { x: 768, y: 110 },
    data: {
      kind: 'parameter',
      name: 'sigma_assay',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.4' } },
    },
  },
  {
    id: 'log_conc_mu',
    position: { x: 768, y: 746 },
    data: {
      kind: 'deterministic',
      name: 'log_conc_mu[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'mu_base + batch_offset[batch_id[i]] - log(dilution[i])',
    },
  },
  {
    id: 'assay_value',
    position: { x: 1104, y: 746 },
    data: {
      kind: 'likelihood',
      name: 'assay_value[i]',
      plate: 'obs',
      observed: true,
      distribution: { id: 'lognormal', name: 'LogNormal', args: { mu: 'log_conc_mu[i]', sigma: 'sigma_assay' } },
      observationProcess: { kind: 'censored', direction: 'left', boundSymbol: 'lod[i]' },
      notes: '行ごとの検出限界を下回る値は、ゼロ丸めではなく左打ち切りとして扱う。',
    },
  },
  {
    id: 'qoi_detection_share',
    position: { x: 1104, y: 110 },
    data: {
      kind: 'derived_quantity',
      name: 'expected_below_lod_share',
      expression: 'mean(cdf_lognormal(lod, log_conc_mu, sigma_assay))',
      notes: '打ち切り行がどの程度情報を持つかを確認する posterior check。',
    },
  },
];

const censoredAssayEdges: Edge[] = [
  { id: 'tau_batch-batch_offset', source: 'tau_batch', target: 'batch_offset', data: { role: 'prior-parameter' } },
  { id: 'mu_base-log_conc_mu', source: 'mu_base', target: 'log_conc_mu', data: { role: 'deterministic-input' } },
  { id: 'batch_offset-log_conc_mu', source: 'batch_offset', target: 'log_conc_mu', data: { role: 'deterministic-input' } },
  { id: 'batch_id-log_conc_mu', source: 'batch_id', target: 'log_conc_mu', data: { role: 'index' } },
  { id: 'dilution-log_conc_mu', source: 'dilution', target: 'log_conc_mu', data: { role: 'offset' } },
  { id: 'log_conc_mu-assay_value', source: 'log_conc_mu', target: 'assay_value', data: { role: 'likelihood-parameter' } },
  { id: 'sigma_assay-assay_value', source: 'sigma_assay', target: 'assay_value', data: { role: 'likelihood-parameter' } },
  { id: 'lod-assay_value', source: 'lod', target: 'assay_value', data: { role: 'observed-value' } },
  { id: 'lod-qoi_detection_share', source: 'lod', target: 'qoi_detection_share', data: { role: 'query-source' } },
  { id: 'log_conc_mu-qoi_detection_share', source: 'log_conc_mu', target: 'qoi_detection_share', data: { role: 'query-source' } },
  { id: 'sigma_assay-qoi_detection_share', source: 'sigma_assay', target: 'qoi_detection_share', data: { role: 'query-source' } },
];

const choiceSetNodes: Node<BayesNodeData>[] = [
  {
    id: 'price',
    position: { x: 432, y: 914 },
    data: {
      kind: 'data',
      name: 'price[i]',
      shape: ['N'],
      eventShape: ['C'],
      plate: 'obs',
      observed: true,
      notes: '選択課題ごとの候補行列。利用不可の選択肢もデータ上で明示しておく。',
    },
  },
  {
    id: 'quality',
    position: { x: 432, y: 1082 },
    data: { kind: 'data', name: 'quality[i]', shape: ['N'], eventShape: ['C'], plate: 'obs', observed: true },
  },
  {
    id: 'available_logit_offset',
    position: { x: 432, y: 1250 },
    data: {
      kind: 'data',
      name: 'available_logit_offset[i]',
      shape: ['N'],
      eventShape: ['C'],
      plate: 'obs',
      observed: true,
      notes: '行ごとに異なる選択肢集合を、利用不可候補の確率をほぼゼロへ寄せる形で表す。',
    },
  },
  {
    id: 'person_id',
    position: { x: 432, y: 1418 },
    data: { kind: 'data', name: 'person_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'tau_person',
    position: { x: 96, y: 110 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_person',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.8' } },
    },
  },
  {
    id: 'person_quality_shift',
    position: { x: 432, y: 596 },
    data: {
      kind: 'parameter',
      name: 'person_quality_shift[p]',
      shape: ['P'],
      plate: 'person',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: 'tau_person' } },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
      notes: '回答者ごとの quality 感度のずれ。全候補に同じ切片を足すと softmax で消えるため、係数差として置く。',
    },
  },
  {
    id: 'beta_price',
    position: { x: 432, y: 110 },
    data: { kind: 'parameter', name: 'beta_price', distribution: { id: 'normal', name: 'Normal', args: { mu: '-1', sigma: '0.5' } } },
  },
  {
    id: 'beta_quality',
    position: { x: 432, y: 278 },
    data: { kind: 'parameter', name: 'beta_quality', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } } },
  },
  {
    id: 'choice_prob',
    position: { x: 768, y: 914 },
    data: {
      kind: 'deterministic',
      name: 'choice_prob[i]',
      shape: ['N'],
      eventShape: ['C'],
      plate: 'obs',
      expression: 'softmax((beta_quality + person_quality_shift[person_id[i]]) * quality[i] + beta_price * price[i] + available_logit_offset[i])',
    },
  },
  {
    id: 'chosen',
    position: { x: 1104, y: 914 },
    data: {
      kind: 'likelihood',
      name: 'chosen[i]',
      plate: 'obs',
      observed: true,
      distribution: { id: 'categorical', name: 'Categorical', args: { p: 'choice_prob[i]' } },
      notes: '観測値は選ばれた候補の index。候補特徴量は C 次元のデータ行として持つ。',
    },
  },
  {
    id: 'qoi_price_tradeoff',
    position: { x: 1104, y: 110 },
    data: {
      kind: 'derived_quantity',
      name: 'price_quality_tradeoff',
      expression: '-(beta_quality + mean(person_quality_shift)) / beta_price',
      notes: '平均的な回答者の utility スケールでの限界 tradeoff。',
    },
  },
];

const choiceSetEdges: Edge[] = [
  { id: 'tau_person-person_quality_shift', source: 'tau_person', target: 'person_quality_shift', data: { role: 'prior-parameter' } },
  { id: 'person_id-choice_prob', source: 'person_id', target: 'choice_prob', data: { role: 'index' } },
  { id: 'person_quality_shift-choice_prob', source: 'person_quality_shift', target: 'choice_prob', data: { role: 'deterministic-input' } },
  { id: 'price-choice_prob', source: 'price', target: 'choice_prob', data: { role: 'data-input' } },
  { id: 'quality-choice_prob', source: 'quality', target: 'choice_prob', data: { role: 'data-input' } },
  { id: 'available_logit_offset-choice_prob', source: 'available_logit_offset', target: 'choice_prob', data: { role: 'data-input' } },
  { id: 'beta_price-choice_prob', source: 'beta_price', target: 'choice_prob', data: { role: 'deterministic-input' } },
  { id: 'beta_quality-choice_prob', source: 'beta_quality', target: 'choice_prob', data: { role: 'deterministic-input' } },
  { id: 'choice_prob-chosen', source: 'choice_prob', target: 'chosen', data: { role: 'likelihood-parameter' } },
  { id: 'beta_price-qoi_price_tradeoff', source: 'beta_price', target: 'qoi_price_tradeoff', data: { role: 'query-source' } },
  { id: 'beta_quality-qoi_price_tradeoff', source: 'beta_quality', target: 'qoi_price_tradeoff', data: { role: 'query-source' } },
  { id: 'person_quality_shift-qoi_price_tradeoff', source: 'person_quality_shift', target: 'qoi_price_tradeoff', data: { role: 'query-source' } },
];

const latentClassNodes: Node<BayesNodeData>[] = [
  {
    id: 'class_alpha',
    position: { x: 96, y: 428 },
    data: {
      kind: 'data',
      name: 'class_alpha',
      eventShape: ['K'],
      observed: true,
      constraints: [{ kind: 'positive' }],
      notes: '潜在クラス比率の事前集中度ベクトル。',
    },
  },
  {
    id: 'pi',
    position: { x: 432, y: 428 },
    data: {
      kind: 'parameter',
      name: 'pi',
      eventShape: ['K'],
      distribution: { id: 'dirichlet', name: 'Dirichlet', args: { alpha: 'class_alpha' } },
    },
  },
  {
    id: 'mu_class',
    position: { x: 768, y: 110 },
    data: {
      kind: 'parameter',
      name: 'mu_class[k]',
      shape: ['K'],
      plate: 'class',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '3' } },
      notes: 'クラス別の位置パラメータ。label switching の扱いを確認する。',
    },
  },
  {
    id: 'sigma',
    position: { x: 768, y: 428 },
    data: {
      kind: 'parameter',
      name: 'sigma',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '1' } },
    },
  },
  {
    id: 'z',
    position: { x: 768, y: 746 },
    data: {
      kind: 'latent',
      name: 'z[i]',
      shape: ['N'],
      plate: 'obs',
      distribution: { id: 'categorical', name: 'Categorical', args: { p: 'pi' } },
      hints: [{ kind: 'implementation', value: 'prefer marginalization for discrete class assignments' }],
      notes: '離散潜在割当。backend が対応するなら marginalization を優先する。',
    },
  },
  {
    id: 'y',
    position: { x: 1104, y: 746 },
    data: {
      kind: 'likelihood',
      name: 'y[i]',
      plate: 'obs',
      observed: true,
      distribution: { id: 'normal', name: 'Normal', args: { mu: 'mu_class[z[i]]', sigma: 'sigma' } },
    },
  },
  {
    id: 'qoi_class_weight',
    position: { x: 1104, y: 428 },
    data: {
      kind: 'derived_quantity',
      name: 'largest_class_share',
      expression: 'max(pi)',
      notes: '推定された潜在クラス比率の集中度。',
    },
  },
];

const latentClassEdges: Edge[] = [
  { id: 'class_alpha-pi', source: 'class_alpha', target: 'pi', data: { role: 'prior-parameter' } },
  { id: 'pi-z', source: 'pi', target: 'z', data: { role: 'prior-parameter' } },
  { id: 'z-y', source: 'z', target: 'y', data: { role: 'index' } },
  { id: 'mu_class-y', source: 'mu_class', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'sigma-y', source: 'sigma', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'pi-qoi_class_weight', source: 'pi', target: 'qoi_class_weight', data: { role: 'query-source' } },
];

const latentTrajectoryNodes: Node<BayesNodeData>[] = [
  {
    id: 'season_flag',
    position: { x: 768, y: 596 },
    data: {
      kind: 'data',
      name: 'season_flag[t]',
      shape: ['T'],
      plate: 'time',
      observed: true,
      notes: '既知の時変 covariate。欠けたカレンダー行は time index 上で明示する。',
    },
  },
  {
    id: 'sigma_state',
    position: { x: 96, y: 110 },
    data: {
      kind: 'hyperparameter',
      name: 'sigma_state',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.5' } },
    },
  },
  {
    id: 'sigma_obs',
    position: { x: 1104, y: 110 },
    data: {
      kind: 'parameter',
      name: 'sigma_obs',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '1' } },
    },
  },
  {
    id: 'beta_season',
    position: { x: 768, y: 110 },
    data: { kind: 'parameter', name: 'beta_season', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } } },
  },
  {
    id: 'level0',
    position: { x: 432, y: 110 },
    data: { kind: 'parameter', name: 'level0', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '2' } } },
  },
  {
    id: 'level_innovation',
    position: { x: 432, y: 428 },
    data: {
      kind: 'latent',
      name: 'level_innovation[t]',
      shape: ['T'],
      plate: 'time',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: 'sigma_state' } },
      notes: '潜在 level の random-walk innovation。時点間の変化量を直接正則化する。',
    },
  },
  {
    id: 'level',
    position: { x: 768, y: 428 },
    data: {
      kind: 'deterministic',
      name: 'level[t]',
      shape: ['T'],
      plate: 'time',
      expression: 'level0 + cumulative_sum(level_innovation[t])',
      notes: '初期値と innovation から作る潜在軌跡。',
    },
  },
  {
    id: 'mu',
    position: { x: 1104, y: 428 },
    data: {
      kind: 'deterministic',
      name: 'mu[t]',
      shape: ['T'],
      plate: 'time',
      expression: 'level[t] + beta_season * season_flag[t]',
    },
  },
  {
    id: 'y',
    position: { x: 1440, y: 596 },
    data: {
      kind: 'likelihood',
      name: 'y[t]',
      plate: 'time',
      observed: true,
      distribution: { id: 'student_t', name: 'StudentT', args: { nu: '4', mu: 'mu[t]', sigma: 'sigma_obs' } },
      observationProcess: { kind: 'missing', strategy: 'note_only' },
      notes: '観測系列にはカレンダー欠損や外れ値がありうる。StudentT で頑健性を持たせる。',
    },
  },
  {
    id: 'qoi_level_change',
    position: { x: 1440, y: 428 },
    data: {
      kind: 'derived_quantity',
      name: 'net_level_change',
      expression: 'level[T] - level[1]',
      notes: '潜在軌跡から見る trend 風の要約。',
    },
  },
];

const latentTrajectoryEdges: Edge[] = [
  { id: 'sigma_state-level_innovation', source: 'sigma_state', target: 'level_innovation', data: { role: 'prior-parameter' } },
  { id: 'level0-level', source: 'level0', target: 'level', data: { role: 'deterministic-input' } },
  { id: 'level_innovation-level', source: 'level_innovation', target: 'level', data: { role: 'latent-input' } },
  { id: 'level-mu', source: 'level', target: 'mu', data: { role: 'deterministic-input' } },
  { id: 'season_flag-mu', source: 'season_flag', target: 'mu', data: { role: 'data-input' } },
  { id: 'beta_season-mu', source: 'beta_season', target: 'mu', data: { role: 'deterministic-input' } },
  { id: 'mu-y', source: 'mu', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'sigma_obs-y', source: 'sigma_obs', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'level-qoi_level_change', source: 'level', target: 'qoi_level_change', data: { role: 'query-source' } },
];

const itemResponseNodes: Node<BayesNodeData>[] = [
  {
    id: 'person_id',
    position: { x: 96, y: 914 },
    data: { kind: 'data', name: 'person_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'item_id',
    position: { x: 96, y: 1082 },
    data: { kind: 'data', name: 'item_id[i]', shape: ['N'], plate: 'obs', observed: true },
  },
  {
    id: 'theta',
    position: { x: 96, y: 110 },
    data: {
      kind: 'latent',
      name: 'theta[p]',
      shape: ['P'],
      plate: 'person',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } },
      notes: '人ごとの潜在能力。標準正規事前分布でスケールを固定する。',
    },
  },
  {
    id: 'difficulty',
    position: { x: 96, y: 428 },
    data: {
      kind: 'parameter',
      name: 'difficulty[q]',
      shape: ['Q'],
      plate: 'question',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1.5' } },
    },
  },
  {
    id: 'discrimination',
    position: { x: 96, y: 596 },
    data: {
      kind: 'parameter',
      name: 'discrimination[q]',
      shape: ['Q'],
      plate: 'question',
      distribution: { id: 'lognormal', name: 'LogNormal', args: { mu: '0', sigma: '0.3' } },
    },
  },
  {
    id: 'logit_p',
    position: { x: 432, y: 914 },
    data: {
      kind: 'deterministic',
      name: 'logit_p[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'discrimination[item_id[i]] * (theta[person_id[i]] - difficulty[item_id[i]])',
    },
  },
  {
    id: 'correct',
    position: { x: 768, y: 914 },
    data: {
      kind: 'likelihood',
      name: 'correct[i]',
      plate: 'obs',
      observed: true,
      distribution: { id: 'bernoulli', name: 'Bernoulli', args: { p: 'inv_logit(logit_p[i])' } },
      notes: '疎な person-item 反応行列を、密な表ではなく観測行として表す。',
    },
  },
  {
    id: 'qoi_item_hardness',
    position: { x: 768, y: 428 },
    data: {
      kind: 'derived_quantity',
      name: 'hardest_item',
      expression: 'argmax(difficulty)',
      notes: '潜在能力を推定した後に確認する item review 対象。',
    },
  },
];

const itemResponseEdges: Edge[] = [
  { id: 'person_id-logit_p', source: 'person_id', target: 'logit_p', data: { role: 'index' } },
  { id: 'item_id-logit_p', source: 'item_id', target: 'logit_p', data: { role: 'index' } },
  { id: 'theta-logit_p', source: 'theta', target: 'logit_p', data: { role: 'latent-input' } },
  { id: 'difficulty-logit_p', source: 'difficulty', target: 'logit_p', data: { role: 'deterministic-input' } },
  { id: 'discrimination-logit_p', source: 'discrimination', target: 'logit_p', data: { role: 'deterministic-input' } },
  { id: 'logit_p-correct', source: 'logit_p', target: 'correct', data: { role: 'likelihood-parameter' } },
  { id: 'difficulty-qoi_item_hardness', source: 'difficulty', target: 'qoi_item_hardness', data: { role: 'query-source' } },
];

export const modelTemplates: ModelTemplate[] = [
  {
    id: 'hierarchical-regression',
    name: '階層回帰',
    family: '回帰',
    description: 'グループ別切片、観測アウトカム、関心量として扱いやすい傾きを持つ基本モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      'この研究設計ではグループを exchangeable と見なせますか？',
      '観測過程は打ち切り、丸め、完全観測のどれですか？',
    ],
    nodes: initialNodes,
    edges: initialEdges,
  },
  {
    id: 'logistic-regression',
    name: 'ロジスティック回帰',
    family: '二値アウトカム',
    description: '線形予測子と処置効果係数を持つ二値尤度モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      '係数は log-odds スケールと確率スケールのどちらで報告しますか？',
      'クラス不均衡や separation のリスクはありますか？',
    ],
    nodes: [
      {
        id: 'x',
        position: { x: 96, y: 596 },
        data: { kind: 'data', name: 'x[i]', shape: ['N'], plate: 'obs', observed: true },
      },
      {
        id: 'alpha',
        position: { x: 96, y: 110 },
        data: {
          kind: 'parameter',
          name: 'alpha',
          distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '2' } },
        },
      },
      {
        id: 'beta',
        position: { x: 96, y: 278 },
        data: {
          kind: 'parameter',
          name: 'beta',
          distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } },
          notes: '主要な log-odds 効果。handoff 前にスケールを確認する。',
        },
      },
      {
        id: 'logit_p',
        position: { x: 432, y: 596 },
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
        position: { x: 768, y: 596 },
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
        position: { x: 768, y: 278 },
        data: {
          kind: 'derived_quantity',
          name: 'treatment_effect',
          expression: 'beta',
          notes: '実装 handoff 用の QoI placeholder。',
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
    name: 'Poisson count モデル',
    family: 'count アウトカム',
    description: 'exposure offset を持つ count データ向けの log-rate モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      'Negative Binomial が必要なほどの過分散がありますか？',
      'exposure はすべての観測で信頼できる形で測定されていますか？',
    ],
    nodes: [
      {
        id: 'x',
        position: { x: 96, y: 596 },
        data: { kind: 'data', name: 'x[i]', shape: ['N'], plate: 'obs', observed: true },
      },
      {
        id: 'exposure',
        position: { x: 96, y: 764 },
        data: { kind: 'data', name: 'exposure[i]', shape: ['N'], plate: 'obs', observed: true, constraints: [{ kind: 'positive' }] },
      },
      {
        id: 'alpha',
        position: { x: 96, y: 110 },
        data: { kind: 'parameter', name: 'alpha', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '2' } } },
      },
      {
        id: 'beta',
        position: { x: 96, y: 278 },
        data: { kind: 'parameter', name: 'beta', distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } } },
      },
      {
        id: 'log_rate',
        position: { x: 432, y: 596 },
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
        position: { x: 768, y: 596 },
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
    id: 'uneven-binomial-survey',
    name: '分母が不均一な Binomial 調査',
    family: '調査応答',
    description: '行ごとに分母が異なり、一部 predictor に欠測方針が必要な階層 Binomial モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      '行ごとの試行数はサイト間で比較可能ですか、それとも現場の観測努力に左右されていますか？',
      '欠測 predictor は補完、除外、明示的な欠測過程のどれで扱いますか？',
      'サイト差は推定したい対象ですか、それとも補正項ですか？',
    ],
    nodes: unevenBinomialNodes,
    edges: unevenBinomialEdges,
  },
  {
    id: 'censored-lab-assay',
    name: '打ち切りつき lab assay',
    family: '測定過程',
    description: '行ごとの希釈率、batch 効果、検出限界での左打ち切りを持つ LogNormal assay モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      '検出限界は assay 値と同じスケールで記録されていますか？',
      'batch 効果は nuisance 補正ですか、それとも報告対象の variation ですか？',
      '打ち切り行には別途、欠測や選択の仮定が必要ですか？',
    ],
    nodes: censoredAssayNodes,
    edges: censoredAssayEdges,
  },
  {
    id: 'variable-choice-set',
    name: '可変 choice set',
    family: '離散選択',
    description: '候補属性を行列データとして持ち、利用可能な選択肢が課題ごとに変わる Categorical choice モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      '利用可能候補の mask は選択前に決まりますか、それとも過去の選択に影響されますか？',
      '回答者ごとの heterogeneity を識別できるだけの反復課題数がありますか？',
      'utility は outside option や候補別切片で正規化しますか？',
    ],
    nodes: choiceSetNodes,
    edges: choiceSetEdges,
  },
  {
    id: 'latent-class-mixture',
    name: '潜在クラス混合',
    family: '潜在混合',
    description: '潜在クラス割当、simplex のクラス重み、クラス別アウトカムを持つ有限混合モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      '離散クラス割当は target backend で marginalize しますか？',
      'label switching は順序制約、事前分布、後処理のどれで扱いますか？',
      'クラス数は事前知識や model comparison から見て妥当ですか？',
    ],
    nodes: latentClassNodes,
    edges: latentClassEdges,
  },
  {
    id: 'latent-trajectory-series',
    name: '潜在軌跡の時系列',
    family: '状態空間',
    description: '観測欠損、頑健な尤度、時変 covariate を持つ time-indexed latent level モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      '潜在 level は実装時に独立、random-walk、AR のどれとして扱いますか？',
      '欠けたカレンダー行は構造的欠測ですか、単に未観測ですか？',
      'StudentT の頑健性で十分ですか、それとも外れ値に別の観測過程を置きますか？',
    ],
    nodes: latentTrajectoryNodes,
    edges: latentTrajectoryEdges,
  },
  {
    id: 'two-parameter-irt',
    name: '2パラメータ IRT',
    family: '潜在特性',
    description: '潜在能力、item difficulty、正の discrimination を持つ疎な person-item 反応モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      '能力スケールは theta の事前分布と item parameterization で識別されていますか？',
      'person-item 観測が疎すぎて、より強い item 事前分布が必要ですか？',
      'item discrimination は共有、階層、item 別のどれで扱いますか？',
    ],
    nodes: itemResponseNodes,
    edges: itemResponseEdges,
  },
  {
    id: 'correlated-outcome-panel',
    name: '相関アウトカムパネル',
    family: '多変量アウトカム',
    description: 'ベクトル係数、Cholesky 事前分布、多変量尤度を持つコンパクトな MVN モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      'すべてのアウトカム次元は同じ行と同じスケールで観測されていますか？',
      '係数相関と残差相関は構造を共有しますか、それとも分けますか？',
      '尤度は covariance と Cholesky parameterization のどちらで backend に渡しますか？',
    ],
    nodes: correlatedPanelNodes,
    edges: correlatedPanelEdges,
  },
  {
    id: 'hierarchical-retail-demand',
    name: '階層 retail demand',
    family: '需要予測',
    description: '市場、時間、チャネル、メディア、測定誤差、QoI を含む ZINB 需要モデル。',
    status: 'clean',
    expectedDiagnostics: { errors: 0, warnings: 0 },
    reviewQuestions: [
      '市場、チャネル、時間の index は export データ全体で安定していますか？',
      '欠品は需要、ゼロ過剰、または両方の成分に入れますか？',
      'メディア carryover は handoff 前に明示的な lagged adstock block として表しますか？',
    ],
    nodes: retailDemandNodes,
    edges: retailDemandEdges,
  },
];
