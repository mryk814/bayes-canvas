export interface Migration {
  from: string;
  to: string;
  migrate(value: Record<string, unknown>): Record<string, unknown>;
}

export interface ImportResult<T> {
  value: T;
  migrationsApplied: string[];
}

/**
 * Import order: parse JSON -> size/depth guard -> migrate -> strict schema parse -> compile.
 * `strictParse` is intended to be implemented with Zod or JSON Schema/Ajv.
 */
export function importVersionedDocument<T>(
  input: unknown,
  targetVersion: string,
  migrations: readonly Migration[],
  strictParse: (value: unknown) => T,
): ImportResult<T> {
  if (!isRecord(input)) throw new Error('The imported value must be a JSON object.');

  let current = structuredClone(input);
  const applied: string[] = [];
  const seen = new Set<string>();

  while (current.schemaVersion !== targetVersion) {
    const version = typeof current.schemaVersion === 'string' ? current.schemaVersion : 'unversioned';
    if (seen.has(version)) throw new Error(`Migration cycle detected at ${version}.`);
    seen.add(version);

    const migration = migrations.find((candidate) => candidate.from === version);
    if (!migration) throw new Error(`No migration path from ${version} to ${targetVersion}.`);
    current = migration.migrate(current);
    current.schemaVersion = migration.to;
    applied.push(`${migration.from} -> ${migration.to}`);
  }

  return {
    value: strictParse(current),
    migrationsApplied: applied,
  };
}

export function assertJsonComplexity(
  input: string,
  limits: { maxBytes: number; maxDepth: number },
): unknown {
  const bytes = new TextEncoder().encode(input).byteLength;
  if (bytes > limits.maxBytes) {
    throw new Error(`File is too large (${bytes} bytes; max ${limits.maxBytes}).`);
  }
  const parsed = JSON.parse(input) as unknown;
  if (measureDepth(parsed) > limits.maxDepth) {
    throw new Error(`JSON nesting exceeds ${limits.maxDepth}.`);
  }
  return parsed;
}

function measureDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth;
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, measureDepth(item, depth + 1)), depth + 1);
  }
  return Object.values(value as Record<string, unknown>)
    .reduce<number>((max, item) => Math.max(max, measureDepth(item, depth + 1)), depth + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
