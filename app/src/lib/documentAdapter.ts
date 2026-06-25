import type { Edge, Node } from '@xyflow/react';
import type { BayesNodeData, Constraint, ModelHint, ObservationProcess } from './modelIr';
import { DISTRIBUTIONS, type DistributionSpec } from './distributionRegistry.js';
import { compileModel } from './core/compiler.js';
import { buildHandoffBundle, type BackendCapabilityItem, type HandoffTarget } from './core/handoff.js';
import { createMacroInstance } from './core/macros.js';
import { previewPatchProposal, type AiPatchProposal } from './core/patch-proposal.js';
import { buildPortablePackage } from './core/portable.js';
import { InMemoryDistributionRegistry } from './core/registry.js';
import {
  validateLayoutDocumentEnvelope,
  validateModelDocumentEnvelope,
  type SchemaValidationIssue,
} from './core/schema-validation.js';
import { TARGET_PROFILES } from './core/target-profiles.js';
import type {
  AxisDefinition,
  AxisUse,
  DistributionDefinition,
  Domain,
  ImplementationHint,
  LayoutDocument,
  ModelConstraint,
  ModelDocument,
  ModelEntity,
  ObservationProcess as CoreObservationProcess,
  PlateDefinition,
  SourceText,
  ValueType,
} from './core/model.js';

export interface AuthoringSnapshot {
  document: ModelDocument;
  layout: LayoutDocument;
}

export interface CanvasProjectorInput {
  nodes: Node<BayesNodeData>[];
  edges: Edge[];
  modelName?: string;
}

export interface PortablePackageImportPreview {
  document: ModelDocument;
  layout: LayoutDocument;
  semantic: ReturnType<typeof compileModel>;
  projected: { nodes: Node<BayesNodeData>[]; edges: Edge[] };
  summary: string;
}

const SOURCE_LANGUAGE = 'bayes-expr@1' as const;
const compilerDistributionRegistry = new InMemoryDistributionRegistry(
  DISTRIBUTIONS.map(toCompilerDistribution),
);

export function canvasToAuthoringSnapshot({
  nodes,
  edges,
  modelName = 'bayes_canvas_model',
}: CanvasProjectorInput): AuthoringSnapshot {
  const axes = buildAxes(nodes);
  const plates = buildPlates(nodes, axes);
  const generatedObservationIds = nodes
    .filter((node) => node.data.kind === 'likelihood' && node.data.observed)
    .map((node) => `obs_${node.id}`);
  const entities = {
    ...Object.fromEntries(nodes.map((node) => [node.id, nodeToEntity(node)])),
    ...Object.fromEntries(
      nodes
        .filter((node) => node.data.kind === 'likelihood' && node.data.observed)
        .map((node) => [`obs_${node.id}`, likelihoodObservationData(node)]),
    ),
  };
  const documentId = `model_${stableId(modelName)}`;

  const document: ModelDocument = {
    schemaVersion: '1.0.0',
    documentId,
    revision: 1,
    model: {
      id: documentId,
      name: modelName,
      description: 'Authored in Bayes Canvas and projected from the canvas view.',
    },
    axes,
    plates,
    entities,
    entityOrder: [
      ...nodes.map((node) => node.id),
      ...generatedObservationIds,
    ],
    macros: buildMacros(nodes),
    notes: buildNotes(nodes),
    noteOrder: Object.keys(buildNotes(nodes)),
    extensions: {
      'bayes-canvas': {
        annotationEdges: edges.map((edge) => ({
          id: edge.id,
          from: edge.source,
          to: edge.target,
          role: String(edge.data?.role ?? 'dependency'),
        })),
      },
    },
  };

  return {
    document,
    layout: {
      schemaVersion: '1.0.0',
      modelDocumentId: document.documentId,
      revision: 1,
      hiddenEntityIds: generatedObservationIds,
      nodes: Object.fromEntries(nodes.map((node) => [
        node.id,
        {
          x: node.position.x,
          y: node.position.y,
          width: node.measured?.width,
          height: node.measured?.height,
        },
      ])),
      view: { x: 0, y: 0, zoom: 1 },
    },
  };
}

