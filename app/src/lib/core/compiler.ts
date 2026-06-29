import {
  builtInBlockRegistry,
} from './block-registry.js';
import type {
  BlockDefinition,
  BlockRegistry,
} from './block-sdk.js';
import {
  collectReferenceOccurrences,
  parseExpression,
} from './expression.js';
import type {
  ExprNode,
  ReferenceOccurrence,
} from './expression.js';
import { diagnostic, summarizeDiagnostics, type Diagnostic } from './diagnostics.js';
import type {
  AxisId,
  DistributionDefinition,
  DistributionRegistry,
  EntityId,
  ModelDocument,
  ModelEntity,
  RandomVariableEntity,
  SourceText,
} from './model.js';

export interface CompiledExpression {
  path: string;
  ownerEntityId?: EntityId;
  source: SourceText;
  ast: ExprNode;
  references: ReferenceOccurrence[];
}

export interface SemanticEntity {
  id: EntityId;
  symbol: string;
  kind: ModelEntity['kind'];
  dependencies: EntityId[];
}

export interface SemanticModel {
  sourceDocumentId: string;
  sourceRevision: number;
  compilerVersion: string;
  symbols: Record<string, EntityId>;
  indexSymbols: Record<string, string>;
  expressions: Record<string, CompiledExpression>;
  entities: Record<EntityId, SemanticEntity>;
  dependencyEdges: Array<{ from: EntityId; to: EntityId; role: 'expression' | 'distribution' }>;
  diagnostics: Diagnostic[];
  readiness: {
    handoff: 'ready' | 'blocked';
    summary: ReturnType<typeof summarizeDiagnostics>;
  };
}

export interface CompileOptions {
  compilerVersion?: string;
  builtInConstants?: readonly string[];
  builtInFunctions?: readonly string[];
  blockRegistry?: BlockRegistry;
  targetBackend?: string;
}

interface ExpressionEntry {
  path: string;
  source: SourceText;
  ownerEntityId?: EntityId;
  role: 'expression' | 'distribution';
}

const DEFAULT_CONSTANTS = ['pi', 'e'] as const;
const DEFAULT_FUNCTIONS = [
  'abs',
  'dot',
  'exp',
  'inv_logit',
  'log',
  'log1p',
  'logit',
  'max',
  'min',
  'pow',
  'softmax',
  'sqrt',
  'sum',
] as const;

