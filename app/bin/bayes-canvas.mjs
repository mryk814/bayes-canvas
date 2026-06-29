#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildCapabilityReport } from '../dist-cli/lib/core/capability-report.js';
import { buildHandoffBundle } from '../dist-cli/lib/core/handoff.js';
import { assertJsonComplexity } from '../dist-cli/lib/core/migrations.js';
import { hierarchicalRegression } from '../dist-cli/lib/core/example.js';
import { loadModelDocumentContract, lintLoadedDocument } from '../dist-cli/lib/core/import-contract.js';
import { minimalDistributionRegistry } from '../dist-cli/lib/core/registry.js';
import { diffModelDocuments } from '../dist-cli/lib/core/semantic-diff.js';

const [command, target, ...rest] = process.argv.slice(2);

try {
  const loaded = target === '--sample'
    ? { document: hierarchicalRegression, sourceKind: 'raw-model', migrationsApplied: [], warnings: [] }
    : await loadDocument(target);
  const targetProfile = readOption(rest, '--target') ?? 'review';

  if (command === 'lint') {
    const semantic = lintLoadedDocument(loaded, minimalDistributionRegistry, targetProfile);
    const summary = semantic.readiness.summary;
    console.log(JSON.stringify({
      documentId: loaded.document.documentId,
      sourceKind: loaded.sourceKind,
      target: targetProfile,
      handoff: semantic.readiness.handoff,
      summary,
      diagnostics: semantic.diagnostics,
      warnings: loaded.warnings,
    }, null, 2));
    process.exit(summary.handoffBlocked ? 1 : 0);
  }

  if (command === 'handoff') {
    const semantic = lintLoadedDocument(loaded, minimalDistributionRegistry, targetProfile);
    const capabilityReport = buildCapabilityReport(loaded.document, targetProfile);
    console.log(JSON.stringify(buildHandoffBundle(loaded.document, semantic, targetProfile, capabilityReport), null, 2));
    process.exit(semantic.readiness.summary.handoffBlocked ? 1 : 0);
  }

  if (command === 'migrate') {
    console.log(JSON.stringify({
      sourceKind: loaded.sourceKind,
      document: loaded.document,
      migrationsApplied: loaded.migrationsApplied,
      message: loaded.migrationsApplied.length
        ? `Applied ${loaded.migrationsApplied.length} migration(s).`
        : 'No migration was required; document is already schemaVersion 1.0.0.',
    }, null, 2));
    process.exit(0);
  }

  if (command === 'diff') {
    const nextPath = rest[0];
    if (!target || !nextPath) throw new Error('Diff requires before and after model paths.');
    const nextLoaded = await loadDocument(nextPath);
    const diff = diffModelDocuments(loaded.document, nextLoaded.document);
    console.log(JSON.stringify({
      before: loaded.document.documentId,
      after: nextLoaded.document.documentId,
      critical: diff.filter((item) => item.severity === 'critical').length,
      items: diff,
    }, null, 2));
    process.exit(diff.some((item) => item.severity === 'critical') ? 1 : 0);
  }

  console.error('Usage: bayes-canvas <lint|handoff|migrate|diff> <model.json|--sample> [after.model.json] [--target pymc]');
  process.exit(2);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function loadDocument(path) {
  if (!path) throw new Error('Model path is required.');
  const text = await readFile(path, 'utf8');
  const parsed = assertJsonComplexity(text, { maxBytes: 1024 * 1024, maxDepth: 64 });
  return loadModelDocumentContract(parsed);
}

function readOption(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}
