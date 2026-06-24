import type { Edge, Node } from '@xyflow/react';
import {
  DISTRIBUTIONS,
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
  symbolTable: SymbolTable;
}

export type PromptTarget = 'generic' | 'pymc' | 'numpyro' | 'stan' | 'review';

export interface VariableSymbol {
  nodeId: string;
  baseSymbol: string;
  displayName: string;
  kind: BayesNodeKind;
  observed?: boolean;
  plateId?: string;
  declaredIndex?: string;
  shape: string[];
}

export interface IndexSymbol {
  plateId: string;
  label: string;
  index: string;
  size: string;
}

export interface FunctionSymbol {
  name: string;
  description: string;
}

export interface DistributionSymbol {
  id: string;
  name: string;
  support: string;
  parameterNames: string[];
}

export interface SymbolTable {
  variables: Record<string, VariableSymbol>;
  indices: Record<string, IndexSymbol>;
  functions: Record<string, FunctionSymbol>;
  distributions: Record<string, DistributionSymbol>;
}

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
  const plates = [
    { id: 'obs', label: 'observations', index: 'i', size: 'N' },
    { id: 'group', label: 'groups', index: 'j', size: 'J' },
  ];
  const normalizedNodes = nodes.map((node) => normalizeNodeForExport(node.id, node.data as BayesNodeData));

  return {
    version: '0.1.0',
    model: {
      name: 'hierarchical_regression',
      description: 'Random-intercept Bayesian regression example.',
    },
    plates,
    nodes: normalizedNodes,
    edges: edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      role: String(edge.data?.role ?? 'dependency'),
    })),
    symbolTable: buildSymbolTable(normalizedNodes, plates),
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
    'Symbol table:',
    formatSymbolTable(model.symbolTable),
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

export interface MathViewSection {
  title: string;
  lines: Array<{ nodeId?: string; tex: string }>;
}

export function generateModelTexSections(model: ModelIr): MathViewSection[] {
  const sections: MathViewSection[] = [];
  const { data, priors, deterministic, likelihood } = summarizeModel(model);

  if (model.plates.length) {
    sections.push({
      title: 'Indices / Plates',
      lines: model.plates.map((plate) => ({
        tex: `${plate.index} \\in \\{1, \\dots, ${plate.size}\\}`,
      })),
    });
  }

  if (data.length) {
    sections.push({
      title: 'Data',
      lines: data.map((node) => ({
        nodeId: node.id,
        tex: `${formatTexExpression(node.name)} \\;\\text{(observed, ${node.shape?.length ? `shape ${node.shape.join(' \\times ')}` : 'scalar'})}`,
      })),
    });
  }

  if (priors.length) {
    sections.push({
      title: 'Priors',
      lines: priors.map((node) => ({
        nodeId: node.id,
        tex: `${formatTexExpression(node.name)} \\sim ${formatDistributionTex(node.distribution as DistributionSpec)}`,
      })),
    });
  }

  if (deterministic.length) {
    sections.push({
      title: 'Deterministic',
      lines: deterministic.map((node) => ({
        nodeId: node.id,
        tex: `${formatTexExpression(node.name)} = ${formatTexExpression(node.expression ?? '')}`,
      })),
    });
  }

  if (likelihood.length) {
    sections.push({
      title: 'Likelihood',
      lines: likelihood.map((node) => ({
        nodeId: node.id,
        tex: `${formatTexExpression(node.name)} \\sim ${formatDistributionTex(node.distribution as DistributionSpec)}`,
      })),
    });
  }

  return sections;
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

export function generateModelTexSectioned(model: ModelIr): string {
  const sections = generateModelTexSections(model);

  return sections
    .map((section) => {
      const header = `% ${section.title}`;
      const lines = section.lines.map((line) => line.tex);
      return [header, ...lines].join('\n');
    })
    .join('\n\n');
}

export function generateModelMarkdown(model: ModelIr): string {
  const sections = generateModelTexSections(model);

  return sections
    .map((section) => {
      const header = `### ${section.title}`;
      const equations = section.lines.map((line) => `$$${line.tex}$$`);
      return [header, '', ...equations].join('\n');
    })
    .join('\n\n');
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

const RESERVED_FUNCTIONS: FunctionSymbol[] = [
  { name: 'exp', description: 'Exponential transform.' },
  { name: 'log', description: 'Natural logarithm.' },
  { name: 'logit', description: 'Logit transform.' },
  { name: 'inv_logit', description: 'Inverse logit transform.' },
  { name: 'softmax', description: 'Simplex-valued softmax transform.' },
  { name: 'dot', description: 'Vector dot product.' },
];

export function buildSymbolTable(
  nodes: ModelIr['nodes'],
  plates: ModelIr['plates'],
): SymbolTable {
  return {
    variables: Object.fromEntries(nodes.map((node) => {
      const parsedName = parseSymbolName(node.name);
      return [
        parsedName.baseSymbol,
        {
          nodeId: node.id,
          baseSymbol: parsedName.baseSymbol,
          displayName: node.name,
          kind: node.kind,
          observed: node.observed,
          plateId: node.plate,
          declaredIndex: parsedName.index,
          shape: node.shape ?? [],
        } satisfies VariableSymbol,
      ];
    })),
    indices: Object.fromEntries(plates.map((plate) => [
      plate.index,
      {
        plateId: plate.id,
        label: plate.label,
        index: plate.index,
        size: plate.size,
      } satisfies IndexSymbol,
    ])),
    functions: Object.fromEntries(RESERVED_FUNCTIONS.map((fn) => [fn.name, fn])),
    distributions: Object.fromEntries(DISTRIBUTIONS.map((distribution) => [
      distribution.name,
      {
        id: distribution.id,
        name: distribution.name,
        support: distribution.support,
        parameterNames: distribution.params.map((param) => param.name),
      } satisfies DistributionSymbol,
    ])),
  };
}

export function parseSymbolName(name: string): { baseSymbol: string; index?: string } {
  const trimmed = name.trim();
  const match = /^([a-zA-Z][a-zA-Z0-9_]*)(?:\[([^\]]+)\])?/.exec(trimmed);

  if (!match) {
    return { baseSymbol: trimmed };
  }

  return {
    baseSymbol: match[1],
    index: match[2],
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

function formatSymbolTable(symbolTable: SymbolTable): string {
  const variableLines = Object.values(symbolTable.variables).map((symbol) => {
    const parts = [
      `${symbol.baseSymbol}: ${symbol.displayName}`,
      symbol.kind,
      symbol.plateId ? `plate ${symbol.plateId}` : undefined,
      symbol.declaredIndex ? `index ${symbol.declaredIndex}` : undefined,
      symbol.shape.length ? `shape ${symbol.shape.join(' x ')}` : 'scalar',
    ].filter(Boolean);

    return `- ${parts.join('; ')}`;
  });
  const indexLines = Object.values(symbolTable.indices).map(
    (symbol) => `- ${symbol.index}: ${symbol.label}; size ${symbol.size}; plate ${symbol.plateId}`,
  );
  const functionNames = Object.keys(symbolTable.functions).join(', ');
  const distributionNames = Object.values(symbolTable.distributions).map((distribution) => distribution.name).join(', ');

  return [
    'Variables:',
    ...(variableLines.length ? variableLines : ['- None declared']),
    'Indices:',
    ...(indexLines.length ? indexLines : ['- None declared']),
    `Functions: ${functionNames || 'None declared'}`,
    `Distributions: ${distributionNames || 'None declared'}`,
  ].join('\n');
}
