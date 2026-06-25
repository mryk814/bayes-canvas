import { createStableFingerprint, type FINGERPRINT_ALGORITHM } from './fingerprint.js';
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
    fingerprintAlgorithm: typeof FINGERPRINT_ALGORITHM;
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
  const fingerprint = createStableFingerprint(document);
  return {
    manifest: {
      bundleVersion: '1.0.0',
      modelDocumentId: document.documentId,
      sourceRevision: document.revision,
      schemaVersion: document.schemaVersion,
      compilerVersion: semantic.compilerVersion,
      target,
      createdAt: now.toISOString(),
      fingerprintAlgorithm: fingerprint.algorithm,
      specificationFingerprint: fingerprint.value,
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
