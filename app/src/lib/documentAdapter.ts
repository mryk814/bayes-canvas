import type { Edge, Node } from '@xyflow/react';
import type { BayesNodeData, Constraint, ModelHint, ObservationProcess } from './modelIr';
import { DISTRIBUTIONS, type DistributionSpec } from './distributionRegistry.js';
import { compileModel } from './core/compiler.js';
import { buildHandoffBundle, type BackendCapabilityItem, type HandoffTarget } from './core/handoff.js';
import { createMacroInstance } from './core/macros.js';
import { previewPatchProposal, type AiPatchProposal } from './core/patch-proposal.js';
import { buildPortablePackage, type PortableCanvasEdge } from './core/portable.js';
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
  BlockInstanceEntity,
  DataEntity,
  DistributionDefinition,
  Domain,
  FactorEntity,
  ImplementationHint,
  LayoutDocument,
  ModelConstraint,
  ModelDocument,
  ModelEntity,
  ModelNote,
  ObservationProcess as CoreObservationProcess,
  PlateDefinition,
  QueryEntity,
  RandomVariableEntity,
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
  importWarnings: string[];
  edgeSummary: {
    source: 'canvasEdges.json' | 'model extension' | 'semantic reconstruction';
    declared: number;
    projected: number;
  };
}

type PortablePackageFileMap = Record<string, unknown>;

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
  const normalized = normalizePortablePackageInput(packageData);
  const document = normalizeImportedModelDocument(parsePackageJsonFile<unknown>(normalized.files['model.json'], 'model.json'));
  const modelValidationIssues = validateImportModelDocument(document);

  if (modelValidationIssues.length) {
    throw new Error(`Portable package validation failed: ${modelValidationIssues.join(' / ')}`);
  }

  const importWarnings = [...normalized.warnings];
  const layout = normalized.files['layout.json'] === undefined
    ? synthesizeLayoutDocument(document)
    : normalizeImportedLayoutDocument(parsePackageJsonFile<unknown>(normalized.files['layout.json'], 'layout.json'), document);
  if (normalized.files['layout.json'] === undefined) {
    importWarnings.push('layout.json was missing, so a display layout was generated from model entity order.');
  }

  const validationIssues = validateImportLayoutDocument(layout, document);

  if (validationIssues.length) {
    throw new Error(`Portable package validation failed: ${validationIssues.join(' / ')}`);
  }

  const semantic = compileModel(document, compilerDistributionRegistry, {
    compilerVersion: '0.2.0',
  });
  const edgeResolution = resolveImportEdges(document, layout, semantic, normalized.files['canvasEdges.json']);
  const projected = projectToReactFlow({ document, layout }, { annotationEdges: edgeResolution.edges });
  return {
    document,
    layout,
    semantic,
    projected,
    summary: `${projected.nodes.length} nodes / ${projected.edges.length} links / ${semantic.diagnostics.length} diagnostics`,
    importWarnings: [...importWarnings, ...edgeResolution.warnings],
    edgeSummary: {
      source: edgeResolution.source,
      declared: edgeResolution.declared,
      projected: projected.edges.length,
    },
  };
}

export function isPortablePackageImportCandidate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (isRecord(value.files) || Array.isArray(value.files)) return true;
  if (isModelDocumentLike(value)) return true;
  return [
    'model.json',
    'layout.json',
    'canvasEdges.json',
    'modelDocument',
    'layoutDocument',
    'canvasEdges',
    'decisions',
  ].some((key) => key in value);
}

export function projectToReactFlow(
  snapshot: AuthoringSnapshot,
  options: { annotationEdges?: PortableCanvasEdge[] } = {},
): { nodes: Node<BayesNodeData>[]; edges: Edge[] } {
  const extension = snapshot.document.extensions?.['bayes-canvas'] as { annotationEdges?: PortableCanvasEdge[] } | undefined;
  const visibleEntityIds = new Set(projectableEntityIds(snapshot.document, snapshot.layout));
  return {
    nodes: [...visibleEntityIds]
      .filter((entityId) => snapshot.document.entities[entityId])
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
    edges: (options.annotationEdges ?? extension?.annotationEdges ?? [])
      .filter((edge) => visibleEntityIds.has(edge.from) && visibleEntityIds.has(edge.to))
      .map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        data: { role: edge.role },
      })),
  };
}

