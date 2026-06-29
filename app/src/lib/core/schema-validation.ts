export interface SchemaValidationIssue {
  path: string;
  message: string;
}

export class SchemaValidationError extends Error {
  constructor(readonly issues: SchemaValidationIssue[], label = 'Schema validation failed') {
    super(`${label}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join(' / ')}`);
  }
}

export function validateKnownKeys(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): SchemaValidationIssue[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ path, message: 'Expected an object.' }];
  }
  const allowed = new Set(allowedKeys);
  return Object.keys(value as Record<string, unknown>)
    .filter((key) => !allowed.has(key))
    .map((key) => ({ path: `${path}/${key}`, message: `Unknown property "${key}".` }));
}

export function validateModelDocumentEnvelope(value: unknown): SchemaValidationIssue[] {
  const issues = validateKnownKeys(value, '', [
    'schemaVersion',
    'documentId',
    'revision',
    'model',
    'axes',
    'plates',
    'entities',
    'entityOrder',
    'macros',
    'loweringSourceMap',
    'notes',
    'noteOrder',
    'extensions',
  ]);
  if (!isRecord(value)) return issues;
  issues.push(...requireString(value, '', 'schemaVersion'));
  issues.push(...requireString(value, '', 'documentId'));
  issues.push(...requireNumber(value, '', 'revision'));
  issues.push(...requireRecord(value, '', 'model'));
  issues.push(...requireRecord(value, '', 'axes'));
  issues.push(...requireRecord(value, '', 'plates'));
  issues.push(...requireRecord(value, '', 'entities'));
  issues.push(...requireArray(value, '', 'entityOrder'));
  issues.push(...requireRecord(value, '', 'notes'));
  issues.push(...requireArray(value, '', 'noteOrder'));
  if (isRecord(value.entities)) {
    for (const [entityId, entity] of Object.entries(value.entities)) {
      issues.push(...validateEntityEnvelope(entity, `/entities/${entityId}`, entityId));
    }
  }
  issues.push(...validateModelDocumentDeepShape(value));
  return issues;
}

export function validateLayoutDocumentEnvelope(value: unknown): SchemaValidationIssue[] {
  const issues = validateKnownKeys(value, '', [
    'schemaVersion',
    'modelDocumentId',
    'revision',
    'nodes',
    'view',
    'hiddenEntityIds',
  ]);
  if (!isRecord(value)) return issues;
  issues.push(...requireString(value, '', 'schemaVersion'));
  issues.push(...requireString(value, '', 'modelDocumentId'));
  issues.push(...requireNumber(value, '', 'revision'));
  issues.push(...requireRecord(value, '', 'nodes'));
  if (isRecord(value.nodes)) {
    for (const [nodeId, node] of Object.entries(value.nodes)) {
      if (!isRecord(node)) {
        issues.push({ path: `/nodes/${nodeId}`, message: 'Expected an object.' });
        continue;
      }
      issues.push(...requireNumber(node, `/nodes/${nodeId}`, 'x'));
      issues.push(...requireNumber(node, `/nodes/${nodeId}`, 'y'));
    }
  }
  return issues;
}

export function validateImplementationReceiptEnvelope(value: unknown): SchemaValidationIssue[] {
  const issues = validateKnownKeys(value, '', [
    'receiptVersion',
    'inputSpecificationFingerprintAlgorithm',
    'inputSpecificationFingerprint',
    'backend',
    'mappings',
    'deviations',
    'addedAssumptions',
    'approximations',
    'unresolvedQuestions',
  ]);
  if (!isRecord(value)) return issues;
  issues.push(...requireString(value, '', 'receiptVersion'));
  issues.push(...requireString(value, '', 'inputSpecificationFingerprint'));
  issues.push(...requireString(value, '', 'backend'));
  issues.push(...requireArray(value, '', 'mappings'));
  issues.push(...requireArray(value, '', 'deviations'));
  issues.push(...requireArray(value, '', 'addedAssumptions'));
  issues.push(...requireArray(value, '', 'approximations'));
  issues.push(...requireArray(value, '', 'unresolvedQuestions'));
  if (Array.isArray(value.mappings)) {
    value.mappings.forEach((mapping, index) => {
      if (!isRecord(mapping)) {
        issues.push({ path: `/mappings/${index}`, message: 'Expected an object.' });
        return;
      }
      issues.push(...requireString(mapping, `/mappings/${index}`, 'entityId'));
      issues.push(...requireString(mapping, `/mappings/${index}`, 'implementationSymbol'));
      issues.push(...requireString(mapping, `/mappings/${index}`, 'file'));
      if (mapping.lineRange !== undefined && (
        !Array.isArray(mapping.lineRange)
        || mapping.lineRange.length !== 2
        || mapping.lineRange.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 1)
      )) {
        issues.push({ path: `/mappings/${index}/lineRange`, message: 'Expected [startLine, endLine] positive integers.' });
      }
    });
  }
  return issues;
}