export function compileModel(
  document: ModelDocument,
  distributions: DistributionRegistry,
  options: CompileOptions = {},
): SemanticModel {
  const diagnostics: Diagnostic[] = [];
  const compilerVersion = options.compilerVersion ?? '0.1.0';
  const constants = new Set(options.builtInConstants ?? DEFAULT_CONSTANTS);
  const functions = new Set(options.builtInFunctions ?? DEFAULT_FUNCTIONS);
  const blockRegistry = options.blockRegistry ?? builtInBlockRegistry;

  diagnostics.push(...lintDocumentEnvelope(document));
  diagnostics.push(...lintBlockInstances(document, blockRegistry, options.targetBackend));
  diagnostics.push(...lintAxesAndPlates(document));
  diagnostics.push(...lintEntityOrder(document));

  const symbols: Record<string, EntityId> = {};
  const symbolPaths = new Map<string, string>();

  for (const [entityId, entity] of Object.entries(document.entities)) {
    const path = `/entities/${escapePointer(entityId)}/symbol`;
    if (!isIdentifier(entity.symbol)) {
      diagnostics.push(diagnostic({
        code: 'BC-SYMBOL-001',
        stage: 'binding',
        severity: 'error',
        message: `"${entity.symbol}" is not a valid symbol.`,
        path,
        blocksHandoff: true,
      }));
    }

    const existing = symbols[entity.symbol];
    if (existing) {
      diagnostics.push(diagnostic({
        code: 'BC-SYMBOL-002',
        stage: 'binding',
        severity: 'error',
        message: `Duplicate symbol "${entity.symbol}".`,
        path,
        related: [{ message: 'First declaration.', path: symbolPaths.get(entity.symbol)! }],
        blocksHandoff: true,
      }));
    } else {
      symbols[entity.symbol] = entityId;
      symbolPaths.set(entity.symbol, path);
    }
  }

  const indexSymbols: Record<string, string> = {};
  for (const [plateId, plate] of Object.entries(document.plates)) {
    const path = `/plates/${escapePointer(plateId)}/indexSymbol`;
    if (!isIdentifier(plate.indexSymbol)) {
      diagnostics.push(diagnostic({
        code: 'BC-PLATE-001',
        stage: 'binding',
        severity: 'error',
        message: `"${plate.indexSymbol}" is not a valid plate index symbol.`,
        path,
        blocksHandoff: true,
      }));
      continue;
    }
    if (indexSymbols[plate.indexSymbol] || symbols[plate.indexSymbol]) {
      diagnostics.push(diagnostic({
        code: 'BC-PLATE-002',
        stage: 'binding',
        severity: 'error',
        message: `Index symbol "${plate.indexSymbol}" collides with another declaration.`,
        path,
        blocksHandoff: true,
      }));
    } else {
      indexSymbols[plate.indexSymbol] = plateId;
    }
  }

  const dimensionSymbols = new Set(
    Object.values(document.axes).flatMap((axis) => [
      axis.id,
      axis.symbol,
      axis.size.source,
    ]).filter(isIdentifier),
  );

  for (const functionName of functions) {
    if (symbols[functionName] || indexSymbols[functionName]) {
      diagnostics.push(diagnostic({
        code: 'BC-SYMBOL-003',
        stage: 'binding',
        severity: 'warning',
        message: `"${functionName}" shadows a built-in function name.`,
        path: symbols[functionName]
          ? `/entities/${escapePointer(symbols[functionName]!)}/symbol`
          : `/plates/${escapePointer(indexSymbols[functionName]!)}/indexSymbol`,
        blocksHandoff: false,
      }));
    }
  }

  const expressions: Record<string, CompiledExpression> = {};
  const dependenciesByOwner = new Map<EntityId, Set<EntityId>>();
  const edgeRoleByPair = new Map<string, 'expression' | 'distribution'>();

  for (const entry of collectExpressionEntries(document)) {
    const result = parseExpression(entry.source);
    if (!result.ok) {
      diagnostics.push(diagnostic({
        code: 'BC-EXPR-001',
        stage: 'syntax',
        severity: 'error',
        message: result.error.message,
        path: entry.path,
        range: result.error.span,
        blocksHandoff: true,
      }));
      continue;
    }

    const references = collectReferenceOccurrences(result.ast);
    expressions[entry.path] = {
      path: entry.path,
      ...(entry.ownerEntityId ? { ownerEntityId: entry.ownerEntityId } : {}),
      source: entry.source,
      ast: result.ast,
      references,
    };

    for (const reference of references) {
      const referencedEntityId = symbols[reference.symbol];
      if (referencedEntityId) {
        if (entry.ownerEntityId) {
          const dependencies = dependenciesByOwner.get(entry.ownerEntityId) ?? new Set<EntityId>();
          dependencies.add(referencedEntityId);
          dependenciesByOwner.set(entry.ownerEntityId, dependencies);
          edgeRoleByPair.set(`${referencedEntityId}\u0000${entry.ownerEntityId}`, entry.role);
        }
        continue;
      }

      if (
        indexSymbols[reference.symbol]
        || constants.has(reference.symbol)
        || dimensionSymbols.has(reference.symbol)
      ) continue;

      const suggestion = nearestSymbol(reference.symbol, [
        ...Object.keys(symbols),
        ...Object.keys(indexSymbols),
        ...dimensionSymbols,
        ...constants,
      ]);
      diagnostics.push(diagnostic({
        code: 'BC-SYMBOL-004',
        stage: 'binding',
        severity: 'error',
        message: `Unknown symbol "${reference.symbol}".`,
        path: entry.path,
        range: reference.span,
        blocksHandoff: true,
        ...(suggestion && entry.ownerEntityId
          ? {
              fixes: [{
                id: `replace-${reference.symbol}-with-${suggestion}`,
                title: `Replace with ${suggestion}`,
                kind: 'quickfix' as const,
                expectedRevision: document.revision,
                // A production compiler would emit a range-aware patch or refactor command here.
                patch: [],
              }],
            }
          : {}),
      }));
    }
  }

  diagnostics.push(...lintEntities(document, distributions));
  diagnostics.push(...lintObservationBindings(document));
  diagnostics.push(...lintDeterministicCycles(document, dependenciesByOwner));
  diagnostics.push(...lintUnusedUnknowns(document, dependenciesByOwner));
  diagnostics.push(...lintOpenQuestions(document));

  const semanticEntities: Record<EntityId, SemanticEntity> = {};
  for (const [entityId, entity] of Object.entries(document.entities)) {
    semanticEntities[entityId] = {
      id: entityId,
      symbol: entity.symbol,
      kind: entity.kind,
      dependencies: [...(dependenciesByOwner.get(entityId) ?? [])],
    };
  }

  const dependencyEdges = [...edgeRoleByPair.entries()].map(([pair, role]) => {
    const [from, to] = pair.split('\u0000') as [EntityId, EntityId];
    return { from, to, role };
  });

  const summary = summarizeDiagnostics(diagnostics);
  return {
    sourceDocumentId: document.documentId,
    sourceRevision: document.revision,
    compilerVersion,
    symbols,
    indexSymbols,
    expressions,
    entities: semanticEntities,
    dependencyEdges,
    diagnostics,
    readiness: {
      handoff: summary.handoffBlocked ? 'blocked' : 'ready',
      summary,
    },
  };
}