function resolveImportEdges(
  document: ModelDocument,
  layout: LayoutDocument,
  semantic: ReturnType<typeof compileModel>,
  canvasEdgesFile: unknown,
): {
  source: PortablePackageImportPreview['edgeSummary']['source'];
  declared: number;
  edges: PortableCanvasEdge[];
  warnings: string[];
} {
  if (canvasEdgesFile !== undefined) {
    const edges = parseCanvasEdgesJsonFile(canvasEdgesFile);
    validateCanvasEdges(edges, document, 'canvasEdges.json');
    if (!edges.length) {
      const reconstructed = reconstructSemanticEdges(document, layout, semantic);
      if (reconstructed.length) {
        return {
          source: 'semantic reconstruction',
          declared: 0,
          edges: reconstructed,
          warnings: [
            `canvasEdges.json declared 0 visual links, so ${reconstructed.length} links were reconstructed from semantic dependencies.`,
          ],
        };
      }
    }
    return { source: 'canvasEdges.json', declared: edges.length, edges, warnings: [] };
  }

  const extension = document.extensions?.['bayes-canvas'] as { annotationEdges?: PortableCanvasEdge[] } | undefined;
  if (extension?.annotationEdges) {
    validateCanvasEdges(extension.annotationEdges, document, 'model.json/extensions/bayes-canvas/annotationEdges');
    if (!extension.annotationEdges.length) {
      const reconstructed = reconstructSemanticEdges(document, layout, semantic);
      if (reconstructed.length) {
        return {
          source: 'semantic reconstruction',
          declared: 0,
          edges: reconstructed,
          warnings: [
            `bayes-canvas.annotationEdges declared 0 visual links, so ${reconstructed.length} links were reconstructed from semantic dependencies.`,
          ],
        };
      }
    }
    return {
      source: 'model extension',
      declared: extension.annotationEdges.length,
      edges: extension.annotationEdges,
      warnings: [],
    };
  }

  const edges = reconstructSemanticEdges(document, layout, semantic);
  return {
    source: 'semantic reconstruction',
    declared: 0,
    edges,
    warnings: [
      `canvasEdges.json and bayes-canvas.annotationEdges were missing, so ${edges.length} visual links were reconstructed from semantic dependencies.`,
    ],
  };
}

function reconstructSemanticEdges(
  document: ModelDocument,
  layout: LayoutDocument,
  semantic: ReturnType<typeof compileModel>,
): PortableCanvasEdge[] {
  const visibleEntityIds = new Set(projectableEntityIds(document, layout));
  return semantic.dependencyEdges
    .filter((edge) => visibleEntityIds.has(edge.from) && visibleEntityIds.has(edge.to))
    .map((edge) => ({
      id: `semantic-${edge.from}-${edge.to}`,
      from: edge.from,
      to: edge.to,
      role: `semantic-${edge.role}`,
    }));
}

function parseCanvasEdgesJsonFile(value: unknown): PortableCanvasEdge[] {
  const parsed = parseJsonLike(value, 'canvasEdges.json');
  const edgeValue = isRecord(parsed) && Array.isArray(parsed.edges) ? parsed.edges : parsed;
  if (!Array.isArray(edgeValue)) {
    throw new Error('canvasEdges.json must contain a JSON array.');
  }

  try {
    return edgeValue.map((edge, index) => {
      if (!isRecord(edge)) {
        throw new Error(`canvasEdges.json/${index}: Edge must be an object.`);
      }
      if (typeof edge.id !== 'string' || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
        throw new Error(`canvasEdges.json/${index}: Edge id, from, and to must be strings.`);
      }
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        role: typeof edge.role === 'string' && edge.role.trim() ? edge.role : 'dependency',
      };
    });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('canvasEdges.json is not valid JSON.');
  }
}

function validateCanvasEdges(edges: PortableCanvasEdge[], document: ModelDocument, scope: string): void {
  const ids = new Set<string>();
  const issues: string[] = [];
  edges.forEach((edge, index) => {
    if (ids.has(edge.id)) issues.push(`${scope}/${index}/id: Duplicate edge id "${edge.id}".`);
    ids.add(edge.id);
    if (!document.entities[edge.from]) issues.push(`${scope}/${index}/from: Unknown entity "${edge.from}".`);
    if (!document.entities[edge.to]) issues.push(`${scope}/${index}/to: Unknown entity "${edge.to}".`);
  });
  if (issues.length) {
    throw new Error(`Portable package validation failed: ${issues.join(' / ')}`);
  }
}

function projectableEntityIds(document: ModelDocument, layout: LayoutDocument): string[] {
  return document.entityOrder
    .filter((entityId) => document.entities[entityId])
    .filter((entityId) => document.entities[entityId].authorship !== 'generated')
    .filter((entityId) => !layout.hiddenEntityIds?.includes(entityId));
}

