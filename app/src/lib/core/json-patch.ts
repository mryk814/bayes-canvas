import type { JsonPatchOperation } from './diagnostics.js';

export interface PatchResult<T> {
  value: T;
  applied: JsonPatchOperation[];
}

export function applyJsonPatch<T>(input: T, operations: readonly JsonPatchOperation[]): PatchResult<T> {
  const value = structuredClone(input) as T;
  for (const operation of operations) {
    validateOperation(value as unknown, operation);
    applyOperation(value as unknown, operation);
  }
  return { value, applied: [...operations] };
}

export function validateJsonPatchOperations(root: unknown, operations: readonly JsonPatchOperation[]): void {
  const sandbox = structuredClone(root);
  for (const operation of operations) {
    validateOperation(sandbox, operation);
    applyOperation(sandbox, operation);
  }
}

function validateOperation(root: unknown, operation: JsonPatchOperation): void {
  if (!operation || typeof operation !== 'object') throw new Error('Patch operation must be an object.');
  const op = (operation as { op?: unknown }).op;
  if (typeof op !== 'string' || !['add', 'remove', 'replace', 'move', 'copy', 'test'].includes(op)) {
    throw new Error(`Unsupported patch operation: ${String(op)}`);
  }
  if (operation.path === '') throw new Error('Patch path must not be the document root.');

  if (operation.op === 'move' || operation.op === 'copy') {
    if (!operation.from) throw new Error(`${operation.op} operation is missing from.`);
    readPointer(root, operation.from);
  }
  if (operation.op === 'remove' || operation.op === 'replace' || operation.op === 'test') {
    readPointer(root, operation.path);
  }
  if (operation.op === 'add' || operation.op === 'replace' || operation.op === 'test') {
    if (!('value' in (operation as Record<string, unknown>))) throw new Error(`${operation.op} operation is missing value.`);
  }

  const { parent, key } = pointerParent(root, operation.path);
  if (Array.isArray(parent)) {
    if (key === '-' && operation.op === 'add') return;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid array index in patch path: ${operation.path}`);
    const max = operation.op === 'add' ? parent.length : parent.length - 1;
    if (index > max) throw new Error(`Array index out of range in patch path: ${operation.path}`);
  }
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
    if (key === '-') throw new Error(`Cannot remove append position: ${pointer}`);
    parent.splice(Number(key), 1);
    return;
  }
  if (!(key in parent)) throw new Error(`Cannot remove missing path: ${pointer}`);
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
