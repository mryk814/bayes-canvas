import type { ModelDocument, SourceText, ValueType } from './model.js';

const expr = (source: string): SourceText => ({ language: 'bayes-expr@1', source });
const scalarReal = (): ValueType => ({ scalar: 'real', axes: [], domain: { kind: 'real' } });
const scalarPositive = (): ValueType => ({ scalar: 'real', axes: [], domain: { kind: 'positive' } });
const obsReal = (): ValueType => ({
  scalar: 'real',
  axes: [{ axisId: 'axis_obs', role: 'batch' }],
  domain: { kind: 'real' },
});
const groupReal = (): ValueType => ({
  scalar: 'real',
  axes: [{ axisId: 'axis_group', role: 'batch' }],
  domain: { kind: 'real' },
});

export const hierarchicalRegression: ModelDocument = {
  schemaVersion: '1.0.0',
  documentId: 'doc_hierarchical_regression',
  revision: 1,
  model: {
    id: 'hierarchical_regression',
    name: 'Hierarchical regression',
    description: 'Random-intercept regression with explicit axes, plates, and observed-data binding.',
    intent: 'Estimate the population slope and group-level intercept variation.',
  },
  axes: {
    axis_obs: { id: 'axis_obs', symbol: 'obs', label: 'Observations', size: expr('N') },
    axis_group: { id: 'axis_group', symbol: 'group', label: 'Groups', size: expr('J') },
  },
  plates: {
    plate_obs: {
      id: 'plate_obs',
      label: 'Observation plate',
      axisId: 'axis_obs',
      indexSymbol: 'i',
      parentPlateIds: [],
      assumption: 'conditionally_independent',
    },
    plate_group: {
      id: 'plate_group',
      label: 'Group plate',
      axisId: 'axis_group',
      indexSymbol: 'j',
      parentPlateIds: [],
      assumption: 'exchangeable',
    },
  },
  entities: {
    data_N: {
      id: 'data_N', kind: 'data', symbol: 'N', valueType: { scalar: 'integer', axes: [] },
      plateIds: [], dataRole: 'constant', notes: 'Number of observations.',
    },
    data_J: {
      id: 'data_J', kind: 'data', symbol: 'J', valueType: { scalar: 'integer', axes: [] },
      plateIds: [], dataRole: 'constant', notes: 'Number of groups.',
    },
    data_x: {
      id: 'data_x', kind: 'data', symbol: 'x', valueType: obsReal(),
      plateIds: ['plate_obs'], dataRole: 'predictor',
    },
    data_y: {
      id: 'data_y', kind: 'data', symbol: 'y_data', valueType: obsReal(),
      plateIds: ['plate_obs'], dataRole: 'observed_value',
    },
    data_group_id: {
      id: 'data_group_id', kind: 'data', symbol: 'group_id',
      valueType: { scalar: 'integer', axes: [{ axisId: 'axis_obs', role: 'batch' }] },
      plateIds: ['plate_obs'], dataRole: 'index', notes: 'Maps observations to groups.',
    },
    rv_alpha_bar: {
      id: 'rv_alpha_bar', kind: 'random_variable', role: 'parameter', symbol: 'alpha_bar',
      valueType: scalarReal(), plateIds: [],
      distribution: { distributionId: 'normal', args: { mu: expr('0'), sigma: expr('2') } },
      priorRationale: 'Weakly informative prior on the population intercept.',
    },
    rv_tau_alpha: {
      id: 'rv_tau_alpha', kind: 'random_variable', role: 'parameter', symbol: 'tau_alpha',
      valueType: scalarPositive(), plateIds: [],
      distribution: { distributionId: 'half_normal', args: { sigma: expr('1') } },
    },
    rv_alpha: {
      id: 'rv_alpha', kind: 'random_variable', role: 'parameter', symbol: 'alpha',
      valueType: groupReal(), plateIds: ['plate_group'],
      distribution: {
        distributionId: 'normal',
        args: { mu: expr('alpha_bar'), sigma: expr('tau_alpha') },
      },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
    },
    rv_beta: {
      id: 'rv_beta', kind: 'random_variable', role: 'parameter', symbol: 'beta',
      valueType: scalarReal(), plateIds: [],
      distribution: { distributionId: 'normal', args: { mu: expr('0'), sigma: expr('1') } },
    },
    rv_sigma: {
      id: 'rv_sigma', kind: 'random_variable', role: 'parameter', symbol: 'sigma',
      valueType: scalarPositive(), plateIds: [],
      distribution: { distributionId: 'half_normal', args: { sigma: expr('1') } },
    },
    det_mu: {
      id: 'det_mu', kind: 'deterministic', symbol: 'mu', valueType: obsReal(),
      plateIds: ['plate_obs'], expression: expr('alpha[group_id[i]] + beta * x[i]'),
    },
    obs_y: {
      id: 'obs_y', kind: 'random_variable', role: 'observation', symbol: 'y',
      valueType: obsReal(), plateIds: ['plate_obs'], observedDataId: 'data_y',
      observationProcess: { kind: 'exact' },
      distribution: { distributionId: 'normal', args: { mu: expr('mu[i]'), sigma: expr('sigma') } },
    },
    query_beta: {
      id: 'query_beta', kind: 'query', queryRole: 'quantity_of_interest', symbol: 'treatment_effect',
      valueType: scalarReal(), plateIds: [], expression: expr('beta'), scale: 'linear',
    },
  },
  entityOrder: [
    'data_N', 'data_J', 'data_x', 'data_y', 'data_group_id',
    'rv_alpha_bar', 'rv_tau_alpha', 'rv_alpha', 'rv_beta', 'rv_sigma',
    'det_mu', 'obs_y', 'query_beta',
  ],
  notes: {
    assumption_exchangeable_groups: {
      id: 'assumption_exchangeable_groups',
      kind: 'assumption',
      text: 'Group effects are exchangeable conditional on alpha_bar and tau_alpha.',
      status: 'accepted',
      relatedEntityIds: ['rv_alpha'],
      author: 'user',
    },
  },
  noteOrder: ['assumption_exchangeable_groups'],
};