function normalizePortablePackageInput(packageData: unknown): { files: PortablePackageFileMap; warnings: string[] } {
  if (!isRecord(packageData)) {
    throw new Error('Portable package must be a JSON object.');
  }

  if (isModelDocumentLike(packageData)) {
    return {
      files: { 'model.json': packageData },
      warnings: ['Loaded a raw ModelDocument; layout and visual links will be derived for preview.'],
    };
  }

  const files = normalizePackageFiles(packageData.files);
  if (files) return { files, warnings: [] };

  const inferredFiles: PortablePackageFileMap = {};
  copyFirstDefined(inferredFiles, 'manifest.json', packageData, ['manifest.json', 'manifest']);
  copyFirstDefined(inferredFiles, 'model.json', packageData, ['model.json', 'modelDocument', 'document', 'model']);
  copyFirstDefined(inferredFiles, 'layout.json', packageData, ['layout.json', 'layoutDocument', 'layout']);
  copyFirstDefined(inferredFiles, 'canvasEdges.json', packageData, ['canvasEdges.json', 'canvasEdges', 'annotationEdges']);
  copyFirstDefined(inferredFiles, 'diagnostics.json', packageData, ['diagnostics.json', 'diagnostics']);
  copyFirstDefined(inferredFiles, 'handoff.json', packageData, ['handoff.json', 'handoff']);
  copyFirstDefined(inferredFiles, 'decisions.jsonl', packageData, ['decisions.jsonl', 'decisions']);

  if (!inferredFiles['model.json']) {
    throw new Error('Portable package is missing model.json.');
  }

  return {
    files: inferredFiles,
    warnings: ['Loaded a normalized AI package shape; files may have been provided as nested JSON instead of stringified file contents.'],
  };
}

function normalizeImportedModelDocument(value: unknown): ModelDocument {
  if (!isRecord(value)) throw new Error('model.json must contain a ModelDocument object.');
  const document = structuredClone(value) as Record<string, unknown>;
  const entities = isRecord(document.entities) ? document.entities : {};

  document.axes = normalizeImportedAxes(document.axes, document.plates);
  document.plates = normalizeImportedPlates(document.plates);
  document.entities = Object.fromEntries(
    Object.entries(entities).map(([entityId, entity]) => [entityId, normalizeImportedEntity(entityId, entity)]),
  );
  if (!Array.isArray(document.entityOrder)) document.entityOrder = Object.keys(entities);
  document.notes = normalizeImportedNotes(document.notes);
  if (!Array.isArray(document.noteOrder)) document.noteOrder = Object.keys(document.notes as Record<string, unknown>);

  return document as unknown as ModelDocument;
}

function normalizeImportedAxes(value: unknown, platesValue: unknown): ModelDocument['axes'] {
  if (!isRecord(value)) return {};
  const sizeByAxisId = inferAxisSizesFromPlates(platesValue);
  return Object.fromEntries(Object.entries(value).map(([axisId, axisValue]) => {
    const axis = isRecord(axisValue) ? axisValue : {};
    const id = firstNonEmptyString(axis.id, axisId);
    return [axisId, {
      id,
      symbol: firstNonEmptyString(axis.symbol, id.toUpperCase()),
      label: firstNonEmptyString(axis.label, axis.name, id),
      size: normalizeSourceText(axis.size, sizeByAxisId.get(id) ?? firstNonEmptyString(axis.sizeSymbol, id.toUpperCase())),
      coordinateDataId: typeof axis.coordinateDataId === 'string' ? axis.coordinateDataId : undefined,
      notes: firstOptionalString(axis.notes, axis.description),
    }];
  }));
}

function inferAxisSizesFromPlates(value: unknown): Map<string, string> {
  const sizes = new Map<string, string>();
  if (!isRecord(value)) return sizes;
  for (const [plateId, plateValue] of Object.entries(value)) {
    if (!isRecord(plateValue)) continue;
    const axisId = firstNonEmptyString(
      plateValue.axisId,
      Array.isArray(plateValue.axisIds) && typeof plateValue.axisIds[0] === 'string' ? plateValue.axisIds[0] : undefined,
      plateId,
    );
    const size = firstOptionalString(plateValue.sizeSymbol, plateValue.size, plateValue.symbol);
    if (size) sizes.set(axisId, size);
  }
  return sizes;
}