function lintBlockInstances(
  document: ModelDocument,
  blockRegistry: BlockRegistry,
  targetBackend = 'review',
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const entity of Object.values(document.entities)) {
    if (entity.kind !== 'block_instance') continue;
    const basePath = `/entities/${escapePointer(entity.id)}`;
    const definition = blockRegistry.get(entity.blockTypeId, entity.blockVersion);
    if (!definition) {
      diagnostics.push(diagnostic({
        code: 'BC-BLOCK-UNKNOWN',
        stage: 'portability',
        severity: 'info',
        message: `Unknown block ${entity.blockTypeId}@${entity.blockVersion}.`,
        path: `${basePath}/blockTypeId`,
        blocksHandoff: false,
      }));
      continue;
    }
    diagnostics.push(...lintBlockPorts(document, entity.id, entity, definition, basePath));
    diagnostics.push(...lintBlockConfig(entity, definition, basePath));
    diagnostics.push(...lintBlockBackend(entity, definition, targetBackend, basePath));
    diagnostics.push(...(definition.validateBoundary?.(entity.config) ?? []));
  }
  return diagnostics;
}

function lintBlockPorts(
  document: ModelDocument,
  entityId: EntityId,
  entity: Extract<ModelEntity, { kind: 'block_instance' }>,
  definition: BlockDefinition,
  basePath: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ports = new Map(definition.ports.map((port) => [port.id, port]));
  for (const port of definition.ports) {
    if (!port.required) continue;
    const collection = port.direction === 'input' ? entity.inputs : entity.outputs;
    if (!(port.id in collection)) {
      diagnostics.push(diagnostic({
        code: 'BC-BLOCK-MISSING-PORT',
        stage: 'portability',
        severity: 'error',
        message: `${entity.symbol} is missing required ${port.direction} port ${port.id}.`,
        path: `${basePath}/${port.direction === 'input' ? 'inputs' : 'outputs'}/${escapePointer(port.id)}`,
        blocksHandoff: true,
      }));
    }
  }
  for (const [portId, binding] of Object.entries(entity.inputs)) {
    if (!ports.has(portId)) {
      diagnostics.push(diagnostic({
        code: 'BC-BLOCK-UNKNOWN-PORT',
        stage: 'portability',
        severity: 'warning',
        message: `${entity.symbol} has unknown input port ${portId}.`,
        path: `${basePath}/inputs/${escapePointer(portId)}`,
        blocksHandoff: false,
      }));
    }
    if (binding.entityId && !document.entities[binding.entityId]) {
      diagnostics.push(diagnostic({
        code: 'BC-BLOCK-MISSING-ENTITY',
        stage: 'portability',
        severity: 'error',
        message: `${entity.symbol} input ${portId} references a missing entity.`,
        path: `${basePath}/inputs/${escapePointer(portId)}/entityId`,
        blocksHandoff: true,
      }));
    }
  }
  for (const [portId, outputEntityId] of Object.entries(entity.outputs)) {
    if (!ports.has(portId)) {
      diagnostics.push(diagnostic({
        code: 'BC-BLOCK-UNKNOWN-PORT',
        stage: 'portability',
        severity: 'warning',
        message: `${entity.symbol} has unknown output port ${portId}.`,
        path: `${basePath}/outputs/${escapePointer(portId)}`,
        blocksHandoff: false,
      }));
    }
    if (!document.entities[outputEntityId]) {
      diagnostics.push(diagnostic({
        code: 'BC-BLOCK-MISSING-ENTITY',
        stage: 'portability',
        severity: 'error',
        message: `${entity.symbol} output ${portId} references a missing entity.`,
        path: `${basePath}/outputs/${escapePointer(portId)}`,
        blocksHandoff: true,
      }));
    }
  }
  return diagnostics;
}