export function parseModelDocument<T>(value: unknown): T {
  const issues = validateModelDocumentEnvelope(value);
  if (issues.length) throw new SchemaValidationError(issues, 'ModelDocument validation failed');
  return value as T;
}

export function parseLayoutDocument<T>(value: unknown): T {
  const issues = validateLayoutDocumentEnvelope(value);
  if (issues.length) throw new SchemaValidationError(issues, 'LayoutDocument validation failed');
  return value as T;
}

export function parseImplementationReceipt<T>(value: unknown): T {
  const issues = validateImplementationReceiptEnvelope(value);
  if (issues.length) throw new SchemaValidationError(issues, 'ImplementationReceipt validation failed');
  return value as T;
}

export function validateAiPatchProposalEnvelope(value: unknown): SchemaValidationIssue[] {
  const issues = validateKnownKeys(value, '', [
    'proposalVersion',
    'baseDocumentId',
    'baseRevision',
    'intent',
    'author',
    'operations',
    'expectedDiagnostics',
    'reviewNotes',
  ]);
  if (!isRecord(value)) return issues;
  issues.push(...requireString(value, '', 'proposalVersion'));
  issues.push(...requireString(value, '', 'baseDocumentId'));
  issues.push(...requireNumber(value, '', 'baseRevision'));
  issues.push(...requireString(value, '', 'intent'));
  issues.push(...requireString(value, '', 'author'));
  issues.push(...requireArray(value, '', 'operations'));
  if (value.proposalVersion !== '1.0.0') issues.push({ path: '/proposalVersion', message: 'Expected "1.0.0".' });
  if (!['ai', 'user', 'import'].includes(String(value.author))) issues.push({ path: '/author', message: 'Expected ai, user, or import.' });
  if (Array.isArray(value.operations)) {
    value.operations.forEach((operation, index) => {
      const path = `/operations/${index}`;
      if (!isRecord(operation)) {
        issues.push({ path, message: 'Expected an object.' });
        return;
      }
      if (!['add', 'remove', 'replace', 'move', 'copy', 'test'].includes(String(operation.op))) {
        issues.push({ path: `${path}/op`, message: 'Expected a JSON Patch op.' });
      }
      issues.push(...requireString(operation, path, 'path'));
      if ((operation.op === 'move' || operation.op === 'copy') && typeof operation.from !== 'string') {
        issues.push({ path: `${path}/from`, message: 'Expected a JSON Pointer string.' });
      }
      if (['add', 'replace', 'test'].includes(String(operation.op)) && !Object.prototype.hasOwnProperty.call(operation, 'value')) {
        issues.push({ path: `${path}/value`, message: 'Expected a value.' });
      }
    });
  }
  return issues;
}

export function parseAiPatchProposal<T>(value: unknown): T {
  const issues = validateAiPatchProposalEnvelope(value);
  if (issues.length) throw new SchemaValidationError(issues, 'AiPatchProposal validation failed');
  return value as T;
}

function validateEntityEnvelope(value: unknown, path: string, entityId: string): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, message: 'Expected an object.' }];
  issues.push(...requireString(value, path, 'id'));
  issues.push(...requireString(value, path, 'symbol'));
  issues.push(...requireString(value, path, 'kind'));
  issues.push(...requireRecord(value, path, 'valueType'));
  issues.push(...requireArray(value, path, 'plateIds'));
  if (value.id !== undefined && value.id !== entityId) {
    issues.push({ path: `${path}/id`, message: `Entity id must match its record key "${entityId}".` });
  }
  if (value.kind === 'random_variable') {
    issues.push(...requireString(value, path, 'role'));
    issues.push(...requireRecord(value, path, 'distribution'));
  }
  if (value.kind === 'deterministic') issues.push(...requireRecord(value, path, 'expression'));
  if (value.kind === 'factor') issues.push(...requireRecord(value, path, 'logDensity'));
  if (value.kind === 'block_instance') {
    issues.push(...requireString(value, path, 'blockTypeId'));
    issues.push(...requireString(value, path, 'blockVersion'));
    issues.push(...requireRecord(value, path, 'inputs'));
    issues.push(...requireRecord(value, path, 'outputs'));
    issues.push(...requireRecord(value, path, 'config'));
  }
  if (value.kind === 'query') {
    issues.push(...requireString(value, path, 'queryRole'));
    issues.push(...requireRecord(value, path, 'expression'));
  }
  return issues;
}

