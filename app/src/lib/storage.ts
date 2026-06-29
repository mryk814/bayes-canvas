import type { LayoutDocument, ModelDocument } from './core/model.js';

export interface StoredSnapshot {
  id: string;
  name: string;
  savedAt: string;
  document: ModelDocument;
  layout: LayoutDocument;
}

export interface TransactionLogEntry {
  id: string;
  createdAt: string;
  kind: 'autosave' | 'snapshot' | 'import' | 'patch' | 'delete' | 'undo';
  summary: string;
  modelDocumentId: string;
  revision: number;
}

export type StorageFailureKind = 'autosave-body' | 'transaction-log' | 'snapshot';

export interface StorageWriteResult {
  ok: boolean;
  failureKind?: StorageFailureKind;
  quotaExceeded?: boolean;
  message?: string;
}

const DB_NAME = 'bayes-canvas';
const DB_VERSION = 1;
const MAX_AUTOSAVE_TRANSACTIONS = 120;

export async function saveAutosave(document: ModelDocument, layout: LayoutDocument): Promise<StorageWriteResult> {
  const db = await openDatabase();
  try {
    await put(db, 'autosave', { id: document.documentId, document, layout, savedAt: new Date().toISOString() });
  } catch (error) {
    return {
      ok: false,
      failureKind: 'autosave-body',
      quotaExceeded: isQuotaError(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    await addTransaction(db, {
      kind: 'autosave',
      summary: 'Autosaved current model.',
      modelDocumentId: document.documentId,
      revision: document.revision,
    });
    await pruneAutosaveTransactions(db);
  } catch (error) {
    if (isQuotaError(error)) {
      await pruneAutosaveTransactions(db, Math.floor(MAX_AUTOSAVE_TRANSACTIONS / 2));
      return {
        ok: true,
        failureKind: 'transaction-log',
        quotaExceeded: true,
        message: 'Autosave succeeded, but transaction log quota was exceeded and old autosave log rows were pruned.',
      };
    }
    return {
      ok: true,
      failureKind: 'transaction-log',
      quotaExceeded: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true };
}

export async function saveSnapshot(snapshot: StoredSnapshot): Promise<StorageWriteResult> {
  const db = await openDatabase();
  try {
    await put(db, 'snapshots', snapshot);
    await addTransaction(db, {
      kind: 'snapshot',
      summary: `Saved snapshot ${snapshot.name}.`,
      modelDocumentId: snapshot.document.documentId,
      revision: snapshot.document.revision,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      failureKind: 'snapshot',
      quotaExceeded: isQuotaError(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadAutosave(documentId: string): Promise<StoredSnapshot | null> {
  const db = await openDatabase();
  return get(db, 'autosave', documentId);
}

export async function loadLatestAutosave(): Promise<StoredSnapshot | null> {
  const db = await openDatabase();
  const snapshots = await getAll<StoredSnapshot>(db, 'autosave');
  return snapshots.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null;
}

export async function listTransactions(limit = 50): Promise<TransactionLogEntry[]> {
  const db = await openDatabase();
  return getAll<TransactionLogEntry>(db, 'transactions').then((rows) =>
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit),
  );
}

export async function cleanupOldAutosaveData(): Promise<number> {
  const db = await openDatabase();
  const transactions = await getAll<TransactionLogEntry>(db, 'transactions');
  const autosaveTransactions = transactions
    .filter((entry) => entry.kind === 'autosave')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const staleTransactionIds = autosaveTransactions.slice(Math.floor(MAX_AUTOSAVE_TRANSACTIONS / 3)).map((entry) => entry.id);
  await deleteMany(db, 'transactions', staleTransactionIds);
  return staleTransactionIds.length;
}

async function addTransaction(
  db: IDBDatabase,
  entry: Omit<TransactionLogEntry, 'id' | 'createdAt'>,
): Promise<void> {
  await put(db, 'transactions', {
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  });
}

async function pruneAutosaveTransactions(db: IDBDatabase, limit = MAX_AUTOSAVE_TRANSACTIONS): Promise<void> {
  const rows = (await getAll<TransactionLogEntry>(db, 'transactions'))
    .filter((entry) => entry.kind === 'autosave')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const stale = rows.slice(limit);
  if (!stale.length) return;
  await deleteMany(db, 'transactions', stale.map((entry) => entry.id));
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('transactions')) db.createObjectStore('transactions', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function put<T>(db: IDBDatabase, storeName: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function get<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function deleteMany(db: IDBDatabase, storeName: string, keys: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const key of keys) {
      store.delete(key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
