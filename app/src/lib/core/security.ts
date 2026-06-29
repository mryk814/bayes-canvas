export interface SecurityValidationIssue {
  path: string;
  message: string;
}

const EXECUTABLE_FIELD_PATTERN = /(^|_|\b)(code|script|python|javascript|typescript|shell|bash|cmd|powershell|wasm|binary|executable|command|eval|function|hook|loader)(_|$|\b)/iu;
const ACCESS_FIELD_PATTERN = /(^|_|\b)(fs|file|filesystem|network|http|https|remote|url|clipboard|database|sqlite|os|process|env|secret|token|credential|adapter|mcp|plugin)(access|permission|capability|url|path|command|declaration|request)?($|\b|_)/iu;
const URL_PATTERN = /^(https?|file|ftp|ssh|ws|wss):\/\//iu;
const ALLOWED_DOMAIN_KEYS = new Set([
  'observation_process',
  'process_kind',
]);

export function validateExternalDataContract(value: unknown, label = 'import'): SecurityValidationIssue[] {
  const issues: SecurityValidationIssue[] = [];
  walk(value, '', issues, new WeakSet<object>());
  return issues.map((issue) => ({
    path: issue.path || '/',
    message: `${label}: ${issue.message}`,
  }));
}

export function assertExternalDataContract(value: unknown, label = 'import'): void {
  const issues = validateExternalDataContract(value, label);
  if (issues.length) {
    throw new Error(`Unsafe external data contract rejected: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join(' / ')}`);
  }
}

function walk(value: unknown, path: string, issues: SecurityValidationIssue[], seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    if (URL_PATTERN.test(value.trim())) {
      issues.push({ path, message: 'remote URL dereference is not allowed in imported contracts.' });
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) {
    issues.push({ path, message: 'cyclic data is not allowed.' });
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}/${index}`, issues, seen));
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}/${escapePointer(key)}`;
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
    const isDomainKey = ALLOWED_DOMAIN_KEYS.has(normalizedKey);
    if (!isDomainKey && EXECUTABLE_FIELD_PATTERN.test(normalizedKey)) {
      issues.push({ path: childPath, message: `executable code field "${key}" is not allowed.` });
    }
    if (!isDomainKey && ACCESS_FIELD_PATTERN.test(normalizedKey)) {
      issues.push({ path: childPath, message: `OS, filesystem, network, clipboard, database, plugin, or MCP access declaration "${key}" is not allowed.` });
    }
    walk(child, childPath, issues, seen);
  }
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
