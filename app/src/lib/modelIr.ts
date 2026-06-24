import type { Edge, Node } from '@xyflow/react';
import {
  formatDistributionTex,
  formatDistributionText,
  formatTexExpression,
  normalizeDistribution,
  type DistributionSpec,
} from './distributionRegistry';

export type BayesNodeKind = 'data' | 'parameter' | 'hyperparameter' | 'latent' | 'deterministic' | 'likelihood';

export interface BayesNodeData extends Record<string, unknown> {
  kind: BayesNodeKind;
  name: string;
  shape?: string[];
  observed?: boolean;
  plate?: string;
  distribution?: DistributionSpec;
  expression?: string;
}

export interface ModelIr {
  version: string;
  model: {
    name: string;
    description?: string;
  };
  plates: Array<{
    id: string;
    label: string;
    index: string;
    size: string;
  }>;
  nodes: Array<BayesNodeData & { id: string }>;
  edges: Array<{
    from: string;
    to: string;
    role: string;
  }>;
}

export type PromptTarget = 'generic' | 'pymc' | 'numpyro' | 'stan' | 'review';

const PROMPT_TARGETS: Record<PromptTarget, { label: string; instruction: string; preferences: string[] }> = {
  generic: {
    label: 'Generic PPL implementation',
    instruction: 'Implement the following Bayesian model specification in an appropriate probabilistic programming language.',
    preferences: [
      'Choose idiomatic constructs for the target PPL while preserving the model structure exactly.',
      'Keep data preparation separate from model definition.',
    ],
  },
  pymc: {
    label: 'PyMC implementation',
    instruction: 'Implement the following Bayesian model specification in PyMC.',
    preferences: [
      'Use named coordinates and dimensions for plates and shaped variables where possible.',
      'Return a runnable model construction snippet, but do not invent data values.',
    ],
  },
  numpyro: {
    label: 'NumPyro implementation',
    instruction: 'Implement the following Bayesian model specification in NumPyro.',
    preferences: [
      'Use numpyro.plate for repeated dimensions.',
      'Keep deterministic expressions explicit with numpyro.deterministic where useful.',
    ],
  },
  stan: {
    label: 'Stan implementation',
    instruction: 'Implement the following Bayesian model specification in Stan.',
    preferences: [
      'Separate data, parameters, transformed parameters, model, and generated quantities blocks.',
      'Respect each support constraint when declaring parameters.',
    ],
  },
  review: {
    label: 'Model review only',
    instruction: 'Review the following Bayesian model specification for clarity, shape consistency, and implementation risks.',
    preferences: [
      'Do not generate backend code.',
      'List ambiguities, missing assumptions, and shape or indexing questions before suggesting changes.',
    ],
  },
};

export function exportModelIr(nodes: Node[], edges: Edge[]): ModelIr {
  return {
    version: '0.1.0',
    model: {
      name: 'hierarchical_regression',
      description: 'Random-intercept Bayesian regression example.',
    },
    plates: [
      { id: 'obs', label: 'observations', index: 'i', size: 'N' },
      { id: 'group', label: 'groups', index: 'j', size: 'J' },
    ],
    nodes: nodes.map((node) => normalizeNodeForExport(node.id, node.data as BayesNodeData)),
    edges: edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      role: String(edge.data?.role ?? 'dependency'),
    })),
  };
}

function normalizeNodeForExport(id: string, data: BayesNodeData): BayesNodeData & { id: string } {
  return {
    id,
    ...data,
    distribution: data.distribution ? normalizeDistribution(data.distribution) : undefined,
  };
}

export function getPromptTargetLabel(target: PromptTarget): string {
  return PROMPT_TARGETS[target].label;
}

