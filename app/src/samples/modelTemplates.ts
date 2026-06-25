import type { Edge, Node } from '@xyflow/react';
import type { BayesNodeData } from '../lib/modelIr';
import { initialEdges, initialNodes } from './hierarchicalRegression.js';

export interface ModelTemplate {
  id: string;
  name: string;
  family: string;
  description: string;
  reviewQuestions: string[];
  nodes: Node<BayesNodeData>[];
  edges: Edge[];
}

export const modelTemplates: ModelTemplate[] = [
  {
    id: 'hierarchical-regression',
    name: 'Hierarchical regression',
    family: 'Regression',
    description: 'Group-level intercepts with an observed outcome and QoI-ready slope.',
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
          distribution: { id: 'bernoulli', name: 'Bernoulli', args: { logit_p: 'logit_p[i]' } },
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
          distribution: { id: 'poisson', name: 'Poisson', args: { log_rate: 'log_rate[i]' } },
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
];