function lintBlockConfig(
  entity: Extract<ModelEntity, { kind: 'block_instance' }>,
  definition: BlockDefinition,
  basePath: string,
): Diagnostic[] {
  const schemaProperties = definition.configSchema.properties;
  if (!schemaProperties || typeof schemaProperties !== 'object') return [];
  const allowed = new Set(Object.keys(schemaProperties));
  return Object.keys(entity.config)
    .filter((key) => !allowed.has(key))
    .map((key) => diagnostic({
      code: 'BC-BLOCK-UNKNOWN-CONFIG',
      stage: 'portability',
      severity: 'warning',
      message: `${entity.symbol} has unknown block config ${key}.`,
      path: `${basePath}/config/${escapePointer(key)}`,
      blocksHandoff: false,
    }));
}

function lintBlockBackend(
  entity: Extract<ModelEntity, { kind: 'block_instance' }>,
  definition: BlockDefinition,
  targetBackend: string,
  basePath: string,
): Diagnostic[] {
  const support = definition.backendCapabilities?.[targetBackend] ?? 'unknown';
  if (support !== 'unsupported' && support !== 'unknown') return [];
  return [diagnostic({
    code: 'BC-BLOCK-BACKEND-CAPABILITY',
    stage: 'portability',
    severity: support === 'unsupported' ? 'error' : 'warning',
    message: `${entity.symbol} block support for ${targetBackend} is ${support}.`,
    path: `${basePath}/blockTypeId`,
    blocksHandoff: support === 'unsupported',
  })];
}

function lintDocumentEnvelope(document: ModelDocument): Diagnostic[] {
  const output: Diagnostic[] = [];
  if (document.schemaVersion !== '1.0.0') {
    output.push(diagnostic({
      code: 'BC-SCHEMA-001',
      stage: 'schema',
      severity: 'error',
      message: `Unsupported schema version "${String(document.schemaVersion)}".`,
      path: '/schemaVersion',
      blocksHandoff: true,
    }));
  }
  if (!document.model.name.trim()) {
    output.push(diagnostic({
      code: 'BC-MODEL-001',
      stage: 'schema',
      severity: 'error',
      message: 'Model name is required.',
      path: '/model/name',
      blocksHandoff: true,
    }));
  }
  return output;
}

