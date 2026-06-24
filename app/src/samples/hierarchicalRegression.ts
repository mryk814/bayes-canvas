import type { Edge, Node } from '@xyflow/react';
import type { BayesNodeData } from '../lib/modelIr';

export const initialNodes: Node<BayesNodeData>[] = [
  {
    id: 'alpha_bar',
    position: { x: 240, y: 40 },
    data: {
      kind: 'hyperparameter',
      name: 'alpha_bar',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '2' } },
    },
  },
  {
    id: 'tau_alpha',
    position: { x: 440, y: 40 },
    data: {
      kind: 'hyperparameter',
      name: 'tau_alpha',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '1' } },
    },
  },
  {
    id: 'alpha',
    position: { x: 330, y: 150 },
    data: {
      kind: 'parameter',
      name: 'alpha[j]',
      shape: ['J'],
      plate: 'group',
      distribution: { id: 'normal', name: 'Normal', args: { mu: 'alpha_bar', sigma: 'tau_alpha' } },
    },
  },
  {
    id: 'beta',
    position: { x: 120, y: 180 },
    data: {
      kind: 'parameter',
      name: 'beta',
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } },
    },
  },
  {
    id: 'sigma',
    position: { x: 600, y: 300 },
    data: {
      kind: 'parameter',
      name: 'sigma',
      distribution: { id: 'halfnormal', name: 'HalfNormal', args: { sigma: '1' } },
    },
  },
  {
    id: 'x',
    position: { x: 120, y: 320 },
    data: { kind: 'data', name: 'x[i]', shape: ['N'], observed: true },
  },
  {
    id: 'group_id',
    position: { x: 330, y: 320 },
    data: { kind: 'data', name: 'group_id[i]', shape: ['N'], observed: true },
  },
  {
    id: 'mu',
    position: { x: 330, y: 460 },
    data: {
      kind: 'deterministic',
      name: 'mu[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'alpha[group_id[i]] + beta * x[i]',
    },
  },
  {
    id: 'y',
    position: { x: 330, y: 620 },
    data: {
      kind: 'likelihood',
      name: 'y[i]',
      plate: 'obs',
      distribution: { id: 'normal', name: 'Normal', args: { mu: 'mu[i]', sigma: 'sigma' } },
      observed: true,
    },
  },
];

export const initialEdges: Edge[] = [
  { id: 'alpha_bar-alpha', source: 'alpha_bar', target: 'alpha', data: { role: 'prior-parameter' } },
  { id: 'tau_alpha-alpha', source: 'tau_alpha', target: 'alpha', data: { role: 'prior-parameter' } },
  { id: 'alpha-mu', source: 'alpha', target: 'mu', data: { role: 'deterministic-input' } },
  { id: 'beta-mu', source: 'beta', target: 'mu', data: { role: 'deterministic-input' } },
  { id: 'x-mu', source: 'x', target: 'mu', data: { role: 'data-input' } },
  { id: 'group_id-mu', source: 'group_id', target: 'mu', data: { role: 'index' } },
  { id: 'mu-y', source: 'mu', target: 'y', data: { role: 'likelihood-parameter' } },
  { id: 'sigma-y', source: 'sigma', target: 'y', data: { role: 'likelihood-parameter' } },
];