export function compileCanvas(nodes: Node<BayesNodeData>[], edges: Edge[]) {
  const snapshot = canvasToAuthoringSnapshot({ nodes, edges });
  const semantic = compileModel(snapshot.document, compilerDistributionRegistry, {
    compilerVersion: '0.2.0',
  });

  return { ...snapshot, semantic };
}

export function buildCanvasHandoff(nodes: Node<BayesNodeData>[], edges: Edge[], target: HandoffTarget) {
  const snapshot = compileCanvas(nodes, edges);
  return buildHandoffBundle(
    snapshot.document,
    snapshot.semantic,
    target,
    buildCapabilityReport(snapshot.document, target),
  );
}

export function buildCanvasPortablePackage(nodes: Node<BayesNodeData>[], edges: Edge[], target: HandoffTarget = 'review') {
  const snapshot = compileCanvas(nodes, edges);
  return buildPortablePackage(snapshot.document, snapshot.layout, snapshot.semantic, target);
}

export function previewCanvasPatch(nodes: Node<BayesNodeData>[], edges: Edge[], proposal: AiPatchProposal) {
  const snapshot = canvasToAuthoringSnapshot({ nodes, edges });
  const preview = previewPatchProposal(snapshot.document, proposal, compilerDistributionRegistry);
  return {
    ...preview,
    projected: projectToReactFlow({
      document: preview.patchedDocument,
      layout: snapshot.layout,
    }),
  };
}

export function previewPortablePackageImport(packageData: unknown): PortablePackageImportPreview {
  if (!isRecord(packageData)) {
    throw new Error('Portable package must be a JSON object.');
  }
  if (!isRecord(packageData.files)) {
    throw new Error('Portable package is missing files.');
  }

  const document = parsePackageJsonFile<ModelDocument>(packageData.files['model.json'], 'model.json');
  const layout = parsePackageJsonFile<LayoutDocument>(packageData.files['layout.json'], 'layout.json');
  const validationIssues = [
    ...validateModelDocumentEnvelope(document).map((issue) => prefixValidationIssue('model.json', issue)),
    ...validateLayoutDocumentEnvelope(layout).map((issue) => prefixValidationIssue('layout.json', issue)),
  ];

  if (document.schemaVersion !== '1.0.0') {
    validationIssues.push('model.json/schemaVersion: Unsupported schemaVersion.');
  }
  if (layout.schemaVersion !== '1.0.0') {
    validationIssues.push('layout.json/schemaVersion: Unsupported schemaVersion.');
  }
  if (layout.modelDocumentId !== document.documentId) {
    validationIssues.push('layout.json/modelDocumentId: Layout does not match model documentId.');
  }
  if (!isRecord(document.entities) || !Array.isArray(document.entityOrder)) {
    validationIssues.push('model.json/entities: ModelDocument must include entities and entityOrder.');
  }
  if (!isRecord(layout.nodes) || !isRecord(layout.view)) {
    validationIssues.push('layout.json/nodes: LayoutDocument must include nodes and view.');
  }

  if (validationIssues.length) {
    throw new Error(`Portable package validation failed: ${validationIssues.join(' / ')}`);
  }

  const semantic = compileModel(document, compilerDistributionRegistry, {
    compilerVersion: '0.2.0',
  });
  const projected = projectToReactFlow({ document, layout });
  return {
    document,
    layout,
    semantic,
    projected,
    summary: `${projected.nodes.length} nodes / ${projected.edges.length} links / ${semantic.diagnostics.length} diagnostics`,
  };
}

export function projectToReactFlow(snapshot: AuthoringSnapshot): { nodes: Node<BayesNodeData>[]; edges: Edge[] } {
  const extension = snapshot.document.extensions?.['bayes-canvas'] as { annotationEdges?: Array<{ id: string; from: string; to: string; role: string }> } | undefined;
  return {
    nodes: snapshot.document.entityOrder
      .filter((entityId) => snapshot.document.entities[entityId])
      .filter((entityId) => snapshot.document.entities[entityId].authorship !== 'generated')
      .filter((entityId) => !snapshot.layout.hiddenEntityIds?.includes(entityId))
      .map((entityId) => {
        const entity = snapshot.document.entities[entityId];
        const layout = snapshot.layout.nodes[entityId];
        return {
          id: entityId,
          type: 'bayesNode',
          position: { x: layout?.x ?? 0, y: layout?.y ?? 0 },
          data: entityToNodeData(entity),
        };
      }),
    edges: (extension?.annotationEdges ?? []).map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      data: { role: edge.role },
    })),
  };
}