function normalizeImportedPlates(value: unknown): ModelDocument['plates'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([plateId, plateValue]) => {
    const plate = isRecord(plateValue) ? plateValue : {};
    const id = firstNonEmptyString(plate.id, plateId);
    const axisId = firstNonEmptyString(
      plate.axisId,
      Array.isArray(plate.axisIds) && typeof plate.axisIds[0] === 'string' ? plate.axisIds[0] : undefined,
      id,
    );
    return [plateId, {
      id,
      label: firstNonEmptyString(plate.label, plate.name, id),
      axisId,
      indexSymbol: firstNonEmptyString(plate.indexSymbol, plate.symbol, id.slice(0, 1).toLowerCase() || 'i'),
      parentPlateIds: Array.isArray(plate.parentPlateIds)
        ? plate.parentPlateIds.filter((parentId): parentId is string => typeof parentId === 'string')
        : [],
      assumption: isPlateAssumption(plate.assumption) ? plate.assumption : 'conditionally_independent',
      notes: firstOptionalString(plate.notes, plate.description),
    }];
  }));
}

function normalizeImportedEntity(entityId: string, value: unknown): ModelEntity {
  const entity = isRecord(value) ? value : {};
  const symbol = firstNonEmptyString(entity.symbol, entity.name, entityId);
  const plateIds = Array.isArray(entity.plateIds)
    ? entity.plateIds.filter((plateId): plateId is string => typeof plateId === 'string')
    : [];
  const common = {
    id: firstNonEmptyString(entity.id, entityId),
    symbol,
    label: firstOptionalString(entity.label, entity.name),
    valueType: normalizeValueType(entity.valueType, plateIds, entity.kind),
    plateIds,
    notes: firstOptionalString(entity.notes, entity.description),
    tags: Array.isArray(entity.tags) ? entity.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    authorship: isAuthorship(entity.authorship) ? entity.authorship : undefined,
  };

  if (entity.kind === 'data') {
    return {
      ...common,
      kind: 'data',
      dataRole: isDataRole(entity.dataRole) ? entity.dataRole : inferDataRole(symbol),
      unit: firstOptionalString(entity.unit),
      missingValuePolicy: firstOptionalString(entity.missingValuePolicy),
    };
  }

  if (entity.kind === 'deterministic') {
    return {
      ...common,
      kind: 'deterministic',
      expression: normalizeSourceText(entity.expression, symbol),
    };
  }

  if (entity.kind === 'factor') {
    return {
      ...common,
      kind: 'factor',
      logDensity: normalizeSourceText(entity.logDensity, '0'),
      normalization: isFactorNormalization(entity.normalization) ? entity.normalization : 'not_required',
    };
  }

  if (entity.kind === 'block_instance') {
    return {
      ...common,
      kind: 'block_instance',
      blockTypeId: firstNonEmptyString(entity.blockTypeId, symbol),
      blockVersion: firstNonEmptyString(entity.blockVersion, '1.0.0'),
      inputs: isRecord(entity.inputs) ? entity.inputs as BlockInstanceEntity['inputs'] : {},
      outputs: isRecord(entity.outputs) ? entity.outputs as BlockInstanceEntity['outputs'] : { value: common.id },
      config: isRecord(entity.config) ? entity.config : {},
    };
  }

  if (entity.kind === 'query') {
    return {
      ...common,
      kind: 'query',
      queryRole: isQueryRole(entity.queryRole) ? entity.queryRole : 'generated_quantity',
      expression: normalizeSourceText(entity.expression, symbol),
      scale: isQueryScale(entity.scale) ? entity.scale : undefined,
    };
  }

  return {
    ...common,
    kind: 'random_variable',
    role: isRandomVariableRole(entity.role) ? entity.role : 'parameter',
    distribution: normalizeDistributionCall(entity.distribution),
    observedDataId: typeof entity.observedDataId === 'string' ? entity.observedDataId : undefined,
    observationProcess: isCoreObservationProcess(entity.observationProcess) ? entity.observationProcess : undefined,
    constraints: Array.isArray(entity.constraints) ? entity.constraints as RandomVariableEntity['constraints'] : undefined,
    hints: Array.isArray(entity.hints) ? entity.hints as RandomVariableEntity['hints'] : undefined,
    priorRationale: firstOptionalString(entity.priorRationale),
  };
}