function lintAxesAndPlates(document: ModelDocument): Diagnostic[] {
  const output: Diagnostic[] = [];

  for (const [axisId, axis] of Object.entries(document.axes)) {
    if (axis.id !== axisId) {
      output.push(diagnostic({
        code: 'BC-AXIS-001',
        stage: 'schema',
        severity: 'error',
        message: `Axis key "${axisId}" does not match axis.id "${axis.id}".`,
        path: `/axes/${escapePointer(axisId)}/id`,
        blocksHandoff: true,
      }));
    }
  }

  for (const [plateId, plate] of Object.entries(document.plates)) {
    if (!document.axes[plate.axisId]) {
      output.push(diagnostic({
        code: 'BC-PLATE-003',
        stage: 'shape',
        severity: 'error',
        message: `Plate "${plate.label}" refers to missing axis "${plate.axisId}".`,
        path: `/plates/${escapePointer(plateId)}/axisId`,
        blocksHandoff: true,
      }));
    }
    for (const parentId of plate.parentPlateIds) {
      if (!document.plates[parentId]) {
        output.push(diagnostic({
          code: 'BC-PLATE-004',
          stage: 'shape',
          severity: 'error',
          message: `Plate "${plate.label}" refers to missing parent plate "${parentId}".`,
          path: `/plates/${escapePointer(plateId)}/parentPlateIds`,
          blocksHandoff: true,
        }));
      }
    }
  }

  const plateCycles = findCycles(
    Object.keys(document.plates),
    (plateId) => document.plates[plateId]?.parentPlateIds ?? [],
  );
  for (const cycle of plateCycles) {
    output.push(diagnostic({
      code: 'BC-PLATE-005',
      stage: 'shape',
      severity: 'error',
      message: `Plate nesting cycle: ${cycle.join(' -> ')}.`,
      path: `/plates/${escapePointer(cycle[0]!)}/parentPlateIds`,
      blocksHandoff: true,
    }));
  }

  return output;
}

function lintEntityOrder(document: ModelDocument): Diagnostic[] {
  const output: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const [index, entityId] of document.entityOrder.entries()) {
    if (!document.entities[entityId]) {
      output.push(diagnostic({
        code: 'BC-ORDER-001',
        stage: 'schema',
        severity: 'warning',
        message: `Entity order contains missing entity "${entityId}".`,
        path: `/entityOrder/${index}`,
        blocksHandoff: false,
      }));
    }
    if (seen.has(entityId)) {
      output.push(diagnostic({
        code: 'BC-ORDER-002',
        stage: 'schema',
        severity: 'warning',
        message: `Entity "${entityId}" appears more than once in entityOrder.`,
        path: `/entityOrder/${index}`,
        blocksHandoff: false,
      }));
    }
    seen.add(entityId);
  }
  return output;
}

function lintEntities(document: ModelDocument, distributions: DistributionRegistry): Diagnostic[] {
  const output: Diagnostic[] = [];

  for (const [entityId, entity] of Object.entries(document.entities)) {
    const basePath = `/entities/${escapePointer(entityId)}`;
    const axisIds = entity.valueType.axes.map((axis) => axis.axisId);
    const duplicateAxisIds = duplicates(axisIds);

    for (const [axisIndex, axisUse] of entity.valueType.axes.entries()) {
      if (!document.axes[axisUse.axisId]) {
        output.push(diagnostic({
          code: 'BC-SHAPE-001',
          stage: 'shape',
          severity: 'error',
          message: `Unknown axis "${axisUse.axisId}".`,
          path: `${basePath}/valueType/axes/${axisIndex}/axisId`,
          blocksHandoff: true,
        }));
      }
    }

    for (const duplicateAxisId of duplicateAxisIds) {
      output.push(diagnostic({
        code: 'BC-SHAPE-002',
        stage: 'shape',
        severity: 'error',
        message: `Axis "${duplicateAxisId}" is repeated in the same value shape.`,
        path: `${basePath}/valueType/axes`,
        blocksHandoff: true,
      }));
    }

    for (const [plateIndex, plateId] of entity.plateIds.entries()) {
      const plate = document.plates[plateId];
      if (!plate) {
        output.push(diagnostic({
          code: 'BC-PLATE-006',
          stage: 'shape',
          severity: 'error',
          message: `Unknown plate "${plateId}".`,
          path: `${basePath}/plateIds/${plateIndex}`,
          blocksHandoff: true,
        }));
        continue;
      }
      const matchingAxis = entity.valueType.axes.find((axis) => axis.axisId === plate.axisId);
      if (!matchingAxis) {
        output.push(diagnostic({
          code: 'BC-PLATE-007',
          stage: 'shape',
          severity: 'warning',
          message: `Entity is in plate "${plate.label}" but does not declare its axis "${plate.axisId}".`,
          path: `${basePath}/plateIds/${plateIndex}`,
          blocksHandoff: false,
        }));
      } else if (matchingAxis.role !== 'batch') {
        output.push(diagnostic({
          code: 'BC-PLATE-008',
          stage: 'shape',
          severity: 'error',
          message: `Plate axis "${plate.axisId}" must be a batch axis, not an event axis.`,
          path: `${basePath}/valueType/axes`,
          blocksHandoff: true,
        }));
      }
    }

    if (entity.kind === 'random_variable') {
      output.push(...lintRandomVariable(entityId, entity, document, distributions));
    }
  }

  return output;
}

