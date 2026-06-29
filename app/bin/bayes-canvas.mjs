#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { compileModel } from '../dist-cli/lib/core/compiler.js';
import { buildHandoffBundle } from '../dist-cli/lib/core/handoff.js';
import { assertJsonComplexity } from '../dist-cli/lib/core/migrations.js';
import { hierarchicalRegression } from '../dist-cli/lib/core/example.js';
import { minimalDistributionRegistry } from '../dist-cli/lib/core/registry.js';
import { diffModelDocuments } from '../dist-cli/lib/core/semantic-diff.js';

const [command, target, ...rest] = process.argv.slice(2);

try {
  const document = target === '--sample'
    ? hierarchicalRegression
    : await loadDocument(target);

  if (command === 'lint') {
    const semantic = compileModel(document, minimalDistributionRegistry);
    const summary = semantic.readiness.summary;
    console.log(JSON.stringify({
      documentId: document.documentId,
      handoff: semantic.readiness.handoff,
      diagnostics: summary,
    }, null, 2));
    process.exit(summary.errors > 0 ? 1 : 0);
  }

  if (command === 'handoff') {
    const targetProfile = readOption(rest, '--target') ?? 'review';
    const semantic = compileModel(document, minimalDistributionRegistry);
    console.log(JSON.stringify(buildHandoffBundle(document, semantic, targetProfile), null, 2));
    process.exit(0);
  }

  if (command === 'migrate') {
    console.log(JSON.stringify(document, null, 2));
    process.exit(0);
  }

  if (command === 'diff') {
    const nextPath = rest[0];
    if (!target || !nextPath) throw new Error('Diff requires before and after model paths.');
    const nextDocument = await loadDocument(nextPath);
    console.log(JSON.stringify(diffModelDocuments(document, nextDocument), null, 2));
    process.exit(0);
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
  return assertJsonComplexity(text, { maxBytes: 1024 * 1024, maxDepth: 64 });
}

function readOption(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}
