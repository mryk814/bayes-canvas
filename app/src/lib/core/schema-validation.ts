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
  return validateKnownKeys(value, '', [
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
}

export function validateLayoutDocumentEnvelope(value: unknown): SchemaValidationIssue[] {
  return validateKnownKeys(value, '', [
    'schemaVersion',
    'modelDocumentId',
    'revision',
    'nodes',
    'view',
    'hiddenEntityIds',
  ]);
}

export function validateImplementationReceiptEnvelope(value: unknown): SchemaValidationIssue[] {
  return validateKnownKeys(value, '', [
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
}
