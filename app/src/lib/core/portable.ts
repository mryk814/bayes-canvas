import { buildHandoffBundle, type HandoffTarget } from './handoff.js';
import { createStableFingerprint, type FINGERPRINT_ALGORITHM } from './fingerprint.js';
import type { SemanticModel } from './compiler.js';
import type { LayoutDocument, ModelDocument } from './model.js';

export interface PortableBayesCanvasPackage {
  manifest: {
    packageVersion: '1.0.0';
    modelDocumentId: string;
    sourceRevision: number;
    schemaVersion: string;
    createdAt: string;
    fingerprintAlgorithm: typeof FINGERPRINT_ALGORITHM;
    fingerprint: string;
    files: string[];
  };
  files: Record<string, string>;
}

export function buildPortablePackage(
  document: ModelDocument,
  layout: LayoutDocument,
  semantic: SemanticModel,
  target: HandoffTarget = 'review',
  now = new Date(),
): PortableBayesCanvasPackage {
  const handoff = buildHandoffBundle(document, semantic, target);
  const fingerprint = createStableFingerprint({ model: document, layout });
  const files = {
    'manifest.json': '',
    'model.json': JSON.stringify(document, null, 2),
    'layout.json': JSON.stringify(layout, null, 2),
    'diagnostics.json': JSON.stringify(semantic.diagnostics, null, 2),
    'handoff.json': JSON.stringify(handoff, null, 2),
    'decisions.jsonl': Object.values(document.notes).map((note) => JSON.stringify(note)).join('\n'),
  };
  const manifest = {
    packageVersion: '1.0.0' as const,
    modelDocumentId: document.documentId,
    sourceRevision: document.revision,
    schemaVersion: document.schemaVersion,
    createdAt: now.toISOString(),
    fingerprintAlgorithm: fingerprint.algorithm,
    fingerprint: fingerprint.value,
    files: Object.keys(files),
  };
  files['manifest.json'] = JSON.stringify(manifest, null, 2);
  return { manifest, files };
}