function normalizeValueType(value: unknown, plateIds: string[], kind: unknown): ValueType {
  if (isRecord(value)) {
    return {
      scalar: isScalarKind(value.scalar) ? value.scalar : inferScalarKind(undefined, kind),
      axes: Array.isArray(value.axes)
        ? value.axes.flatMap((axis): AxisUse[] => {
          if (!isRecord(axis) || typeof axis.axisId !== 'string') return [];
          return [{ axisId: axis.axisId, role: axis.role === 'event' ? 'event' : 'batch' }];
        })
        : plateIds.map((plateId) => ({ axisId: plateId, role: 'batch' as const })),
      domain: isDomain(value.domain) ? value.domain : inferDomainFromValueTypeName(undefined),
    };
  }

  const valueTypeName = typeof value === 'string' ? value : undefined;
  return {
    scalar: inferScalarKind(valueTypeName, kind),
    axes: plateIds.map((plateId) => ({ axisId: plateId, role: 'batch' as const })),
    domain: inferDomainFromValueTypeName(valueTypeName),
  };
}

function normalizeDistributionCall(value: unknown): RandomVariableEntity['distribution'] {
  const distribution = isRecord(value) ? value : {};
  const args = isRecord(distribution.args)
    ? Object.fromEntries(Object.entries(distribution.args).map(([key, argValue]) => [
      normalizeDistributionArgName(distribution.distributionId, key),
      normalizeSourceText(argValue, String(argValue ?? '')),
    ]))
    : {};
  return {
    distributionId: normalizeDistributionId(firstNonEmptyString(distribution.distributionId, distribution.id, distribution.name, 'normal')),
    parameterizationId: typeof distribution.parameterizationId === 'string' ? distribution.parameterizationId : undefined,
    args,
    truncation: isRecord(distribution.truncation)
      ? {
        lower: distribution.truncation.lower === undefined ? undefined : normalizeSourceText(distribution.truncation.lower, ''),
        upper: distribution.truncation.upper === undefined ? undefined : normalizeSourceText(distribution.truncation.upper, ''),
      }
      : undefined,
  };
}

function normalizeDistributionArgName(distributionId: unknown, argName: string): string {
  const normalizedDistributionId = normalizeDistributionId(typeof distributionId === 'string' ? distributionId : '');
  if (normalizedDistributionId === 'exponential' && argName === 'rate') return 'lam';
  return argName;
}

function normalizeImportedNotes(value: unknown): ModelDocument['notes'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([noteId, noteValue]) => {
    const note = isRecord(noteValue) ? noteValue : {};
    return [noteId, {
      id: firstNonEmptyString(note.id, noteId),
      kind: isNoteKind(note.kind) ? note.kind : 'implementation_note',
      text: firstNonEmptyString(note.text, note.title, noteId),
      status: isNoteStatus(note.status) ? note.status : note.status === 'closed' ? 'resolved' : 'open',
      relatedEntityIds: Array.isArray(note.relatedEntityIds)
        ? note.relatedEntityIds.filter((entityId): entityId is string => typeof entityId === 'string')
        : [],
      createdAt: typeof note.createdAt === 'string' ? note.createdAt : undefined,
      author: isNoteAuthor(note.author) ? note.author : undefined,
      blocking: typeof note.blocking === 'boolean' ? note.blocking : undefined,
    }];
  }));
}

function normalizeImportedLayoutDocument(value: unknown, document: ModelDocument): LayoutDocument {
  if (!isRecord(value)) throw new Error('layout.json must contain a LayoutDocument object.');
  const layout = structuredClone(value) as Record<string, unknown>;
  const rawNodes = isRecord(layout.nodes) ? layout.nodes : {};
  return {
    ...layout,
    schemaVersion: layout.schemaVersion === '1.0.0' ? '1.0.0' : '1.0.0',
    modelDocumentId: firstNonEmptyString(layout.modelDocumentId, document.documentId),
    revision: typeof layout.revision === 'number' ? layout.revision : document.revision,
    nodes: Object.fromEntries(Object.entries(rawNodes).flatMap(([nodeId, nodeValue]) => {
      if (!isRecord(nodeValue)) return [];
      return [[nodeId, {
        x: typeof nodeValue.x === 'number' ? nodeValue.x : 0,
        y: typeof nodeValue.y === 'number' ? nodeValue.y : 0,
        width: typeof nodeValue.width === 'number' ? nodeValue.width : undefined,
        height: typeof nodeValue.height === 'number' ? nodeValue.height : undefined,
        collapsed: typeof nodeValue.collapsed === 'boolean' ? nodeValue.collapsed : undefined,
        groupId: typeof nodeValue.groupId === 'string' ? nodeValue.groupId : undefined,
      }]];
    })),
    view: isRecord(layout.view)
      ? {
        x: typeof layout.view.x === 'number' ? layout.view.x : 0,
        y: typeof layout.view.y === 'number' ? layout.view.y : 0,
        zoom: typeof layout.view.zoom === 'number' ? layout.view.zoom : 1,
      }
      : { x: 0, y: 0, zoom: 1 },
    hiddenEntityIds: Array.isArray(layout.hiddenEntityIds)
      ? layout.hiddenEntityIds.filter((entityId): entityId is string => typeof entityId === 'string')
      : undefined,
  };
}