function parsePackageJsonFile<T>(value: unknown, fileName: string): T {
  if (typeof value !== 'string') {
    throw new Error(`Portable package is missing ${fileName}.`);
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${fileName} is not valid JSON.`);
  }
}

function prefixValidationIssue(scope: string, issue: SchemaValidationIssue): string {
  return `${scope}${issue.path}: ${issue.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function buildCapabilityReport(document: ModelDocument, target: HandoffTarget): BackendCapabilityItem[] {
  const items: BackendCapabilityItem[] = [
    {
      feature: 'ModelDocument schema',
      support: 'native',
      relatedEntityIds: [],
      note: 'Canvas semantics are exported separately from layout state.',
    },
    {
      feature: 'Expression AST and symbol binding',
      support: 'native',
      relatedEntityIds: [],
      note: 'Expressions are parsed by the compiler before handoff.',
    },
    {
      feature: `${TARGET_PROFILES[target].label} target profile`,
      support: TARGET_PROFILES[target].defaultSupport,
      relatedEntityIds: [],
      note: TARGET_PROFILES[target].notes.join(' '),
    },
  ];

  for (const entity of Object.values(document.entities)) {
    if (entity.kind === 'block_instance') {
      items.push({
        feature: `${entity.blockTypeId} block`,
        support: target === 'review' ? 'native' : 'approximate',
        relatedEntityIds: [entity.id],
        note: 'Block internals are boundary-checked; implementation must preserve ports and config.',
      });
    }
    if (entity.kind === 'random_variable') {
      const backendName = TARGET_PROFILES[target].distributionNames[entity.distribution.distributionId];
      items.push({
        feature: `${entity.distribution.distributionId} distribution`,
        support: backendName ? 'native' : distributionSupportForTarget(target),
        relatedEntityIds: [entity.id],
        note: backendName ? `Backend name: ${backendName}` : 'No backend-specific distribution name is registered.',
      });
    }
    if (entity.kind === 'random_variable' && entity.distribution.distributionId === 'wishart') {
      items.push({
        feature: 'Wishart covariance prior',
        support: 'unsupported',
        relatedEntityIds: [entity.id],
        note: 'Prefer LKJ correlation plus scale priors unless a backend-specific reason is documented.',
      });
    }
  }

  return items;
}

function distributionSupportForTarget(target: HandoffTarget): BackendCapabilityItem['support'] {
  if (target === 'generic' || target === 'review') return TARGET_PROFILES[target].defaultSupport;
  return 'unsupported';
}

function buildMacros(nodes: Node<BayesNodeData>[]): ModelDocument['macros'] | undefined {
  const macros = Object.fromEntries(
    nodes
      .filter((node) => node.data.distribution?.id === 'horseshoe' || node.data.distribution?.name === 'Horseshoe')
      .map((node) => {
        const symbol = parseNodeSymbol(node.data.name);
        return [
          `${node.id}_horseshoe_macro`,
          createMacroInstance(
            `${node.id}_horseshoe_macro`,
            'horseshoe_prior',
            {
              target: symbol,
              scale: node.data.distribution?.args.scale ?? 'tau0',
            },
            {
              collapsed: `${symbol} ~ Horseshoe(scale)`,
              expanded: ['local shrinkage scale', 'global shrinkage scale'],
            },
          ),
        ];
      }),
  );
  return Object.keys(macros).length ? macros : undefined;
}

function nodeToEntity(node: Node<BayesNodeData>): ModelEntity {
  const data = node.data;
  const symbol = parseNodeSymbol(data.name);
  const valueType = toValueType(data);
  const plateIds = data.plate ? [data.plate] : [];
  const common = {
    id: node.id,
    symbol,
    label: data.name,
    valueType,
    plateIds,
    notes: data.notes,
    authorship: 'user' as const,
  };

  if (data.kind === 'data') {
    return {
      ...common,
      kind: 'data',
      dataRole: symbol.endsWith('_id') ? 'index' : 'predictor',
      missingValuePolicy: data.observationProcess?.kind === 'missing' ? 'declared in observation process' : undefined,
    };
  }

  if (data.kind === 'deterministic') {
    return {
      ...common,
      kind: 'deterministic',
      expression: source(data.expression || 'unresolved'),
    };
  }

  if (data.kind === 'model_block') {
    return {
      ...common,
      kind: 'block_instance',
      blockTypeId: symbol,
      blockVersion: '1.0.0',
      inputs: Object.fromEntries(findLooseSymbols(data.expression ?? '').map((input) => [
        input,
        { portId: input, expression: source(input) },
      ])),
      outputs: { value: node.id },
      config: {
        expression: data.expression ?? '',
        validationLevel: data.validationLevel ?? 'structured',
      },
    };
  }

  if (data.kind === 'derived_quantity') {
    return {
      ...common,
      kind: 'query',
      queryRole: 'quantity_of_interest',
      expression: source(data.expression || symbol),
      scale: 'linear',
    };
  }

  return {
    ...common,
    kind: 'random_variable',
    role: data.kind === 'likelihood' ? 'observation' : data.kind === 'latent' ? 'latent' : 'parameter',
    distribution: toDistributionCall(data.distribution),
    observedDataId: data.kind === 'likelihood' && data.observed ? `obs_${node.id}` : undefined,
    observationProcess: toCoreObservationProcess(data.observationProcess),
    constraints: toCoreConstraints(data.constraints),
    hints: toCoreHints(data.hints),
  };
}

function likelihoodObservationData(node: Node<BayesNodeData>): ModelEntity {
  return {
    id: `obs_${node.id}`,
    symbol: `${parseNodeSymbol(node.data.name)}_observed`,
    label: `${node.data.name} observed values`,
    kind: 'data',
    dataRole: 'observed_value',
    valueType: toValueType({ ...node.data, kind: 'data' }),
    plateIds: node.data.plate ? [node.data.plate] : [],
    notes: 'Generated observation binding for the likelihood node.',
    authorship: 'generated',
  };
}

function entityToNodeData(entity: ModelEntity): BayesNodeData {
  const batchShape = entity.valueType.axes
    .filter((axis) => axis.role === 'batch')
    .map((axis) => formatAxisForCanvas(axis.axisId));
  const eventShape = entity.valueType.axes
    .filter((axis) => axis.role === 'event')
    .map((axis) => formatAxisForCanvas(axis.axisId));
  const base = {
    name: entity.label ?? entity.symbol,
    shape: batchShape.length ? batchShape : undefined,
    eventShape: eventShape.length ? eventShape : undefined,
    plate: entity.plateIds[0],
    notes: entity.notes,
  };
  if (entity.kind === 'data') return { ...base, kind: 'data', observed: entity.dataRole === 'observed_value' };
  if (entity.kind === 'deterministic') return { ...base, kind: 'deterministic', expression: entity.expression.source };
  if (entity.kind === 'block_instance') return { ...base, kind: 'model_block', expression: String(entity.config.expression ?? ''), validationLevel: 'structured' };
  if (entity.kind === 'query') return { ...base, kind: 'derived_quantity', expression: entity.expression.source };
  if (entity.kind === 'factor') return { ...base, kind: 'model_block', expression: entity.logDensity.source, validationLevel: 'structured' };
  return {
    ...base,
    kind: entity.role === 'observation' ? 'likelihood' : entity.role === 'latent' ? 'latent' : 'parameter',
    observed: entity.role === 'observation',
    distribution: {
      id: entity.distribution.distributionId,
      name: entity.distribution.distributionId,
      args: Object.fromEntries(Object.entries(entity.distribution.args).map(([key, value]) => [key, value.source])),
    },
  };
}

function buildAxes(nodes: Node<BayesNodeData>[]): Record<string, AxisDefinition> {
  const axes: Record<string, AxisDefinition> = {};
  const addAxis = (id: string, symbol = id.toUpperCase()) => {
    if (!axes[id]) {
      axes[id] = {
        id,
        symbol,
        label: id,
        size: source(symbol),
      };
    }
  };

  for (const node of nodes) {
    for (const shape of node.data.shape ?? []) addAxis(shape.toLowerCase(), shape);
    for (const shape of node.data.eventShape ?? []) addAxis(shape.toLowerCase(), shape);
    if (node.data.plate) addAxis(node.data.plate, node.data.plate.toUpperCase());
  }

  return axes;
}

function buildPlates(nodes: Node<BayesNodeData>[], axes: Record<string, AxisDefinition>): Record<string, PlateDefinition> {
  const plates: Record<string, PlateDefinition> = {};

  for (const node of nodes) {
    const plateId = node.data.plate;
    if (!plateId || plates[plateId]) continue;
    const axisId = axes[plateId] ? plateId : node.data.shape?.[0]?.toLowerCase() ?? plateId;
    plates[plateId] = {
      id: plateId,
      label: plateId,
      axisId,
      indexSymbol: inferIndexSymbol(plateId),
      parentPlateIds: [],
      assumption: 'conditionally_independent',
    };
  }

  return plates;
}

function buildNotes(nodes: Node<BayesNodeData>[]): ModelDocument['notes'] {
  const notes: ModelDocument['notes'] = {};
  for (const node of nodes) {
    if (!node.data.notes) continue;
    const id = `${node.id}_note`;
    notes[id] = {
      id,
      kind: node.data.notes.includes('?') || node.data.notes.includes('TODO') ? 'review_question' : 'implementation_note',
      text: node.data.notes,
      status: 'open',
      relatedEntityIds: [node.id],
      author: 'user',
      blocking: false,
    };
  }
  return notes;
}

function toValueType(data: BayesNodeData): ValueType {
  const axes: AxisUse[] = (data.shape ?? []).map((shape) => ({
    axisId: shape.toLowerCase(),
    role: 'batch',
  }));
  if (data.plate && !axes.some((axis) => axis.axisId === data.plate && axis.role === 'batch')) {
    axes.push({ axisId: data.plate, role: 'batch' });
  }
  axes.push(...(data.eventShape ?? []).map((shape) => ({
    axisId: shape.toLowerCase(),
    role: 'event' as const,
  })));

  return {
    scalar: data.kind === 'data' && parseNodeSymbol(data.name).endsWith('_id') ? 'integer' : 'real',
    axes,
    domain: constraintsToDomain(data.constraints),
  };
}

function formatAxisForCanvas(axisId: string): string {
  return axisId.toUpperCase();
}

function toDistributionCall(distribution?: DistributionSpec) {
  const id = normalizeDistributionId(distribution?.id ?? distribution?.name ?? 'normal');
  return {
    distributionId: id,
    parameterizationId: id === 'multivariate_normal'
      ? distribution?.args.chol
        ? 'cholesky'
        : 'covariance'
      : undefined,
    args: Object.fromEntries(
      Object.entries(distribution?.args ?? { mu: '0', sigma: '1' }).map(([key, value]) => [key, source(value)]),
    ),
  };
}

function toCompilerDistribution(distribution: (typeof DISTRIBUTIONS)[number]): DistributionDefinition {
  return {
    id: normalizeDistributionId(distribution.id),
    label: distribution.name,
    requiredArgs: distribution.params.filter((param) => param.required).map((param) => param.name),
    optionalArgs: distribution.params.filter((param) => !param.required).map((param) => param.name),
    support: supportToDomain(distribution.support),
    eventRank: distribution.family === 'multivariate' ? 1 : 0,
    aliases: [distribution.name, ...(distribution.aliases ?? [])].map(normalizeDistributionId),
    deprecated: distribution.deprecated,
  };
}

function toCoreConstraints(constraints?: Constraint[]): ModelConstraint[] | undefined {
  const mapped = (constraints ?? []).flatMap((constraint): ModelConstraint[] => {
    if (constraint.kind === 'sum_to_zero' && constraint.overPlateId) {
      return [{ kind: 'sum_to_zero', axisId: constraint.overPlateId }];
    }
    if (constraint.kind === 'custom') return [{ kind: 'custom', description: constraint.description }];
    return [];
  });
  return mapped.length ? mapped : undefined;
}

function toCoreHints(hints?: ModelHint[]): ImplementationHint[] | undefined {
  const mapped = (hints ?? []).map((hint): ImplementationHint => {
    if (hint.kind === 'parameterization' && hint.value !== 'unspecified') {
      return { kind: 'parameterization', value: hint.value };
    }
    if (hint.kind === 'implementation') return { kind: 'custom', note: hint.value };
    return { kind: 'custom', note: `${hint.kind}: ${hint.value}` };
  });
  return mapped.length ? mapped : undefined;
}

function toCoreObservationProcess(process?: ObservationProcess): CoreObservationProcess | undefined {
  if (!process) return undefined;
  if (process.kind === 'measurement_error') {
    return {
      kind: 'measurement_error',
      latentTrueEntityId: parseNodeSymbol(process.latentTrueSymbol),
      errorScale: process.errorScaleSymbol ? source(process.errorScaleSymbol) : undefined,
    };
  }
  if (process.kind === 'censored') return { kind: 'censored', direction: process.direction, upper: process.boundSymbol ? source(process.boundSymbol) : undefined };
  if (process.kind === 'truncated') return { kind: 'truncated', lower: process.lower ? source(process.lower) : undefined, upper: process.upper ? source(process.upper) : undefined };
  if (process.kind === 'rounded') return { kind: 'rounded', unit: source(process.unit ?? 'unit') };
  if (process.kind === 'missing') return { kind: 'missing', strategy: process.strategy };
  if (process.kind === 'custom') return { kind: 'custom', description: process.description };
  return { kind: 'exact' };
}

function constraintsToDomain(constraints?: Constraint[]): Domain | undefined {
  if (constraints?.some((constraint) => constraint.kind === 'positive')) return { kind: 'positive' };
  if (constraints?.some((constraint) => constraint.kind === 'unit_interval')) return { kind: 'unit_interval' };
  if (constraints?.some((constraint) => constraint.kind === 'simplex')) return { kind: 'simplex', axisId: 'component' };
  if (constraints?.some((constraint) => constraint.kind === 'ordered')) return { kind: 'ordered', axisId: 'category' };
  if (constraints?.some((constraint) => constraint.kind === 'correlation_matrix')) return { kind: 'correlation_matrix', axisId: 'dimension' };
  return undefined;
}

function supportToDomain(support: string): Domain {
  if (support === 'real') return { kind: 'real' };
  if (support === 'positive' || support === 'positive_definite_matrix' || support === 'cholesky_factor_corr') return { kind: 'positive' };
  if (support === 'unit_interval') return { kind: 'unit_interval' };
  if (support === 'simplex') return { kind: 'simplex', axisId: 'component' };
  if (support === 'ordered') return { kind: 'ordered', axisId: 'category' };
  if (support === 'correlation_matrix') return { kind: 'correlation_matrix', axisId: 'dimension' };
  return { kind: 'custom', description: support };
}

function normalizeDistributionId(value: string): string {
  const lowered = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (lowered === 'halfnormal' || lowered === 'half_normal') return 'halfnormal';
  if (lowered === 'studentt') return 'student_t';
  if (lowered === 'multivariatenormal' || lowered === 'mvn') return 'multivariate_normal';
  return lowered;
}

function parseNodeSymbol(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*/u.exec(name.trim())?.[0] ?? stableId(name);
}

function inferIndexSymbol(plateId: string): string {
  if (plateId === 'obs' || plateId === 'observation') return 'i';
  if (plateId === 'group') return 'j';
  if (plateId === 'time') return 't';
  return plateId.slice(0, 1).toLowerCase() || 'i';
}

function source(value: string): SourceText {
  return { language: SOURCE_LANGUAGE, source: value };
}

function stableId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
}

function findLooseSymbols(value: string): string[] {
  return [...new Set(value.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? [])]
    .filter((symbol) => !['GP', 'kernel', 'RBF', 'lengthscale', 'amplitude'].includes(symbol));
}
