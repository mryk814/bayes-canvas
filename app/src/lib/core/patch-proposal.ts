import type { SemanticModel } from './compiler.js';
import { compileModel } from './compiler.js';
import type { JsonPatchOperation } from './diagnostics.js';
import { applyJsonPatch, readPointer, validateJsonPatchOperations } from './json-patch.js';
import type { DistributionRegistry, ModelDocument } from './model.js';
import { diffModelDocuments, type SemanticDiffItem } from './semantic-diff.js';
import { parseAiPatchProposal } from './schema-validation.js';

export interface AiPatchProposal {
  proposalVersion: '1.0.0';
  baseDocumentId: string;
  baseRevision: number;
  intent: string;
  author: 'ai' | 'user' | 'import';
  operations: JsonPatchOperation[];
  expectedDiagnostics?: {
    before?: string[];
    after?: string[];
  };
  reviewNotes?: string[];
}

export interface PatchPreview {
  proposal: AiPatchProposal;
  before: SemanticModel;
  after: SemanticModel;
  semanticDiff: SemanticDiffItem[];
  patchedDocument: ModelDocument;
}

export function previewPatchProposal(
  document: ModelDocument,
  proposal: AiPatchProposal,
  distributions: DistributionRegistry,
): PatchPreview {
  validatePatchProposal(document, proposal);
  const patchedDocument = applyJsonPatch(document, proposal.operations).value;
  const before = compileModel(document, distributions);
  const after = compileModel(patchedDocument, distributions);
  return {
    proposal,
    before,
    after,
    semanticDiff: diffModelDocuments(document, patchedDocument),
    patchedDocument,
  };
}

export function validatePatchProposal(document: ModelDocument, proposal: AiPatchProposal): void {
  parseAiPatchProposal<AiPatchProposal>(proposal);
  if (proposal.proposalVersion !== '1.0.0') throw new Error('Unsupported patch proposal version.');
  if (proposal.baseDocumentId !== document.documentId) throw new Error('Patch proposal targets a different document.');
  if (proposal.baseRevision !== document.revision) throw new Error('Patch proposal targets a different document revision.');
  if (!proposal.operations.length) throw new Error('Patch proposal has no operations.');
  validateJsonPatchOperations(document, proposal.operations);
  validatePatchPreservesDocumentIdentity(document, proposal);
}

function validatePatchPreservesDocumentIdentity(document: ModelDocument, proposal: AiPatchProposal): void {
  const patchedDocument = applyJsonPatch(document, proposal.operations).value;
  if (patchedDocument.documentId !== document.documentId) throw new Error('Patch must not change documentId.');
  if (patchedDocument.schemaVersion !== document.schemaVersion) throw new Error('Patch must not change schemaVersion.');
  for (const operation of proposal.operations) {
    if (!operation.path.startsWith('/entities/')) continue;
    const [, , entityId] = operation.path.split('/');
    if (!entityId || entityId.includes('~')) continue;
    if (operation.op === 'add' && operation.path === `/entities/${entityId}`) continue;
    if (operation.op === 'remove' && operation.path === `/entities/${entityId}`) continue;
    if (operation.path === `/entities/${entityId}/id`) throw new Error('Patch must not rewrite stable entity IDs.');
    const entity = readPointer(patchedDocument, `/entities/${entityId}`) as { id?: string };
    if (entity?.id && entity.id !== entityId) throw new Error(`Patch changed stable entity ID for ${entityId}.`);
  }
}