function normalizeSourceText(value: unknown, fallback: string): SourceText {
  if (isRecord(value) && typeof value.source === 'string') {
    return {
      language: value.language === SOURCE_LANGUAGE ? SOURCE_LANGUAGE : SOURCE_LANGUAGE,
      source: value.source,
    };
  }
  if (typeof value === 'string') return source(value);
  if (typeof value === 'number' || typeof value === 'boolean') return source(String(value));
  return source(fallback);
}

function inferScalarKind(valueTypeName: string | undefined, kind: unknown): ValueType['scalar'] {
  const normalized = valueTypeName?.toLowerCase() ?? '';
  if (normalized.includes('boolean')) return 'boolean';
  if (normalized.includes('integer') || normalized.includes('index')) return 'integer';
  if (normalized.includes('category')) return 'category';
  if (kind === 'data' && normalized.includes('mask')) return 'boolean';
  return 'real';
}

function inferDomainFromValueTypeName(valueTypeName: string | undefined): ValueType['domain'] | undefined {
  const normalized = valueTypeName?.toLowerCase() ?? '';
  if (normalized.includes('positive')) return { kind: 'positive' };
  if (normalized.includes('nonnegative')) return { kind: 'nonnegative' };
  if (normalized.includes('unit_interval')) return { kind: 'unit_interval' };
  if (normalized.includes('simplex')) return { kind: 'simplex', axisId: 'component' };
  if (normalized.includes('ordered')) return { kind: 'ordered', axisId: 'category' };
  if (normalized.includes('correlation')) return { kind: 'correlation_matrix', axisId: 'dimension' };
  return undefined;
}

function inferDataRole(symbol: string): DataEntity['dataRole'] {
  const normalized = symbol.toLowerCase();
  if (normalized.endsWith('_id') || normalized.includes('index')) return 'index';
  if (normalized.includes('mask')) return 'metadata';
  if (normalized === 'y' || normalized.includes('observed')) return 'observed_value';
  return 'predictor';
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'unnamed';
}

function firstOptionalString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function isScalarKind(value: unknown): value is ValueType['scalar'] {
  return value === 'real' || value === 'integer' || value === 'boolean' || value === 'category';
}

function isDomain(value: unknown): value is Domain {
  return isRecord(value) && typeof value.kind === 'string';
}

function isDataRole(value: unknown): value is DataEntity['dataRole'] {
  return value === 'observed_value'
    || value === 'predictor'
    || value === 'index'
    || value === 'constant'
    || value === 'coordinate'
    || value === 'metadata';
}

function isRandomVariableRole(value: unknown): value is RandomVariableEntity['role'] {
  return value === 'parameter' || value === 'latent' || value === 'observation';
}

function isFactorNormalization(value: unknown): value is FactorEntity['normalization'] {
  return value === 'known' || value === 'unknown' || value === 'not_required';
}

function isQueryRole(value: unknown): value is QueryEntity['queryRole'] {
  return value === 'quantity_of_interest'
    || value === 'prediction_target'
    || value === 'contrast'
    || value === 'generated_quantity';
}

function isQueryScale(value: unknown): value is NonNullable<QueryEntity['scale']> {
  return value === 'linear'
    || value === 'log'
    || value === 'logit'
    || value === 'probability'
    || value === 'custom';
}

function isPlateAssumption(value: unknown): value is PlateDefinition['assumption'] {
  return value === 'conditionally_independent' || value === 'exchangeable' || value === 'declared_only';
}

function isAuthorship(value: unknown): value is NonNullable<ModelEntity['authorship']> {
  return value === 'user' || value === 'generated' || value === 'imported';
}

function isNoteKind(value: unknown): value is ModelNote['kind'] {
  return value === 'assumption'
    || value === 'decision'
    || value === 'warning'
    || value === 'review_question'
    || value === 'implementation_note';
}

function isNoteStatus(value: unknown): value is ModelNote['status'] {
  return value === 'open' || value === 'accepted' || value === 'rejected' || value === 'resolved';
}