function lintRandomVariable(
  entityId: EntityId,
  entity: RandomVariableEntity,
  document: ModelDocument,
  distributions: DistributionRegistry,
): Diagnostic[] {
  const output: Diagnostic[] = [];
  const basePath = `/entities/${escapePointer(entityId)}`;
  const definition = distributions.get(entity.distribution.distributionId);

  if (!definition) {
    output.push(diagnostic({
      code: 'BC-DIST-001',
      stage: 'binding',
      severity: 'error',
      message: `Unknown distribution "${entity.distribution.distributionId}".`,
      path: `${basePath}/distribution/distributionId`,
      blocksHandoff: true,
    }));
    return output;
  }

  if (definition.deprecated) {
    output.push(diagnostic({
      code: 'BC-DIST-002',
      stage: 'portability',
      severity: 'warning',
      message: `Distribution "${definition.label}" is deprecated in the registry.`,
      path: `${basePath}/distribution/distributionId`,
      blocksHandoff: false,
    }));
  }

  for (const requiredArg of definition.requiredArgs) {
    if (!entity.distribution.args[requiredArg]?.source.trim()) {
      output.push(diagnostic({
        code: 'BC-DIST-003',
        stage: 'schema',
        severity: 'error',
        message: `${definition.label}.${requiredArg} is required.`,
        path: `${basePath}/distribution/args/${escapePointer(requiredArg)}`,
        blocksHandoff: true,
      }));
    }
  }

  const allowedArgs = new Set([...definition.requiredArgs, ...(definition.optionalArgs ?? [])]);
  for (const argName of Object.keys(entity.distribution.args)) {
    if (!allowedArgs.has(argName)) {
      output.push(diagnostic({
        code: 'BC-DIST-004',
        stage: 'schema',
        severity: 'warning',
        message: `Unknown argument "${argName}" for ${definition.label}.`,
        path: `${basePath}/distribution/args/${escapePointer(argName)}`,
        blocksHandoff: false,
      }));
    }
  }

  const declaredDomain = entity.valueType.domain;
  if (declaredDomain && !domainsCompatible(declaredDomain, definition)) {
    output.push(diagnostic({
      code: 'BC-SUPPORT-001',
      stage: 'support',
      severity: 'warning',
      certainty: 'likely',
      message: `Declared domain "${declaredDomain.kind}" may conflict with ${definition.label} support "${definition.support.kind}".`,
      path: `${basePath}/valueType/domain`,
      related: [{ message: 'Distribution support.', path: `${basePath}/distribution/distributionId` }],
      blocksHandoff: false,
    }));
  }

  if (definition.eventRank !== undefined) {
    const actualEventRank = entity.valueType.axes.filter((axis) => axis.role === 'event').length;
    if (actualEventRank !== definition.eventRank) {
      output.push(diagnostic({
        code: 'BC-SHAPE-003',
        stage: 'shape',
        severity: 'error',
        message: `${definition.label} expects event rank ${definition.eventRank}, but the entity declares ${actualEventRank}.`,
        path: `${basePath}/valueType/axes`,
        blocksHandoff: true,
      }));
    }
  }

  if (entity.role === 'observation' && !entity.observedDataId) {
    output.push(diagnostic({
      code: 'BC-OBS-001',
      stage: 'schema',
      severity: 'error',
      message: 'An observation random variable must bind to a data entity.',
      path: `${basePath}/observedDataId`,
      blocksHandoff: true,
    }));
  }

  if (entity.role !== 'observation' && entity.observedDataId) {
    output.push(diagnostic({
      code: 'BC-OBS-002',
      stage: 'schema',
      severity: 'warning',
      message: `A ${entity.role} random variable should not bind observed data.`,
      path: `${basePath}/observedDataId`,
      blocksHandoff: false,
    }));
  }

  return output;
}

