export interface SchemaValidationIssue {
  path: string;
  message: string;
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
  return issues;
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