function isNoteAuthor(value: unknown): value is NonNullable<ModelNote['author']> {
  return value === 'user' || value === 'ai' || value === 'import';
}

function isCoreObservationProcess(value: unknown): value is CoreObservationProcess {
  return isRecord(value) && typeof value.kind === 'string';
}

function normalizePackageFiles(value: unknown): PortablePackageFileMap | undefined {
  if (isRecord(value)) return value;
  if (!Array.isArray(value)) return undefined;

  const files: PortablePackageFileMap = {};
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const path = firstString(entry, ['path', 'name', 'file', 'filename']);
    if (!path) continue;
    files[normalizePackagePath(path)] = 'content' in entry
      ? entry.content
      : 'contents' in entry
        ? entry.contents
        : 'text' in entry
          ? entry.text
          : entry.data;
  }
  return Object.keys(files).length ? files : undefined;
}

function copyFirstDefined(
  target: PortablePackageFileMap,
  targetName: string,
  sourceObject: Record<string, unknown>,
  candidateNames: string[],
): void {
  for (const name of candidateNames) {
    if (sourceObject[name] !== undefined) {
      target[targetName] = sourceObject[name];
      return;
    }
  }
}

function parsePackageJsonFile<T>(value: unknown, fileName: string): T {
  if (value === undefined) {
    throw new Error(`Portable package is missing ${fileName}.`);
  }
  return parseJsonLike(value, fileName) as T;
}

function parseJsonLike(value: unknown, fileName: string): unknown {
  const unwrapped = unwrapPackageFileValue(value);
  if (typeof unwrapped === 'string') {
    try {
      return JSON.parse(extractJsonPayload(unwrapped)) as unknown;
    } catch {
      throw new Error(`${fileName} is not valid JSON.`);
    }
  }
  if (isRecord(unwrapped) || Array.isArray(unwrapped)) return unwrapped;
  throw new Error(`Portable package ${fileName} must be JSON text or a JSON value.`);
}

function unwrapPackageFileValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  for (const key of ['content', 'contents', 'text', 'data', 'json']) {
    if (value[key] !== undefined) return value[key];
  }
  return value;
}

function extractJsonPayload(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  if (fenced) return fenced[1].trim();

  const firstObject = trimmed.indexOf('{');
  const firstArray = trimmed.indexOf('[');
  const first = [firstObject, firstArray].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return trimmed;
  const opener = trimmed[first];
  const closer = opener === '{' ? '}' : ']';
  const last = trimmed.lastIndexOf(closer);
  return last > first ? trimmed.slice(first, last + 1).trim() : trimmed;
}

function validateImportModelDocument(document: ModelDocument): string[] {
  const validationIssues = [
    ...validateModelDocumentEnvelope(document).map((issue) => prefixValidationIssue('model.json', issue)),
  ];

  if (document.schemaVersion !== '1.0.0') {
    validationIssues.push('model.json/schemaVersion: Unsupported schemaVersion.');
  }
  if (typeof document.documentId !== 'string' || !document.documentId.trim()) {
    validationIssues.push('model.json/documentId: ModelDocument must include documentId.');
  }
  if (typeof document.revision !== 'number') {
    validationIssues.push('model.json/revision: ModelDocument must include numeric revision.');
  }
  if (!isRecord(document.model)) {
    validationIssues.push('model.json/model: ModelDocument must include model metadata.');
  }
  if (!isRecord(document.axes) || !isRecord(document.plates) || !isRecord(document.entities)) {
    validationIssues.push('model.json/entities: ModelDocument must include axes, plates, and entities.');
  }
  if (!Array.isArray(document.entityOrder)) {
    validationIssues.push('model.json/entityOrder: ModelDocument must include entityOrder.');
  }
  if (!isRecord(document.notes) || !Array.isArray(document.noteOrder)) {
    validationIssues.push('model.json/notes: ModelDocument must include notes and noteOrder.');
  }
  return validationIssues;
}

function validateImportLayoutDocument(layout: LayoutDocument, document: ModelDocument): string[] {
  const validationIssues = [
    ...validateLayoutDocumentEnvelope(layout).map((issue) => prefixValidationIssue('layout.json', issue)),
  ];

  if (layout.schemaVersion !== '1.0.0') {
    validationIssues.push('layout.json/schemaVersion: Unsupported schemaVersion.');
  }
  if (layout.modelDocumentId !== document.documentId) {
    validationIssues.push('layout.json/modelDocumentId: Layout does not match model documentId.');
  }
  if (!isRecord(layout.nodes) || !isRecord(layout.view)) {
    validationIssues.push('layout.json/nodes: LayoutDocument must include nodes and view.');
  }
  return validationIssues;
}

