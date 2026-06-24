import type { JsonPatchOperation } from './diagnostics.js';

export interface PatchResult<T> {
  value: T;
  applied: JsonPatchOperation[];
}

export function applyJsonPatch<T>(input: T, operations: readonly JsonPatchOperation[]): PatchResult<T> {
  const value = structuredClone(input) as T;
  for (const operation of operations) {
    applyOperation(value as unknown, operation);
  }
  return { value, applied: [...operations] };
}

function applyOperation(root: unknown, operation: JsonPatchOperation): void {
  if (operation.op === 'test') {
    const current = readPointer(root, operation.path);
    if (JSON.stringify(current) !== JSON.stringify(operation.value)) {
      throw new Error(`Patch test failed at ${operation.path}.`);
    }
    return;
  }

  if (operation.op === 'copy') {
    writePointer(root, operation.path, structuredClone(readPointer(root, operation.from)));
    return;
  }

  if (operation.op === 'move') {
    const moved = readPointer(root, operation.from);
    removePointer(root, operation.from);
    writePointer(root, operation.path, moved);
    return;
  }

  if (operation.op === 'remove') {
    removePointer(root, operation.path);
    return;
  }

  writePointer(root, operation.path, operation.value, operation.op);
}

export function readPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  const parts = pointerParts(pointer);
  let current = root as Record<string, unknown> | unknown[];
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = part === '-' ? current.length : Number(part);
      current = current[index] as Record<string, unknown> | unknown[];
    } else {
      current = (current as Record<string, unknown>)[part] as Record<string, unknown> | unknown[];
    }
    if (current === undefined) throw new Error(`JSON Pointer not found: ${pointer}`);
  }
  return current;
}

function writePointer(root: unknown, pointer: string, value: unknown, op: 'add' | 'replace' = 'add'): void {
  const { parent, key } = pointerParent(root, pointer);
  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    if (op === 'replace') parent[index] = value;
    else parent.splice(index, 0, value);
    return;
  }
  if (op === 'replace' && !(key in parent)) throw new Error(`Cannot replace missing path: ${pointer}`);
  parent[key] = value;
}

function removePointer(root: unknown, pointer: string): void {
  const { parent, key } = pointerParent(root, pointer);
  if (Array.isArray(parent)) {
    parent.splice(Number(key), 1);
    return;
  }
  delete parent[key];
}

function pointerParent(root: unknown, pointer: string): { parent: Record<string, unknown> | unknown[]; key: string } {
  const parts = pointerParts(pointer);
  const key = parts.pop();
  if (!key) throw new Error('Patch path must not be the document root.');
  const parent = parts.reduce<unknown>((current, part) => {
    if (Array.isArray(current)) return current[Number(part)];
    return (current as Record<string, unknown>)[part];
  }, root) as Record<string, unknown> | unknown[];
  if (!parent || typeof parent !== 'object') throw new Error(`Patch parent not found: ${pointer}`);
  return { parent, key };
}

function pointerParts(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}
