import { useCallback, useEffect, useState } from 'react';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { projectToReactFlow } from '../lib/reactFlowProjection';
import { cleanupOldAutosaveData, loadLatestAutosave, saveAutosave, type StoredSnapshot } from '../lib/storage';
import type { LayoutDocument, ModelDocument } from '../lib/core/model';
import type { BayesNodeData } from '../lib/modelIr';

export interface RestorePromptState {
  snapshot: StoredSnapshot;
  nodes: Node<BayesNodeData>[];
  edges: Edge[];
  summary: string;
}

export interface AutosaveNotice {
  title: string;
  detail: string;
  recovery?: 'autosave-quota' | 'autosave-transaction';
}

export function useAutosaveRestore(
  document: ModelDocument,
  layout: LayoutDocument,
  prepareNode: (node: Node<BayesNodeData>) => Node<BayesNodeData>,
  onNotice: (notice: AutosaveNotice) => void,
) {
  const [restorePrompt, setRestorePrompt] = useState<RestorePromptState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLatestAutosave()
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        const projected = projectToReactFlow({
          document: snapshot.document,
          layout: snapshot.layout,
        });
        setRestorePrompt({
          snapshot,
          nodes: projected.nodes.map(prepareNode),
          edges: projected.edges.map((edge: Edge) => ({
            ...edge,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
          })),
          summary: `${projected.nodes.length} nodes / ${projected.edges.length} links / ${new Date(snapshot.savedAt).toLocaleString()}`,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        onNotice({
          title: '自動保存を確認できません',
          detail: error instanceof Error ? error.message : 'IndexedDBの復元候補を読み込めませんでした。',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [onNotice, prepareNode]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void saveAutosave(document, layout).then((result) => {
        if (cancelled) return;
        if (result.ok && !result.failureKind) return;
        if (result.ok && result.failureKind === 'transaction-log') {
          onNotice({
            title: '自動保存の記録だけ失敗しました',
            detail: result.message ?? 'モデル本体は保存されています。古い記録を削除すると次回以降の記録を再開できます。',
            recovery: 'autosave-transaction',
          });
          return;
        }
        onNotice({
          title: '自動保存に失敗しました',
          detail: result.quotaExceeded
            ? 'IndexedDBの容量上限に達しました。古い自動保存記録を削除するか、現在のモデルをPackageとして書き出してください。'
            : result.message ?? 'IndexedDBへ保存できませんでした。',
          recovery: result.quotaExceeded ? 'autosave-quota' : undefined,
        });
      }).catch((error) => {
        if (cancelled) return;
        onNotice({
          title: '自動保存に失敗しました',
          detail: error instanceof Error ? error.message : 'IndexedDBへ保存できませんでした。',
        });
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [document, layout, onNotice]);

  const cleanupAutosaveRecovery = useCallback(() => cleanupOldAutosaveData(), []);

  return { restorePrompt, setRestorePrompt, cleanupAutosaveRecovery };
}
