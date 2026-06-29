import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const srcDir = new URL('../src/', import.meta.url);
const files = (await collect(srcDir)).filter((file) => /\.(tsx?|jsx?)$/u.test(file));
const failures = [];
const complexityGrandfathered = new Set([
  'src\\App.tsx',
  'src\\lib\\documentAdapter.ts',
  'src\\lib\\modelIr.ts',
]);

for (const file of files) {
  if (file.includes('/dist-test/') || file.includes('/dist-cli/')) continue;
  const text = await readFile(file, 'utf8');
  const rel = path.relative(process.cwd(), file);
  checkHooks(rel, text);
  checkUnusedSimpleImports(rel, text);
  checkComplexity(rel, text);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

async function collect(url) {
  const entries = await readdir(url, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const child = new URL(entry.name, `${url.href}${url.href.endsWith('/') ? '' : '/'}`);
    if (entry.isDirectory()) output.push(...await collect(new URL(`${entry.name}/`, url)));
    if (entry.isFile()) output.push(child.pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
  }
  return output;
}

function checkHooks(rel, text) {
  for (const hook of ['useEffect', 'useMemo', 'useCallback']) {
    const pattern = new RegExp(`${hook}\\s*\\(`, 'gu');
    const count = [...text.matchAll(pattern)].length;
    const dependencyCount = [...text.matchAll(/\]\s*\)/gu)].length;
    if (count && dependencyCount === 0) {
      failures.push(`${rel}: React hook calls must declare dependencies.`);
    }
  }
}

function checkUnusedSimpleImports(rel, text) {
  const importPattern = /^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];$/gmu;
  for (const match of text.matchAll(importPattern)) {
    for (const rawName of match[1].split(',')) {
      const name = rawName.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u).pop()?.trim();
      if (!name) continue;
      const withoutImport = text.replace(match[0], '');
      if (!new RegExp(`\\b${escapeRegex(name)}\\b`, 'u').test(withoutImport)) {
        failures.push(`${rel}: imported name "${name}" is not used.`);
      }
    }
  }
}

function checkComplexity(rel, text) {
  if (complexityGrandfathered.has(rel)) return;
  const functionMatches = [...text.matchAll(/(?:function\s+\w+|\)\s*=>|\w+\s*=\s*\([^)]*\)\s*=>)/gu)].length;
  const lineCount = text.split(/\r?\n/u).length;
  if (lineCount > 2600 && !rel.endsWith('App.tsx')) {
    failures.push(`${rel}: file is too large (${lineCount} lines). Split responsibility before adding more logic.`);
  }
  if (functionMatches > 110 && !rel.endsWith('App.tsx')) {
    failures.push(`${rel}: too many function bodies (${functionMatches}).`);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