export function generateAiPrompt(model: ModelIr, target: PromptTarget = 'generic'): string {
  const promptTarget = PROMPT_TARGETS[target];
  const sections = summarizeModel(model);
  const tex = generateModelTex(model);

  return [
    promptTarget.instruction,
    '',
    'Non-goals and boundaries:',
    '- Bayes Canvas authors model specifications; it does not run inference.',
    '- Do not add assumptions that are not present in the specification.',
    '- If any shape, index, or distribution parameter is ambiguous, ask before implementing.',
    '- Preserve the model structure exactly.',
    '',
    'Implementation preferences:',
    ...promptTarget.preferences.map((preference) => `- ${preference}`),
    '',
    'Model:',
    `- Name: ${model.model.name}`,
    `- Description: ${model.model.description ?? 'None provided'}`,
    `- Prompt target: ${promptTarget.label}`,
    '',
    'Data variables:',
    formatNodeList(sections.data),
    '',
    'Observed variables:',
    formatNodeList(sections.observed),
    '',
    'Latent variables and parameters:',
    formatNodeList(sections.latent),
    '',
    'Indices / plates / shapes:',
    formatPlateList(model),
    '',
    'Priors:',
    formatNodeList(sections.priors),
    '',
    'Deterministic equations:',
    formatNodeList(sections.deterministic),
    '',
    'Likelihood:',
    formatNodeList(sections.likelihood),
    '',
    'Notes and assumptions:',
    '- Distribution names are backend-neutral Model IR names.',
    '- Edges describe declared dependencies and should be used to preserve graph structure.',
    '- Shapes and plates are part of the contract; do not silently broadcast without checking them.',
    '',
    'TeX math block:',
    '```tex',
    tex,
    '```',
    '',
    'Model IR JSON:',
    '```json',
    JSON.stringify(model, null, 2),
    '```',
  ].join('\n');
}

export function generateModelTex(model: ModelIr): string {
  const lines = [
    ...model.plates.map((plate) => `${plate.index} &\\in \\{1, \\dots, ${plate.size}\\}`),
    ...model.nodes
      .filter((node) => node.distribution)
      .map((node) => `${formatTexExpression(node.name)} &\\sim ${formatDistributionTex(node.distribution as DistributionSpec)}`),
    ...model.nodes
      .filter((node) => node.expression)
      .map((node) => `${formatTexExpression(node.name)} &= ${formatTexExpression(node.expression ?? '')}`),
  ];

  return ['\\begin{aligned}', ...lines.map((line, index) => `  ${line}${index === lines.length - 1 ? '' : ' \\\\'}`), '\\end{aligned}'].join('\n');
}

function summarizeModel(model: ModelIr) {
  return {
    data: model.nodes.filter((node) => node.kind === 'data'),
    observed: model.nodes.filter((node) => node.observed),
    latent: model.nodes.filter((node) => ['parameter', 'hyperparameter', 'latent'].includes(node.kind)),
    priors: model.nodes.filter((node) => ['parameter', 'hyperparameter', 'latent'].includes(node.kind) && node.distribution),
    deterministic: model.nodes.filter((node) => node.kind === 'deterministic'),
    likelihood: model.nodes.filter((node) => node.kind === 'likelihood'),
  };
}

function formatNodeList(nodes: ModelIr['nodes']): string {
  if (!nodes.length) {
    return '- None declared';
  }

  return nodes.map((node) => `- ${formatNodeSummary(node)}`).join('\n');
}

function formatNodeSummary(node: ModelIr['nodes'][number]): string {
  const parts = [
    `${node.name} (${node.kind})`,
    node.shape?.length ? `shape: ${node.shape.join(' x ')}` : 'shape: scalar',
    node.plate ? `plate: ${node.plate}` : undefined,
    node.observed ? 'observed' : undefined,
    node.distribution ? `distribution: ${formatDistributionText(node.distribution)}` : undefined,
    node.expression ? `expression: ${node.expression}` : undefined,
  ].filter(Boolean);

  return parts.join('; ');
}

function formatPlateList(model: ModelIr): string {
  const plateLines = model.plates.length
    ? model.plates.map((plate) => `- ${plate.id}: ${plate.label}; index ${plate.index}; size ${plate.size}`)
    : ['- No plates declared'];
  const shapeLines = model.nodes
    .filter((node) => node.shape?.length)
    .map((node) => `- ${node.name}: ${node.shape?.join(' x ')}`);

  return [...plateLines, ...(shapeLines.length ? ['- Variable shapes:', ...shapeLines] : [])].join('\n');
}
