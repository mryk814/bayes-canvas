import { compileModel } from './compiler.js';
import type { HandoffTarget } from './handoff.js';
import { importVersionedDocument } from './migrations.js';
import type { DistributionRegistry, ModelDocument } from './model.js';
import { parseModelDocument } from './schema-validation.js';
import { assertExternalDataContract } from './security.js';

export interface LoadedModelDocument {
  document: ModelDocument;
  sourceKind: 'raw-model' | 'portable-package' | 'file-map';
  migrationsApplied: string[];
  warnings: string[];
}

export function loadModelDocumentContract(value: unknown): LoadedModelDocument {
  assertExternalDataContract(value, 'model document load');
  const { modelValue, sourceKind, warnings } = extractModelValue(value);
  const result = importVersionedDocument<ModelDocument>(
    modelValue,
    '1.0.0',
    [],
    (candidate) => parseModelDocument<ModelDocument>(candidate),
  );
  return {
    document: result.value,
    sourceKind,
    migrationsApplied: result.migrationsApplied,
    warnings,
  };
}

export function lintLoadedDocument(
  loaded: LoadedModelDocument,
  distributions: DistributionRegistry,
  target: HandoffTarget,
) {
  return compileModel(loaded.document, distributions, { targetBackend: target });
}

function extractModelValue(value: unknown): Omit<LoadedModelDocument, 'document' | 'migrationsApplied'> & { modelValue: unknown } {
  if (!isRecord(value)) throw new Error('Input must be a JSON object.');
  if (isModelDocumentLike(value)) {
    return { modelValue: value, sourceKind: 'raw-model', warnings: [] };
  }
  const files = normalizePackageFiles(value.files);
  if (files) {
    const model = files['model.json'];
    if (model === undefined) throw new Error('Portable package file map is missing model.json.');
    return {
      modelValue: parseJsonLike(model, 'model.json'),
      sourceKind: Array.isArray(value.files) ? 'file-map' : 'portable-package',
      warnings: [],
    };
  }
  const model = value['model.json'] ?? value.modelDocument ?? value.document ?? value.model;
  if (model !== undefined) {
    return {
      modelValue: parseJsonLike(model, 'model.json'),
      sourceKind: 'portable-package',
      warnings: ['Loaded model from a package-like object.'],
    };
  }
  throw new Error('Input is neither a raw ModelDocument nor a portable package with model.json.');
}

function normalizePackageFiles(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([path, content]) => [normalizePackagePath(path), content]),
    );
  }
  if (Array.isArray(value)) {
    const entries = value.flatMap((entry): Array<[string, unknown]> => {
      if (!isRecord(entry) || typeof entry.path !== 'string') return [];
      return [[normalizePackagePath(entry.path), entry.content ?? entry.text ?? entry.value]];
    });
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
}

function parseJsonLike(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isModelDocumentLike(value: Record<string, unknown>): boolean {
  return value.schemaVersion === '1.0.0'
    && typeof value.documentId === 'string'
    && isRecord(value.model)
    && isRecord(value.entities);
}

function normalizePackagePath(path: string): string {
  const normalized = path.replace(/\\/gu, '/').replace(/^\.?\//u, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
