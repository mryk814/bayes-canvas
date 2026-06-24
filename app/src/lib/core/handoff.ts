import type { SemanticModel } from './compiler.js';
import type { ModelDocument } from './model.js';

export type HandoffTarget = 'generic' | 'pymc' | 'numpyro' | 'stan' | 'review';

export interface BackendCapabilityItem {
  feature: string;
  support: 'native' | 'lowered' | 'approximate' | 'unsupported' | 'unknown';
  relatedEntityIds: string[];
  note?: string;
}

export interface HandoffBundle {
  manifest: {
    bundleVersion: '1.0.0';
    modelDocumentId: string;
    sourceRevision: number;
    schemaVersion: string;
    compilerVersion: string;
    target: HandoffTarget;
    createdAt: string;
    /** Caller should replace this with a cryptographic hash of normalized model.json. */
    specificationFingerprint: string;
  };
  model: ModelDocument;
  semantic: {
    symbols: SemanticModel['symbols'];
    dependencyEdges: SemanticModel['dependencyEdges'];
  };
  diagnostics: SemanticModel['diagnostics'];
  unresolvedQuestions: Array<{
    id: string;
    text: string;
    blocking: boolean;
    relatedEntityIds: string[];
  }>;
  capabilityReport: BackendCapabilityItem[];
  implementationContract: {
    preserveEntityIds: true;
    doNotInventAssumptions: true;
    reportDeviations: true;
    returnMapping: Array<'entity_id' | 'implementation_symbol' | 'file' | 'line_range'>;
  };
}

export function buildHandoffBundle(
  document: ModelDocument,
  semantic: SemanticModel,
  target: HandoffTarget,
  capabilityReport: BackendCapabilityItem[] = [],
  now = new Date(),
): HandoffBundle {
  return {
    manifest: {
      bundleVersion: '1.0.0',
      modelDocumentId: document.documentId,
      sourceRevision: document.revision,
      schemaVersion: document.schemaVersion,
      compilerVersion: semantic.compilerVersion,
      target,
      createdAt: now.toISOString(),
      specificationFingerprint: stableFingerprintInput(document),
    },
    model: document,
    semantic: {
      symbols: semantic.symbols,
      dependencyEdges: semantic.dependencyEdges,
    },
    diagnostics: semantic.diagnostics,
    unresolvedQuestions: Object.values(document.notes)
      .filter((note) => note.kind === 'review_question' && note.status === 'open')
      .map((note) => ({
        id: note.id,
        text: note.text,
        blocking: Boolean(note.blocking),
        relatedEntityIds: note.relatedEntityIds,
      })),
    capabilityReport,
    implementationContract: {
      preserveEntityIds: true,
      doNotInventAssumptions: true,
      reportDeviations: true,
      returnMapping: ['entity_id', 'implementation_symbol', 'file', 'line_range'],
    },
  };
}

/**
 * Stable JSON text is useful as hash input. For production, normalize defaults
 * first and hash this string with SHA-256 (or use a standards-compliant JCS tool).
 */
export function stableFingerprintInput(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableFingerprintInput).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableFingerprintInput(object[key])}`)
    .join(',')}}`;
}