function lintObservationBindings(document: ModelDocument): Diagnostic[] {
  const output: Diagnostic[] = [];
  for (const [entityId, entity] of Object.entries(document.entities)) {
    if (entity.kind !== 'random_variable' || !entity.observedDataId) continue;
    const data = document.entities[entity.observedDataId];
    const path = `/entities/${escapePointer(entityId)}/observedDataId`;
    if (!data) {
      output.push(diagnostic({
        code: 'BC-OBS-003',
        stage: 'binding',
        severity: 'error',
        message: `Observed data entity "${entity.observedDataId}" does not exist.`,
        path,
        blocksHandoff: true,
      }));
      continue;
    }
    if (data.kind !== 'data') {
      output.push(diagnostic({
        code: 'BC-OBS-004',
        stage: 'type',
        severity: 'error',
        message: `Observed binding must point to data, not ${data.kind}.`,
        path,
        related: [{
          message: 'Bound entity.',
          path: `/entities/${escapePointer(entity.observedDataId)}`,
        }],
        blocksHandoff: true,
      }));
      continue;
    }

    const rvAxes = entity.valueType.axes.map((axis) => `${axis.role}:${axis.axisId}`);
    const dataAxes = data.valueType.axes.map((axis) => `${axis.role}:${axis.axisId}`);
    if (rvAxes.join('|') !== dataAxes.join('|')) {
      output.push(diagnostic({
        code: 'BC-OBS-005',
        stage: 'shape',
        severity: 'error',
        message: `Observation shape [${rvAxes.join(', ')}] does not match data shape [${dataAxes.join(', ')}].`,
        path,
        related: [{
          message: 'Data shape.',
          path: `/entities/${escapePointer(entity.observedDataId)}/valueType/axes`,
        }],
        blocksHandoff: true,
      }));
    }
  }
  return output;
}

function lintDeterministicCycles(
  document: ModelDocument,
  dependenciesByOwner: Map<EntityId, Set<EntityId>>,
): Diagnostic[] {
  const deterministicIds = Object.values(document.entities)
    .filter((entity) => entity.kind === 'deterministic')
    .map((entity) => entity.id);
  const deterministicSet = new Set(deterministicIds);
  const cycles = findCycles(
    deterministicIds,
    (id) => [...(dependenciesByOwner.get(id) ?? [])].filter((dependency) => deterministicSet.has(dependency)),
  );
  return cycles.map((cycle) => diagnostic({
    code: 'BC-GRAPH-001',
    stage: 'graph',
    severity: 'error',
    message: `Deterministic dependency cycle: ${cycle.map((id) => document.entities[id]?.symbol ?? id).join(' -> ')}.`,
    path: `/entities/${escapePointer(cycle[0]!)}/expression`,
    blocksHandoff: true,
  }));
}

function lintUnusedUnknowns(
  document: ModelDocument,
  dependenciesByOwner: Map<EntityId, Set<EntityId>>,
): Diagnostic[] {
  const used = new Set<EntityId>();
  for (const dependencies of dependenciesByOwner.values()) {
    dependencies.forEach((dependency) => used.add(dependency));
  }

  const output: Diagnostic[] = [];
  for (const [entityId, entity] of Object.entries(document.entities)) {
    if (entity.kind === 'random_variable' && entity.role !== 'observation' && !used.has(entityId)) {
      output.push(diagnostic({
        code: 'BC-GRAPH-002',
        stage: 'graph',
        severity: 'warning',
        certainty: 'likely',
        message: `Unknown quantity "${entity.symbol}" is not referenced by another entity.`,
        path: `/entities/${escapePointer(entityId)}`,
        blocksHandoff: false,
      }));
    }
  }
  return output;
}