function validateModelDocumentDeepShape(value: Record<string, unknown>): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  if (value.schemaVersion !== '1.0.0') issues.push({ path: '/schemaVersion', message: 'Expected "1.0.0".' });
  if (isRecord(value.model)) {
    issues.push(...requireString(value.model, '/model', 'id'));
    issues.push(...requireString(value.model, '/model', 'name'));
  }
  if (isRecord(value.axes)) {
    for (const [axisId, axisValue] of Object.entries(value.axes)) {
      const path = `/axes/${escapePointer(axisId)}`;
      if (!isRecord(axisValue)) {
        issues.push({ path, message: 'Expected an object.' });
        continue;
      }
      issues.push(...requireString(axisValue, path, 'id'));
      issues.push(...requireString(axisValue, path, 'symbol'));
      issues.push(...requireString(axisValue, path, 'label'));
      issues.push(...validateSourceText(axisValue.size, `${path}/size`));
    }
  }
  if (isRecord(value.plates)) {
    for (const [plateId, plateValue] of Object.entries(value.plates)) {
      const path = `/plates/${escapePointer(plateId)}`;
      if (!isRecord(plateValue)) {
        issues.push({ path, message: 'Expected an object.' });
        continue;
      }
      issues.push(...requireString(plateValue, path, 'id'));
      issues.push(...requireString(plateValue, path, 'label'));
      issues.push(...requireString(plateValue, path, 'axisId'));
      issues.push(...requireString(plateValue, path, 'indexSymbol'));
      issues.push(...requireArray(plateValue, path, 'parentPlateIds'));
      if (!['conditionally_independent', 'exchangeable', 'declared_only'].includes(String(plateValue.assumption))) {
        issues.push({ path: `${path}/assumption`, message: 'Expected a valid plate assumption.' });
      }
    }
  }
  if (isRecord(value.entities)) {
    for (const [entityId, entityValue] of Object.entries(value.entities)) {
      const path = `/entities/${escapePointer(entityId)}`;
      if (!isRecord(entityValue)) continue;
      issues.push(...validateValueType(entityValue.valueType, `${path}/valueType`));
      if (!Array.isArray(entityValue.plateIds) || entityValue.plateIds.some((item) => typeof item !== 'string')) {
        issues.push({ path: `${path}/plateIds`, message: 'Expected an array of strings.' });
      }
      if (!['data', 'random_variable', 'deterministic', 'factor', 'block_instance', 'query'].includes(String(entityValue.kind))) {
        issues.push({ path: `${path}/kind`, message: 'Expected a valid entity kind.' });
      }
      validateEntityDeepShape(entityValue, path).forEach((issue) => issues.push(issue));
    }
  }
  if (isRecord(value.notes)) {
    for (const [noteId, noteValue] of Object.entries(value.notes)) {
      const path = `/notes/${escapePointer(noteId)}`;
      if (!isRecord(noteValue)) {
        issues.push({ path, message: 'Expected an object.' });
        continue;
      }
      issues.push(...requireString(noteValue, path, 'id'));
      issues.push(...requireString(noteValue, path, 'kind'));
      issues.push(...requireString(noteValue, path, 'text'));
      issues.push(...requireString(noteValue, path, 'status'));
      issues.push(...requireArray(noteValue, path, 'relatedEntityIds'));
    }
  }
  return issues;
}

