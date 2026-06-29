import type { Edge, Node } from '@xyflow/react';
import type { BayesNodeData } from '../lib/modelIr';

export const initialNodes: Node<BayesNodeData>[] = [
  {
    id: 'alpha_bar',
    position: { x: 96, y: 110 },
    data: {
      kind: 'hyperparameter',
      name: 'alpha_bar',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '2' } },
    },
  },
  {
    id: 'tau_alpha',
    position: { x: 96, y: 278 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_alpha',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '1' } },
    },
  },
  {
    id: 'sigma_x',
    position: { x: 96, y: 446 },
    data: {
      kind: 'hyperparameter',
      name: 'sigma_x',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '0.5' } },
    },
  },
  {
    id: 'alpha',
    position: { x: 432, y: 764 },
    data: {
      kind: 'parameter',
      name: 'alpha[j]',
      shape: ['J'],
      plate: 'group',
      distribution: { id: 'normal', name: 'Normal', args: { mu: 'alpha_bar', sigma: 'tau_alpha' } },
      hints: [{ kind: 'parameterization', value: 'non_centered' }],
    },
  },
  {
    id: 'beta',
    position: { x: 432, y: 110 },
    data: {
      kind: 'parameter',
      name: 'beta',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } },
    },
  },
  {
    id: 'sigma',
    position: { x: 768, y: 110 },
    data: {
      kind: 'parameter',
      name: 'sigma',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '1' } },
    },
  },
  {
    id: 'x',
    position: { x: 96, y: 1082 },
    data: {
      kind: 'data',
      name: 'x[i]',
      shape: ['N'],
      observed: true,
      plate: 'obs',
      observationProcess: { kind: 'measurement_error', latentTrueSymbol: 'x_true[i]', errorScaleSymbol: 'sigma_x' },
    },
  },
  {
    id: 'x_true',
    position: { x: 432, y: 1250 },
    data: {
      kind: 'latent',
      name: 'x_true[i]',
      shape: ['N'],
      observed: false,
      plate: 'obs',
      distribution: { id: 'normal', name: 'Normal', args: { mu: 'x[i]', sigma: 'sigma_x' } },
      notes: '測定誤差を含む観測 x から推定する真の covariate。',
    },
  },
  {
    id: 'group_id',
    position: { x: 432, y: 1082 },
    data: { kind: 'data', name: 'group_id[i]', shape: ['N'], observed: true, plate: 'obs' },
  },
  {
    id: 'y_limit',
    position: { x: 768, y: 1082 },
    data: {
      kind: 'data',
      name: 'y_limit[i]',
      shape: ['N'],
      observed: true,
      plate: 'obs',
      notes: '右打ち切りの上限。打ち切りがない行では十分大きい値または欠測規則を確認する。',
    },
  },
  {
    id: 'mu',
    position: { x: 768, y: 1250 },
    data: {
      kind: 'deterministic',
      name: 'mu[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'alpha[group_id[i]] + beta * x_true[i]',
    },
  },
  {
    id: 'y',
    position: { x: 1104, y: 1082 },
    data: {
      kind: 'likelihood',
      name: 'y[i]',
      plate: 'obs',
      distribution: { id: 'normal', name: 'Normal', args: { mu: 'mu[i]', sigma: 'sigma' } },
      observed: true,
      observationProcess: { kind: 'censored', direction: 'right', boundSymbol: 'y_limit' },
    },
  },
];

export const initialEdges: Edge[] = [
  { id: 'alpha_bar-alpha', source: 'alpha_bar', target: 'alpha', data: { role: 'prior-parameter' } },
  { id: 'tau_alpha-alpha', source: 'tau_alpha', target: 'alpha', data: { role: 'prior-parameter' } },
  { id: 'x-x_true', source: 'x', target: 'x_true', data: { role: 'observed-value' } },
  { id: 'sigma_x-x_true', source: 'sigma_x', target: 'x_true', data: { role: 'likelihood-parameter' } },
  { id: 'alpha-mu', source: 'alpha', target: 'mu', data: { role: 'deterministic-input' } },
  { id: 'beta-mu', source: 'beta', target: 'mu', data: { role: 'deterministic-input' } },
  { id: 'x_true-mu', source: 'x_true', target: 'mu', data: { role: 'latent-input' } },
  { id: 'group_id-mu', source: 'group_id', target: 'mu', data: { role: 'index' } },
  { id: 'mu-y', source: 'mu', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'sigma-y', source: 'sigma', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'y_limit-y', source: 'y_limit', target: 'y', data: { role: 'observed-value' } },
];