function lintOpenQuestions(document: ModelDocument): Diagnostic[] {
  return Object.values(document.notes)
    .filter((note) => note.kind === 'review_question' && note.status === 'open')
    .map((note) => diagnostic({
      code: 'BC-HANDOFF-001',
      stage: 'handoff',
      severity: note.blocking ? 'error' : 'warning',
      message: `Open review question: ${note.text}`,
      path: `/notes/${escapePointer(note.id)}`,
      blocksHandoff: Boolean(note.blocking),
    }));
}

function collectExpressionEntries(document: ModelDocument): ExpressionEntry[] {
  const output: ExpressionEntry[] = [];
  for (const [axisId, axis] of Object.entries(document.axes)) {
    output.push({
      path: `/axes/${escapePointer(axisId)}/size`,
      source: axis.size,
      role: 'expression',
    });
  }

  for (const [entityId, entity] of Object.entries(document.entities)) {
    const basePath = `/entities/${escapePointer(entityId)}`;
    if (entity.kind === 'deterministic') {
      output.push({ path: `${basePath}/expression`, source: entity.expression, ownerEntityId: entityId, role: 'expression' });
    }
    if (entity.kind === 'factor') {
      output.push({ path: `${basePath}/logDensity`, source: entity.logDensity, ownerEntityId: entityId, role: 'expression' });
    }
    if (entity.kind === 'query') {
      output.push({ path: `${basePath}/expression`, source: entity.expression, ownerEntityId: entityId, role: 'expression' });
    }
    if (entity.kind === 'random_variable') {
      for (const [argName, source] of Object.entries(entity.distribution.args)) {
        output.push({
          path: `${basePath}/distribution/args/${escapePointer(argName)}`,
          source,
          ownerEntityId: entityId,
          role: 'distribution',
        });
      }
      if (entity.distribution.truncation?.lower) {
        output.push({ path: `${basePath}/distribution/truncation/lower`, source: entity.distribution.truncation.lower, ownerEntityId: entityId, role: 'distribution' });
      }
      if (entity.distribution.truncation?.upper) {
        output.push({ path: `${basePath}/distribution/truncation/upper`, source: entity.distribution.truncation.upper, ownerEntityId: entityId, role: 'distribution' });
      }
    }
    if (entity.kind === 'block_instance') {
      for (const [portId, binding] of Object.entries(entity.inputs)) {
        if (binding.expression) {
          output.push({
            path: `${basePath}/inputs/${escapePointer(portId)}/expression`,
            source: binding.expression,
            ownerEntityId: entityId,
            role: 'expression',
          });
        }
      }
    }
  }
  return output;
}

function domainsCompatible(domain: NonNullable<RandomVariableEntity['valueType']['domain']>, definition: DistributionDefinition): boolean {
  if (domain.kind === 'custom' || definition.support.kind === 'custom') return true;
  if (domain.kind === definition.support.kind) return true;
  if (domain.kind === 'real') return true;
  if (domain.kind === 'nonnegative' && definition.support.kind === 'positive') return true;
  return false;
}

function findCycles<T extends string>(nodes: readonly T[], outgoing: (node: T) => readonly T[]): T[][] {
  const state = new Map<T, 'visiting' | 'done'>();
  const stack: T[] = [];
  const cycles: T[][] = [];
  const fingerprints = new Set<string>();

  const visit = (node: T): void => {
    const currentState = state.get(node);
    if (currentState === 'done') return;
    if (currentState === 'visiting') {
      const start = stack.indexOf(node);
      const cycle = [...stack.slice(start), node];
      const fingerprint = [...new Set(cycle)].sort().join('\u0000');
      if (!fingerprints.has(fingerprint)) {
        fingerprints.add(fingerprint);
        cycles.push(cycle);
      }
      return;
    }

    state.set(node, 'visiting');
    stack.push(node);
    for (const next of outgoing(node)) visit(next);
    stack.pop();
    state.set(node, 'done');
  };

  nodes.forEach(visit);
  return cycles;
}

function nearestSymbol(value: string, candidates: readonly string[]): string | undefined {
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshtein(value, candidate);
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  if (!best) return undefined;
  return best.distance <= Math.max(2, Math.floor(value.length / 3)) ? best.candidate : undefined;
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length]!;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output = new Set<string>();
  values.forEach((value) => (seen.has(value) ? output.add(value) : seen.add(value)));
  return [...output];
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