function validateEntityDeepShape(entity: Record<string, unknown>, path: string): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  if (entity.kind === 'data' && !['observed_value', 'predictor', 'index', 'constant', 'coordinate', 'metadata'].includes(String(entity.dataRole))) {
    issues.push({ path: `${path}/dataRole`, message: 'Expected a valid data role.' });
  }
  if (entity.kind === 'random_variable') {
    if (!['parameter', 'latent', 'observation'].includes(String(entity.role))) {
      issues.push({ path: `${path}/role`, message: 'Expected parameter, latent, or observation.' });
    }
    issues.push(...validateDistributionCall(entity.distribution, `${path}/distribution`));
    if (entity.observationProcess !== undefined) {
      issues.push(...validateObservationProcess(entity.observationProcess, `${path}/observationProcess`));
    }
  }
  if (entity.kind === 'deterministic') issues.push(...validateSourceText(entity.expression, `${path}/expression`));
  if (entity.kind === 'factor') {
    issues.push(...validateSourceText(entity.logDensity, `${path}/logDensity`));
    if (!['known', 'unknown', 'not_required'].includes(String(entity.normalization))) {
      issues.push({ path: `${path}/normalization`, message: 'Expected known, unknown, or not_required.' });
    }
  }
  if (entity.kind === 'block_instance') {
    if (!isRecord(entity.inputs)) issues.push({ path: `${path}/inputs`, message: 'Expected an object.' });
    if (!isRecord(entity.outputs)) issues.push({ path: `${path}/outputs`, message: 'Expected an object.' });
    if (!isRecord(entity.config)) issues.push({ path: `${path}/config`, message: 'Expected an object.' });
  }
  if (entity.kind === 'query') {
    if (!['quantity_of_interest', 'prediction_target', 'contrast', 'generated_quantity'].includes(String(entity.queryRole))) {
      issues.push({ path: `${path}/queryRole`, message: 'Expected a valid query role.' });
    }
    issues.push(...validateSourceText(entity.expression, `${path}/expression`));
  }
  return issues;
}

function validateDistributionCall(value: unknown, path: string): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  if (!isRecord(value)) return [{ path, message: 'Expected an object.' }];
  issues.push(...requireString(value, path, 'distributionId'));
  issues.push(...requireRecord(value, path, 'args'));
  if (isRecord(value.args)) {
    for (const [argName, source] of Object.entries(value.args)) {
      issues.push(...validateSourceText(source, `${path}/args/${escapePointer(argName)}`));
    }
  }
  return issues;
}

function validateSourceText(value: unknown, path: string): SchemaValidationIssue[] {
  if (!isRecord(value)) return [{ path, message: 'Expected a SourceText object.' }];
  const issues: SchemaValidationIssue[] = [];
  if (value.language !== 'bayes-expr@1') issues.push({ path: `${path}/language`, message: 'Expected "bayes-expr@1".' });
  issues.push(...requireString(value, path, 'source'));
  return issues;
}

function validateValueType(value: unknown, path: string): SchemaValidationIssue[] {
  if (!isRecord(value)) return [{ path, message: 'Expected an object.' }];
  const issues: SchemaValidationIssue[] = [];
  if (!['real', 'integer', 'boolean', 'category'].includes(String(value.scalar))) {
    issues.push({ path: `${path}/scalar`, message: 'Expected a valid scalar kind.' });
  }
  if (!Array.isArray(value.axes)) {
    issues.push({ path: `${path}/axes`, message: 'Expected an array.' });
  } else {
    value.axes.forEach((axis, index) => {
      if (!isRecord(axis)) {
        issues.push({ path: `${path}/axes/${index}`, message: 'Expected an object.' });
        return;
      }
      issues.push(...requireString(axis, `${path}/axes/${index}`, 'axisId'));
      if (!['batch', 'event'].includes(String(axis.role))) {
        issues.push({ path: `${path}/axes/${index}/role`, message: 'Expected batch or event.' });
      }
    });
  }
  return issues;
}

function validateObservationProcess(value: unknown, path: string): SchemaValidationIssue[] {
  if (!isRecord(value)) return [{ path, message: 'Expected an object.' }];
  if (!['exact', 'missing', 'measurement_error', 'censored', 'truncated', 'rounded', 'custom'].includes(String(value.kind))) {
    return [{ path: `${path}/kind`, message: 'Expected a valid observation process kind.' }];
  }
  return [];
}

function requireString(value: Record<string, unknown>, path: string, key: string): SchemaValidationIssue[] {
  return typeof value[key] === 'string' ? [] : [{ path: `${path}/${key}`, message: 'Expected a string.' }];
}

function requireNumber(value: Record<string, unknown>, path: string, key: string): SchemaValidationIssue[] {
  return typeof value[key] === 'number' && Number.isFinite(value[key]) ? [] : [{ path: `${path}/${key}`, message: 'Expected a finite number.' }];
}

function requireArray(value: Record<string, unknown>, path: string, key: string): SchemaValidationIssue[] {
  return Array.isArray(value[key]) ? [] : [{ path: `${path}/${key}`, message: 'Expected an array.' }];
}

function requireRecord(value: Record<string, unknown>, path: string, key: string): SchemaValidationIssue[] {
  return isRecord(value[key]) ? [] : [{ path: `${path}/${key}`, message: 'Expected an object.' }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