function synthesizeLayoutDocument(document: ModelDocument): LayoutDocument {
  const visibleEntityIds = document.entityOrder
    .filter((entityId) => document.entities[entityId])
    .filter((entityId) => document.entities[entityId].authorship !== 'generated');
  const rowByColumn = new Map<number, number>();
  const nodes: LayoutDocument['nodes'] = {};

  for (const entityId of visibleEntityIds) {
    const entity = document.entities[entityId];
    const column = layoutColumnForEntity(entity);
    const row = rowByColumn.get(column) ?? 0;
    nodes[entityId] = {
      x: 80 + column * 280,
      y: 90 + row * 150,
    };
    rowByColumn.set(column, row + 1);
  }

  return {
    schemaVersion: '1.0.0',
    modelDocumentId: document.documentId,
    revision: document.revision,
    nodes,
    view: { x: 0, y: 0, zoom: 1 },
    hiddenEntityIds: Object.values(document.entities)
      .filter((entity) => entity.authorship === 'generated')
      .map((entity) => entity.id),
  };
}

function layoutColumnForEntity(entity: ModelEntity): number {
  if (entity.kind === 'data') return 0;
  if (entity.kind === 'random_variable') {
    if (entity.role === 'observation') return 3;
    return 1;
  }
  if (entity.kind === 'query') return 4;
  return 2;
}

function isModelDocumentLike(value: Record<string, unknown>): boolean {
  return value.schemaVersion === '1.0.0'
    && typeof value.documentId === 'string'
    && isRecord(value.model)
    && isRecord(value.entities)
    && Array.isArray(value.entityOrder);
}

function firstString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === 'string') return value[key];
  }
  return undefined;
}

function normalizePackagePath(path: string): string {
  const normalized = path.replace(/\\/gu, '/').replace(/^\.?\//u, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
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
  if (entity.kind === 'factor') {
    const likelihood = inferLikelihoodFromLogDensity(entity.logDensity.source);
    if (likelihood) {
      return {
        ...base,
        kind: 'likelihood',
        observed: true,
        distribution: likelihood.distribution,
        expression: entity.logDensity.source,
        notes: joinNotes(entity.notes, `Imported from factor logDensity: ${entity.logDensity.source}`),
      };
    }
    return { ...base, kind: 'model_block', expression: entity.logDensity.source, validationLevel: 'structured' };
  }
  const kind = entity.role === 'observation'
    ? 'likelihood'
    : entity.role === 'latent'
      ? 'latent'
      : entity.tags?.includes('hyperparameter')
        ? 'hyperparameter'
        : 'parameter';
  return {
    ...base,
    kind,
    observed: entity.role === 'observation',
    distribution: {
      id: entity.distribution.distributionId,
      name: entity.distribution.distributionId,
      args: Object.fromEntries(Object.entries(entity.distribution.args).map(([key, value]) => [key, value.source])),
    },
  };
}

function inferLikelihoodFromLogDensity(logDensity: string): { distribution: DistributionSpec; observedSymbol: string } | undefined {
  const match = /^([A-Za-z][A-Za-z0-9_]*)_lpdf\s*\(([\s\S]*)\)$/u.exec(logDensity.trim());
  if (!match) return undefined;

  const distributionId = normalizeDistributionId(match[1]);
  const definition = DISTRIBUTIONS.find((distribution) => normalizeDistributionId(distribution.id) === distributionId);
  if (!definition) return undefined;

  const [observedSymbol, ...parameterExpressions] = splitLogDensityArguments(match[2]);
  if (!observedSymbol || !parameterExpressions.length) return undefined;

  const args = Object.fromEntries(definition.params
    .filter((param) => param.required)
    .map((param, index) => [param.name, parameterExpressions[index] ?? param.defaultExpression ?? '']));

  return {
    observedSymbol,
    distribution: {
      id: definition.id,
      name: definition.name,
      args,
    },
  };
}

function splitLogDensityArguments(sourceText: string): string[] {
  const normalized = sourceText.replace('|', ',');
  const args: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      args.push(normalized.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(normalized.slice(start).trim());
  return args.filter(Boolean);
}

function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const output = notes.filter((note): note is string => Boolean(note?.trim()));
  return output.length ? output.join('\n') : undefined;
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
