import { useCallback, useEffect, useMemo, useState } from 'react';
import { compileModel } from '../lib/core/compiler';
import type { JsonPatchOperation } from '../lib/core/diagnostics';
import { createStableFingerprint } from '../lib/core/fingerprint';
import { applyJsonPatch } from '../lib/core/json-patch';
import type { LayoutDocument, ModelDocument } from '../lib/core/model';
import { InMemoryDistributionRegistry } from '../lib/core/registry';
import { compileCanvas } from '../lib/canvasProjector';
import { DISTRIBUTIONS, toCompilerDistributionDefinition } from '../lib/distributionRegistry';
import { initialEdges, initialNodes } from '../samples/hierarchicalRegression';

const STORAGE_KEY = 'bayes-canvas:score:document';
const HISTORY_LIMIT = 60;

export const registry = new InMemoryDistributionRegistry(DISTRIBUTIONS.map(toCompilerDistributionDefinition));

export function compile(document: ModelDocument) {
  return compileModel(document, registry, { compilerVersion: '0.2.0', targetBackend: 'review' });
}

export function fingerprintOf(document: ModelDocument): string {
  return createStableFingerprint(document).value;
}

interface Stored {
  document: ModelDocument;
  layout: LayoutDocument;
}

function seed(): Stored {
  const snapshot = compileCanvas(initialNodes, initialEdges);
  return { document: snapshot.document, layout: snapshot.layout };
}

function load(): { value: Stored; restored: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Stored;
      if (parsed?.document?.entities && parsed.layout) return { value: parsed, restored: true };
    }
  } catch {
    // Unreadable storage falls back to the sample; the stored value is left untouched.
  }
  return { value: seed(), restored: false };
}

export function patchDocument(document: ModelDocument, operations: readonly JsonPatchOperation[]): ModelDocument {
  const result = applyJsonPatch(document, operations);
  return { ...result.value, revision: document.revision + 1 };
}

export interface Change {
  label: string;
  document: ModelDocument;
}

export function useScoreDocument() {
  const [initial] = useState(load);
  const [current, setCurrent] = useState<Stored>(initial.value);
  const [past, setPast] = useState<Change[]>([]);
  const [future, setFuture] = useState<Change[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      setSaveError(null);
    } catch {
      setSaveError('ブラウザへ保存できません。「書き出し」からJSONを保存してください。');
    }
  }, [current]);

  /** Replace the document with a validated next version. Throws if the patch is invalid. */
  const commit = useCallback((label: string, next: ModelDocument, layout?: LayoutDocument) => {
    setCurrent((previous) => {
      setPast((list) => [...list.slice(-HISTORY_LIMIT + 1), { label, document: previous.document }]);
      setFuture([]);
      return { document: next, layout: layout ?? { ...previous.layout, modelDocumentId: next.documentId } };
    });
  }, []);

  const apply = useCallback((label: string, operations: readonly JsonPatchOperation[]) => {
    const next = patchDocument(current.document, operations);
    commit(label, next);
    return next;
  }, [commit, current.document]);

  const undo = useCallback(() => {
    const last = past[past.length - 1];
    if (!last) return null;
    setPast(past.slice(0, -1));
    setFuture([{ label: last.label, document: current.document }, ...future]);
    setCurrent({ ...current, document: last.document });
    return last.label;
  }, [current, future, past]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return null;
    setFuture(future.slice(1));
    setPast([...past, { label: next.label, document: current.document }]);
    setCurrent({ ...current, document: next.document });
    return next.label;
  }, [current, future, past]);

  const reset = useCallback(() => {
    const fresh = seed();
    commit('サンプルに戻す', fresh.document, fresh.layout);
  }, [commit]);

  const semantic = useMemo(() => compile(current.document), [current.document]);
  const fingerprint = useMemo(() => fingerprintOf(current.document), [current.document]);

  return {
    document: current.document,
    layout: current.layout,
    semantic,
    fingerprint,
    restored: initial.restored,
    saveError,
    apply,
    commit,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undoLabel: past[past.length - 1]?.label,
    redoLabel: future[0]?.label,
  };
}
