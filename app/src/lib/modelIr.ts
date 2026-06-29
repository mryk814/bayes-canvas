import {
  DISTRIBUTIONS,
  formatDistributionTex,
  formatDistributionText,
  formatTexExpression,
  normalizeDistribution,
  type DistributionSpec,
} from './distributionRegistry';
import { collectReferenceOccurrences, parseExpression } from './core/expression';

interface CanvasNodeLike {
  id: string;
  data: BayesNodeData;
}

interface CanvasEdgeLike {
  source: string;
  target: string;
  data?: Record<string, unknown> | null;
}

export type BayesNodeKind =
  | 'data'
  | 'parameter'
  | 'hyperparameter'
  | 'latent'
  | 'deterministic'
  | 'likelihood'
  | 'model_block'
  | 'derived_quantity';

export interface BayesNodeData extends Record<string, unknown> {
  kind: BayesNodeKind;
  name: string;
  shape?: string[];
  eventShape?: string[];
  observed?: boolean;
  plate?: string;
  distribution?: DistributionSpec;
  expression?: string;
  constraints?: Constraint[];
  hints?: ModelHint[];
  observationProcess?: ObservationProcess;
  validationLevel?: ValidationLevel;
  notes?: string;
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
  indexMappings: IndexMapping[];
  priorRecipes: PriorRecipe[];
  regressionTerms: RegressionTerm[];
  modelBlocks: ModelBlock[];
  quantitiesOfInterest: QuantityOfInterest[];
  diagnostics: ModelDiagnostic[];
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
  eventShape: string[];
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

export type Constraint =
  | { kind: 'positive' }
  | { kind: 'unit_interval' }
  | { kind: 'simplex' }
  | { kind: 'ordered' }
  | { kind: 'sum_to_zero'; overPlateId?: string }
  | { kind: 'correlation_matrix' }
  | { kind: 'custom'; description: string };

export type ModelHint =
  | { kind: 'parameterization'; value: 'centered' | 'non_centered' | 'unspecified' }
  | { kind: 'implementation'; value: string }
  | { kind: 'warning'; value: string };

export type ObservationProcess =
  | { kind: 'exact' }
  | { kind: 'missing'; strategy: 'ignore' | 'latent_imputation' | 'note_only' }
  | { kind: 'measurement_error'; latentTrueSymbol: string; errorScaleSymbol?: string }
  | { kind: 'censored'; direction: 'left' | 'right' | 'interval'; boundSymbol?: string }
  | { kind: 'truncated'; lower?: string; upper?: string }
  | { kind: 'rounded'; unit?: string }
  | { kind: 'custom'; description: string };

export type ValidationLevel = 'opaque' | 'structured' | 'expanded' | 'linted';

export interface IndexMapping {
  id: string;
  symbol: string;
  fromPlateId: string;
  toPlateId: string;
  inputIndex: string;
  outputIndex?: string;
}

export interface PriorRecipe {
  id: string;
  name: string;
  targetSymbol: string;
  collapsed: string;
  expanded: string[];
  validationLevel: ValidationLevel;
  notes?: string;
}

export interface RegressionTerm {
  id: string;
  kind: 'intercept' | 'linear' | 'interaction' | 'group_effect' | 'smooth' | 'gp' | 'bnn' | 'offset' | 'custom';
  label: string;
  inputSymbols: string[];
  outputSymbol: string;
  outputPlateId?: string;
  formulaShort: string;
  formulaExpanded?: string[];
  validationLevel: ValidationLevel;
  config?: Record<string, string | number | boolean>;
}

export interface ModelBlock {
  id: string;
  kind: string;
  label: string;
  inputs: string[];
  outputs: string[];
  formulas?: string[];
  config?: Record<string, string | number | boolean>;
  expansion?: string[];
  validationLevel: ValidationLevel;
  notes?: string;
}

export interface QuantityOfInterest {
  id: string;
  name: string;
  expression: string;
  description?: string;
  scale?: 'linear' | 'log' | 'logit' | 'probability' | 'custom';
  targetPlateId?: string;
}

export interface ExpressionReference {
  symbol: string;
  raw: string;
  indices: string[];
}

export interface ExpressionAnalysis {
  expression: string;
  references: ExpressionReference[];
  functions: string[];
  indices: string[];
}

export interface ModelDiagnostic {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  target: {
    nodeId?: string;
    expressionId?: string;
    distributionParam?: string;
    blockId?: string;
    quantityId?: string;
  };
  suggestion?: string;
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
      'Use named coordinates and dimensions for repeated scopes (plates) and shaped variables where possible.',
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

export function exportModelIr(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): ModelIr {
  const plates = buildPlatesFromNodes(nodes);
  const normalizedNodes = nodes.map((node) => normalizeNodeForExport(node.id, node.data));
  const normalizedEdges = edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    role: String(edge.data?.role ?? 'dependency'),
  }));
  const symbolTable = buildSymbolTable(normalizedNodes, plates);
  const indexMappings = buildIndexMappings(normalizedNodes, plates);
  const priorRecipes = buildPriorRecipes(normalizedNodes);
  const regressionTerms = buildRegressionTerms(normalizedNodes);
  const modelBlocks = buildModelBlocks(normalizedNodes);
  const quantitiesOfInterest = buildQuantitiesOfInterest(normalizedNodes);
  const diagnostics = lintModel({
    version: '0.1.0',
    model: {
      name: inferModelName(normalizedNodes),
      description: 'Bayes Canvas authoring model.',
    },
    plates,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    indexMappings,
    priorRecipes,
    regressionTerms,
    modelBlocks,
    quantitiesOfInterest,
    diagnostics: [],
    symbolTable,
  });

  return {
    version: '0.1.0',
    model: {
      name: inferModelName(normalizedNodes),
      description: 'Bayes Canvas authoring model.',
    },
    plates,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    indexMappings,
    priorRecipes,
    regressionTerms,
    modelBlocks,
    quantitiesOfInterest,
    diagnostics,
    symbolTable,
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
    'Indices / repeated scopes (plates) / shapes:',
    formatPlateList(model),
    '',
    'Index mapping:',
    formatIndexMappings(model.indexMappings),
    '',
    'Model diagnostics:',
    formatDiagnostics(model.diagnostics),
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
    'Observation process:',
    formatObservationProcesses(model.nodes),
    '',
    'Constraints and implementation hints:',
    formatConstraintsAndHints(model.nodes),
    '',
    'Prior recipes:',
    formatPriorRecipes(model.priorRecipes),
    '',
    'Regression terms:',
    formatRegressionTerms(model.regressionTerms),
    '',
    'Opaque / structured model blocks:',
    formatModelBlocks(model.modelBlocks),
    '',
    'Quantities of interest:',
    formatQuantitiesOfInterest(model.quantitiesOfInterest),
    '',
    'Notes and assumptions:',
    model.diagnostics.some((diagnostic) => diagnostic.severity !== 'info')
      ? '- This model has unresolved diagnostics. Review them before implementation.'
      : '- No unresolved error or warning diagnostics were detected.',
    model.modelBlocks.some((block) => block.validationLevel === 'opaque' || block.validationLevel === 'structured')
      ? '- One or more blocks are not fully validated by Bayes Canvas. Respect their inputs, outputs, formulas, and notes.'
      : '- Structured blocks are expanded or linted where possible.',
    '- Distribution names are backend-neutral Model IR names.',
    '- Edges describe declared dependencies and should be used to preserve graph structure.',
    '- Shapes and repeated scopes (plates) are part of the contract; do not silently broadcast without checking them.',
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
      title: 'Index Ranges',
      lines: model.plates.map((plate) => ({
        tex: `${plate.index} \\in \\{1, \\dots, ${plate.size}\\}`,
      })),
    });
  }

  if (model.indexMappings.length) {
    sections.push({
      title: 'Index Mappings',
      lines: model.indexMappings.map((mapping) => ({
        tex: `${formatTexExpression(`${mapping.symbol}[${mapping.inputIndex}]`)}: ${mapping.fromPlateId} \\rightarrow ${mapping.toPlateId}`,
      })),
    });
  }

  if (data.length) {
    sections.push({
      title: 'Data',
      lines: data.map((node) => ({
        nodeId: node.id,
        tex: `${formatTexExpression(node.name)} \\;\\text{(observed, ${formatNodeShape(node)})}`,
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

  const observationLines = model.nodes
    .filter((node) => node.observationProcess)
    .map((node) => ({
      nodeId: node.id,
      tex: `${formatTexExpression(node.name)} \\;\\text{observed as } ${formatObservationProcessTex(node.observationProcess!)}`,
    }));

  if (observationLines.length) {
    sections.push({
      title: 'Observation Process',
      lines: observationLines,
    });
  }

  if (model.priorRecipes.length) {
    sections.push({
      title: 'Prior Recipes',
      lines: model.priorRecipes.flatMap((recipe) => [
        { tex: formatTexExpression(recipe.collapsed) },
        ...recipe.expanded.map((line) => ({ tex: formatTexExpression(line) })),
      ]),
    });
  }

  if (model.regressionTerms.length) {
    sections.push({
      title: 'Regression Terms',
      lines: model.regressionTerms.map((term) => ({
        tex: formatTexExpression(term.formulaShort),
      })),
    });
  }

  if (model.modelBlocks.length) {
    sections.push({
      title: 'Model Blocks',
      lines: model.modelBlocks.map((block) => ({
        tex: `${formatTexExpression(block.outputs.join(', '))} \\;\\text{${block.validationLevel} ${block.kind}}`,
      })),
    });
  }

  if (model.quantitiesOfInterest.length) {
    sections.push({
      title: 'Derived Quantities',
      lines: model.quantitiesOfInterest.map((quantity) => ({
        tex: `${formatTexExpression(quantity.name)} = ${formatTexExpression(quantity.expression)}`,
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
    ...model.quantitiesOfInterest.map((quantity) => `${formatTexExpression(quantity.name)} &= ${formatTexExpression(quantity.expression)}`),
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

export function analyzeExpression(expression: string, symbolTable: SymbolTable): ExpressionAnalysis {
  const parsed = parseExpression(expression);
  if (!parsed.ok) {
    return { expression, references: [], functions: [], indices: [] };
  }
  const references = new Map<string, ExpressionReference>();
  const functions = new Set<string>();
  const indices = new Set<string>();

  for (const occurrence of collectReferenceOccurrences(parsed.ast)) {
    const symbol = occurrence.symbol;
    if (symbol in symbolTable.indices) {
      indices.add(symbol);
      continue;
    }
    if (symbol in symbolTable.functions) {
      functions.add(symbol);
      continue;
    }
    const raw = expression.slice(occurrence.span.start, occurrence.span.end);
    const current = references.get(symbol);
    const nextReference: ExpressionReference = {
      symbol,
      raw,
      indices: extractIndexFragments(raw),
    };

    if (current) {
      references.set(symbol, {
        symbol,
        raw: current.raw === raw ? current.raw : `${current.raw}, ${raw}`,
        indices: [...new Set([...current.indices, ...nextReference.indices])],
      });
    } else {
      references.set(symbol, nextReference);
    }
  }

  return {
    expression,
    references: [...references.values()],
    functions: [...functions],
    indices: [...indices],
  };
}

function extractIndexFragments(raw: string): string[] {
  const firstBracket = raw.indexOf('[');
  const lastBracket = raw.lastIndexOf(']');
  if (firstBracket < 0 || lastBracket <= firstBracket) return [];
  return [raw.slice(firstBracket + 1, lastBracket)];
}

function buildIndexMappings(nodes: ModelIr['nodes'], plates: ModelIr['plates']): IndexMapping[] {
  const mappingNodes = nodes.filter((node) => {
    const parsed = parseSymbolName(node.name);
    const targetPlate = parsed.baseSymbol.replace(/_id$/, '');
    return node.kind === 'data' && parsed.baseSymbol.endsWith('_id') && node.plate !== targetPlate;
  });

  return mappingNodes.map((node) => {
    const parsed = parseSymbolName(node.name);
    const targetPlate = parsed.baseSymbol.replace(/_id$/, '');
    const toPlate = plates.find((plate) => plate.id === targetPlate) ?? plates.find((plate) => plate.id.includes(targetPlate)) ?? plates[0];
    const fromPlate = node.plate ? plates.find((plate) => plate.id === node.plate) : plates[0];

    return {
      id: `${parsed.baseSymbol}_mapping`,
      symbol: parsed.baseSymbol,
      fromPlateId: fromPlate?.id ?? 'unassigned',
      toPlateId: toPlate?.id ?? targetPlate,
      inputIndex: parsed.index ?? fromPlate?.index ?? 'i',
      outputIndex: toPlate?.index,
    };
  });
}

function buildPriorRecipes(nodes: ModelIr['nodes']): PriorRecipe[] {
  return nodes
    .filter((node) => node.distribution?.id === 'horseshoe' || node.distribution?.name === 'Horseshoe')
    .map((node) => {
      const parsed = parseSymbolName(node.name);
      const scale = node.distribution?.args.scale ?? 'tau0';

      return {
        id: `${parsed.baseSymbol}_horseshoe`,
        name: `${parsed.baseSymbol} Horseshoe prior`,
        targetSymbol: parsed.baseSymbol,
        collapsed: `${node.name} ~ Horseshoe(scale = ${scale})`,
        expanded: [],
        validationLevel: 'structured',
        notes: node.notes,
      } satisfies PriorRecipe;
    });
}

function buildPlatesFromNodes(nodes: CanvasNodeLike[]): ModelIr['plates'] {
  const plateIds = [...new Set(nodes.map((node) => node.data.plate).filter((plate): plate is string => Boolean(plate)))];
  return plateIds.map((plateId) => {
    const node = nodes.find((candidate) => candidate.data.plate === plateId);
    const size = node?.data.shape?.[0] ?? plateId.toUpperCase();
    return {
      id: plateId,
      label: plateId,
      index: inferPlateIndex(plateId),
      size,
    };
  });
}

function inferPlateIndex(plateId: string): string {
  if (plateId === 'obs' || plateId === 'observation') return 'i';
  if (plateId === 'group') return 'j';
  if (plateId === 'time') return 't';
  return plateId.slice(0, 1).toLowerCase() || 'i';
}

function inferModelName(nodes: ModelIr['nodes']): string {
  const observed = nodes.find((node) => node.kind === 'likelihood' || node.observed);
  return observed ? `${parseSymbolName(observed.name).baseSymbol}_model` : 'bayes_canvas_model';
}

function buildRegressionTerms(nodes: ModelIr['nodes']): RegressionTerm[] {
  return [];
}

function buildModelBlocks(nodes: ModelIr['nodes']): ModelBlock[] {
  const blocks: ModelBlock[] = nodes
    .filter((node) => node.kind === 'model_block')
    .map((node) => {
      const parsed = parseSymbolName(node.name);

      return {
        id: `${parsed.baseSymbol}_block`,
        kind: parsed.baseSymbol,
        label: node.name,
        inputs: node.expression ? analyzeLooseSymbols(node.expression) : [],
        outputs: [parsed.baseSymbol],
        formulas: node.expression ? [node.expression] : undefined,
        validationLevel: node.validationLevel ?? 'structured',
        notes: node.notes,
      } satisfies ModelBlock;
    });

  return blocks;
}

function buildQuantitiesOfInterest(nodes: ModelIr['nodes']): QuantityOfInterest[] {
  return nodes
    .filter((node) => node.kind === 'derived_quantity')
    .map((node) => {
      const parsed = parseSymbolName(node.name);

      return {
        id: parsed.baseSymbol,
        name: node.name,
        expression: node.expression ?? parsed.baseSymbol,
        description: node.notes,
        scale: 'linear',
        targetPlateId: node.plate,
      } satisfies QuantityOfInterest;
    });
}

function lintModel(model: ModelIr): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const nodeIdBySymbol = new Map(
    model.nodes
      .filter((node) => VARIABLE_NODE_KINDS.has(node.kind))
      .map((node) => [parseSymbolName(node.name).baseSymbol, node.id]),
  );

  for (const node of model.nodes) {
    if (node.expression && node.kind === 'deterministic') {
      diagnostics.push(...lintExpression(node.expression, node.id, model, nodeById, nodeIdBySymbol));
      diagnostics.push(...lintEdgeConsistency(node, model, nodeIdBySymbol));
    }

    if (node.distribution) {
      diagnostics.push(...lintDistribution(node, model, nodeById, nodeIdBySymbol));
    }

    if (node.validationLevel && node.validationLevel !== 'linted') {
      diagnostics.push({
        id: `${node.id}-validation-level`,
        severity: node.validationLevel === 'opaque' ? 'warning' : 'info',
        message: `This block is ${node.validationLevel}; Bayes Canvas does not fully validate its internals.`,
        target: { nodeId: node.id },
        suggestion: 'Respect the declared inputs, outputs, notes, and formulas during AI handoff.',
      });
    }
  }

  for (const quantity of model.quantitiesOfInterest) {
    diagnostics.push(...lintExpression(quantity.expression, quantity.id, model, nodeById, nodeIdBySymbol, { quantityId: quantity.id }));
  }

  return diagnostics;
}

function lintExpression(
  expression: string,
  expressionId: string,
  model: ModelIr,
  nodeById: Map<string, ModelIr['nodes'][number]>,
  nodeIdBySymbol: Map<string, string>,
  targetOverride?: Pick<ModelDiagnostic['target'], 'quantityId'>,
): ModelDiagnostic[] {
  const analysis = analyzeExpression(expression, model.symbolTable);
  const diagnostics: ModelDiagnostic[] = [];

  for (const reference of analysis.references) {
    const nodeId = nodeIdBySymbol.get(reference.symbol);
    const symbol = nodeId ? nodeById.get(nodeId) : undefined;

    if (!symbol) {
      const suggestion = suggestSymbol(reference.symbol, Object.keys(model.symbolTable.variables));
      diagnostics.push({
        id: `${expressionId}-unknown-${reference.symbol}`,
        severity: 'error',
        message: `Unknown symbol: ${reference.symbol}.`,
        target: { expressionId, ...targetOverride },
        suggestion: suggestion ? `Did you mean ${suggestion}?` : 'Define the symbol or remove the reference.',
      });
      continue;
    }

    diagnostics.push(...lintPlateReference(reference, symbol, expressionId, model, targetOverride));
  }

  return diagnostics;
}

function lintDistribution(
  node: ModelIr['nodes'][number],
  model: ModelIr,
  nodeById: Map<string, ModelIr['nodes'][number]>,
  nodeIdBySymbol: Map<string, string>,
): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];
  const definition = DISTRIBUTIONS.find((dist) => dist.id === node.distribution?.id || dist.name === node.distribution?.name);

  if (definition) {
    for (const param of definition.params.filter((candidate) => candidate.required)) {
      if (!node.distribution?.args[param.name]) {
        diagnostics.push({
          id: `${node.id}-${param.name}-missing`,
          severity: 'error',
          message: `${definition.name}.${param.name} is required.`,
          target: { nodeId: node.id, distributionParam: param.name },
          suggestion: `Provide ${param.name} for ${definition.name}.`,
        });
      }
    }

    const allowedParams = new Set(definition.params.map((param) => param.name));
    for (const paramName of Object.keys(node.distribution?.args ?? {})) {
      if (!allowedParams.has(paramName)) {
        diagnostics.push({
          id: `${node.id}-${paramName}-unknown-param`,
          severity: 'warning',
          message: `${definition.name}.${paramName} is not a known parameter.`,
          target: { nodeId: node.id, distributionParam: paramName },
          suggestion: `Use one of: ${definition.params.map((param) => param.name).join(', ')}.`,
        });
      }
    }

    if (definition.id === 'multivariate_normal') {
      const hasCov = Boolean(node.distribution?.args.cov?.trim());
      const hasChol = Boolean(node.distribution?.args.chol?.trim());
      if (hasCov === hasChol) {
        diagnostics.push({
          id: `${node.id}-mvn-parameterization`,
          severity: 'error',
          message: 'MultivariateNormal requires exactly one of cov or chol.',
          target: { nodeId: node.id },
          suggestion: 'Choose covariance or Cholesky parameterization, not both.',
        });
      }
    }

    if (definition.deprecated) {
      diagnostics.push({
        id: `${node.id}-discouraged-distribution`,
        severity: 'warning',
        message: `${definition.name} is discouraged for this workflow.`,
        target: { nodeId: node.id },
        suggestion: definition.notes ?? 'Choose a better-supported distribution before handoff.',
      });
    }

    const supportDiagnostic = lintSupportCompatibility(node, definition);
    if (supportDiagnostic) diagnostics.push(supportDiagnostic);
  }

  for (const [paramName, paramValue] of Object.entries(node.distribution?.args ?? {})) {
    diagnostics.push(
      ...lintExpression(paramValue, `${node.id}-${paramName}`, model, nodeById, nodeIdBySymbol)
        .map((diagnostic) => ({
          ...diagnostic,
          id: `${node.id}-${paramName}-${diagnostic.id}`,
          target: { nodeId: node.id, distributionParam: paramName },
          message: diagnostic.message.replace('Unknown symbol', `Unknown symbol in ${node.distribution?.name}.${paramName}`),
        })),
    );
  }

  return diagnostics;
}

function lintSupportCompatibility(
  node: ModelIr['nodes'][number],
  definition: (typeof DISTRIBUTIONS)[number],
): ModelDiagnostic | undefined {
  const declared = supportFromConstraints(node.constraints);
  if (!declared) return undefined;
  if (declared === definition.support) return undefined;
  if (declared === 'positive' && definition.support === 'real') return undefined;
  if (declared === 'unit_interval' && definition.support === 'real') return undefined;

  return {
    id: `${node.id}-support-mismatch`,
    severity: 'warning',
    message: `${node.name} declares ${declared} support, but ${definition.name} has ${definition.support} support.`,
    target: { nodeId: node.id },
    suggestion: 'Check the constraint, transform, or distribution before handoff.',
  };
}

function supportFromConstraints(constraints?: Constraint[]): string | undefined {
  if (constraints?.some((constraint) => constraint.kind === 'positive')) return 'positive';
  if (constraints?.some((constraint) => constraint.kind === 'unit_interval')) return 'unit_interval';
  if (constraints?.some((constraint) => constraint.kind === 'simplex')) return 'simplex';
  if (constraints?.some((constraint) => constraint.kind === 'ordered')) return 'ordered';
  if (constraints?.some((constraint) => constraint.kind === 'correlation_matrix')) return 'correlation_matrix';
  return undefined;
}

function lintEdgeConsistency(
  node: ModelIr['nodes'][number],
  model: ModelIr,
  nodeIdBySymbol: Map<string, string>,
): ModelDiagnostic[] {
  const expressionRefs = new Set(
    analyzeExpression(node.expression ?? '', model.symbolTable)
      .references
      .map((reference) => nodeIdBySymbol.get(reference.symbol))
      .filter(Boolean),
  );
  const incoming = new Set(model.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from));
  const diagnostics: ModelDiagnostic[] = [];

  for (const refNodeId of expressionRefs) {
    if (refNodeId && !incoming.has(refNodeId)) {
      diagnostics.push({
        id: `${node.id}-missing-edge-${refNodeId}`,
        severity: 'warning',
        message: `Expression uses ${nodeBySymbolName(model, refNodeId)}, but the canvas has no incoming edge.`,
        target: { nodeId: node.id, expressionId: node.id },
        suggestion: 'Add the missing dependency edge or update the expression.',
      });
    }
  }

  for (const edgeNodeId of incoming) {
    if (!expressionRefs.has(edgeNodeId)) {
      const role = model.edges.find((edge) => edge.from === edgeNodeId && edge.to === node.id)?.role;
      if (role === 'index' || role === 'observed-value') continue;
      diagnostics.push({
        id: `${node.id}-unused-edge-${edgeNodeId}`,
        severity: 'info',
        message: `Canvas has an edge from ${nodeBySymbolName(model, edgeNodeId)}, but the expression does not reference it.`,
        target: { nodeId: node.id, expressionId: node.id },
        suggestion: 'Remove the edge or include the symbol in the expression.',
      });
    }
  }

  return diagnostics;
}

function lintPlateReference(
  reference: ExpressionReference,
  symbol: ModelIr['nodes'][number],
  expressionId: string,
  model: ModelIr,
  targetOverride?: Pick<ModelDiagnostic['target'], 'quantityId'>,
): ModelDiagnostic[] {
  const parsed = parseSymbolName(symbol.name);
  const expectedIndex = parsed.index;
  const index = reference.indices[0];

  if (!symbol.plate || !expectedIndex || !index) return [];
  if (index === expectedIndex) return [];

  const mapping = model.indexMappings.find((candidate) => index.startsWith(`${candidate.symbol}[`));
  if (mapping && mapping.toPlateId === symbol.plate) return [];

  return [{
    id: `${expressionId}-${reference.symbol}-index-mismatch`,
    severity: 'warning',
    message: `${reference.symbol} is defined over index ${expectedIndex}, but it is referenced as ${reference.raw}.`,
    target: { expressionId, ...targetOverride },
    suggestion: mapping
      ? `Use ${reference.symbol}[${mapping.symbol}[${mapping.inputIndex}]] for ${mapping.fromPlateId} to ${mapping.toPlateId} mapping.`
      : `Check whether ${reference.symbol}[${expectedIndex}] or an index mapping is intended.`,
  }];
}

function nodeBySymbolName(model: ModelIr, nodeId: string): string {
  return model.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;
}

function analyzeLooseSymbols(expression: string): string[] {
  const parsed = parseExpression(expression);
  if (!parsed.ok) return [];
  return [...new Set(collectReferenceOccurrences(parsed.ast).map((reference) => reference.symbol))]
    .filter((symbol) => !['exp', 'log', 'logit', 'inv_logit', 'softmax', 'dot', 'i', 'j', 'k', 't'].includes(symbol));
}

function suggestSymbol(value: string, candidates: string[]): string | undefined {
  const scored = candidates
    .map((candidate) => ({ candidate, score: levenshtein(value, candidate) }))
    .filter((entry) => entry.score <= 2)
    .sort((a, b) => a.score - b.score);

  return scored[0]?.candidate;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }

  return dp[a.length][b.length];
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

const VARIABLE_NODE_KINDS = new Set<BayesNodeKind>([
  'data',
  'parameter',
  'hyperparameter',
  'latent',
  'deterministic',
  'likelihood',
]);

export function buildSymbolTable(
  nodes: ModelIr['nodes'],
  plates: ModelIr['plates'],
): SymbolTable {
  return {
    variables: Object.fromEntries(
      nodes
        .filter((node) => VARIABLE_NODE_KINDS.has(node.kind))
        .map((node) => {
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
              eventShape: node.eventShape ?? [],
            } satisfies VariableSymbol,
          ];
        }),
    ),
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
    `shape: ${formatNodeShape(node)}`,
    node.plate ? `repeated scope (plate): ${node.plate}` : undefined,
    node.observed ? 'observed' : undefined,
    node.distribution ? `distribution: ${formatDistributionText(node.distribution)}` : undefined,
    node.expression ? `expression: ${node.expression}` : undefined,
  ].filter(Boolean);

  return parts.join('; ');
}

function formatPlateList(model: ModelIr): string {
  const plateLines = model.plates.length
    ? model.plates.map((plate) => `- ${plate.id}: repeated scope ${plate.label}; index ${plate.index}; size ${plate.size}`)
    : ['- No repeated scopes declared'];
  const shapeLines = model.nodes
    .filter((node) => node.shape?.length || node.eventShape?.length)
    .map((node) => `- ${node.name}: ${formatNodeShape(node)}`);

  return [...plateLines, ...(shapeLines.length ? ['- Variable shapes:', ...shapeLines] : [])].join('\n');
}

function formatNodeShape(node: Pick<BayesNodeData, 'shape' | 'eventShape'>): string {
  const batch = node.shape?.length ? `batch ${node.shape.join(' x ')}` : undefined;
  const event = node.eventShape?.length ? `event ${node.eventShape.join(' x ')}` : undefined;
  return [batch, event].filter(Boolean).join('; ') || 'scalar';
}

function formatIndexMappings(mappings: IndexMapping[]): string {
  if (!mappings.length) return '- No index mappings declared';

  return mappings
    .map((mapping) =>
      `- ${mapping.symbol}[${mapping.inputIndex}]: ${mapping.fromPlateId} -> ${mapping.toPlateId}${mapping.outputIndex ? ` (${mapping.outputIndex})` : ''}`,
    )
    .join('\n');
}

function formatDiagnostics(diagnostics: ModelDiagnostic[]): string {
  if (!diagnostics.length) return '- No diagnostics';

  return diagnostics
    .map((diagnostic) => {
      const target = [
        diagnostic.target.nodeId ? `node ${diagnostic.target.nodeId}` : undefined,
        diagnostic.target.expressionId ? `expression ${diagnostic.target.expressionId}` : undefined,
        diagnostic.target.distributionParam ? `param ${diagnostic.target.distributionParam}` : undefined,
        diagnostic.target.quantityId ? `quantity ${diagnostic.target.quantityId}` : undefined,
      ].filter(Boolean).join('; ');

      return `- ${diagnostic.severity.toUpperCase()}: ${diagnostic.message}${target ? ` (${target})` : ''}${diagnostic.suggestion ? ` ${diagnostic.suggestion}` : ''}`;
    })
    .join('\n');
}

function formatObservationProcesses(nodes: ModelIr['nodes']): string {
  const lines = nodes
    .filter((node) => node.observationProcess)
    .map((node) => `- ${node.name}: ${formatObservationProcess(node.observationProcess!)}`);

  return lines.length ? lines.join('\n') : '- Exact observation assumed unless otherwise declared';
}

function formatObservationProcess(process: ObservationProcess): string {
  if (process.kind === 'missing') return `missing (${process.strategy})`;
  if (process.kind === 'measurement_error') {
    return `measurement error; latent true ${process.latentTrueSymbol}${process.errorScaleSymbol ? `; scale ${process.errorScaleSymbol}` : ''}`;
  }
  if (process.kind === 'censored') return `${process.direction} censored${process.boundSymbol ? ` at ${process.boundSymbol}` : ''}`;
  if (process.kind === 'truncated') return `truncated${process.lower ? ` lower ${process.lower}` : ''}${process.upper ? ` upper ${process.upper}` : ''}`;
  if (process.kind === 'rounded') return `rounded${process.unit ? ` to ${process.unit}` : ''}`;
  if (process.kind === 'custom') return process.description;
  return 'exact';
}

function formatObservationProcessTex(process: ObservationProcess): string {
  const sym = (s: string) => formatTexExpression(s);
  if (process.kind === 'missing') return `\\text{missing (${process.strategy})}`;
  if (process.kind === 'measurement_error') {
    const scale = process.errorScaleSymbol ? `,\\; \\text{scale } ${sym(process.errorScaleSymbol)}` : '';
    return `\\text{measurement error; latent } ${sym(process.latentTrueSymbol)}${scale}`;
  }
  if (process.kind === 'censored') {
    const bound = process.boundSymbol ? `\\text{ at } ${sym(process.boundSymbol)}` : '';
    return `\\text{${process.direction} censored}${bound}`;
  }
  if (process.kind === 'truncated') {
    const lower = process.lower ? `\\text{ lower } ${sym(process.lower)}` : '';
    const upper = process.upper ? `\\text{ upper } ${sym(process.upper)}` : '';
    return `\\text{truncated}${lower}${upper}`;
  }
  if (process.kind === 'rounded') return `\\text{rounded${process.unit ? ` to ${process.unit}` : ''}}`;
  if (process.kind === 'custom') return `\\text{${process.description.replace(/[{}\\]/g, '\\$&')}}`;
  return '\\text{exact}';
}

function formatConstraintsAndHints(nodes: ModelIr['nodes']): string {
  const lines = nodes.flatMap((node) => {
    const constraints = (node.constraints ?? []).map((constraint) => `${node.name}: constraint ${formatConstraint(constraint)}`);
    const hints = (node.hints ?? []).map((hint) => `${node.name}: hint ${formatHint(hint)}`);
    return [...constraints, ...hints].map((line) => `- ${line}`);
  });

  return lines.length ? lines.join('\n') : '- No constraints or implementation hints declared';
}

function formatConstraint(constraint: Constraint): string {
  if (constraint.kind === 'sum_to_zero') return `sum_to_zero${constraint.overPlateId ? ` over ${constraint.overPlateId}` : ''}`;
  if (constraint.kind === 'custom') return `custom (${constraint.description})`;
  return constraint.kind;
}

function formatHint(hint: ModelHint): string {
  return `${hint.kind}: ${hint.value}`;
}

function formatPriorRecipes(recipes: PriorRecipe[]): string {
  if (!recipes.length) return '- No prior recipes declared';

  return recipes
    .map((recipe) => [
      `- ${recipe.name} -> ${recipe.targetSymbol}; validation ${recipe.validationLevel}`,
      `  collapsed: ${recipe.collapsed}`,
      ...recipe.expanded.map((line) => `  expanded: ${line}`),
      recipe.notes ? `  notes: ${recipe.notes}` : undefined,
    ].filter(Boolean).join('\n'))
    .join('\n');
}

function formatRegressionTerms(terms: RegressionTerm[]): string {
  if (!terms.length) return '- No regression terms declared';

  return terms
    .map((term) => `- ${term.label}: ${term.formulaShort}; inputs ${term.inputSymbols.join(', ') || 'none'}; validation ${term.validationLevel}`)
    .join('\n');
}

function formatModelBlocks(blocks: ModelBlock[]): string {
  if (!blocks.length) return '- No opaque or structured blocks declared';

  return blocks
    .map((block) => {
      const formulas = block.formulas?.length ? `; formulas ${block.formulas.join(' | ')}` : '';
      const notes = block.notes ? `; notes ${block.notes}` : '';
      return `- ${block.label} (${block.kind}, ${block.validationLevel}): inputs ${block.inputs.join(', ') || 'none'}; outputs ${block.outputs.join(', ') || 'none'}${formulas}${notes}`;
    })
    .join('\n');
}

function formatQuantitiesOfInterest(quantities: QuantityOfInterest[]): string {
  if (!quantities.length) return '- No quantities of interest declared';

  return quantities
    .map((quantity) => {
      const parts = [
        `${quantity.name} = ${quantity.expression}`,
        quantity.scale ? `scale ${quantity.scale}` : undefined,
        quantity.targetPlateId ? `target repeated scope ${quantity.targetPlateId}` : undefined,
        quantity.description,
      ].filter(Boolean);
      return `- ${parts.join('; ')}`;
    })
    .join('\n');
}

function formatSymbolTable(symbolTable: SymbolTable): string {
  const variableLines = Object.values(symbolTable.variables).map((symbol) => {
    const parts = [
      `${symbol.baseSymbol}: ${symbol.displayName}`,
      symbol.kind,
      symbol.plateId ? `repeated scope ${symbol.plateId}` : undefined,
      symbol.declaredIndex ? `index ${symbol.declaredIndex}` : undefined,
      symbol.shape.length ? `shape ${symbol.shape.join(' x ')}` : 'scalar',
    ].filter(Boolean);

    return `- ${parts.join('; ')}`;
  });
  const indexLines = Object.values(symbolTable.indices).map(
    (symbol) => `- ${symbol.index}: ${symbol.label}; size ${symbol.size}; repeated scope ${symbol.plateId}`,
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
