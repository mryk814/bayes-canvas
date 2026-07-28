import { useCallback, useState } from 'react';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { deriveCanvasModel } from '../lib/canvasCompiler';
import { parseImportJsonText } from '../lib/importText';
import { isPortablePackageImportCandidate, previewPortablePackageImport, type PortablePackageImportPreview } from '../lib/portableImport';
import type { BayesNodeData } from '../lib/modelIr';

export interface CanvasState {
  nodes: Node<BayesNodeData>[];
  edges: Edge[];
}

export interface PendingImportState {
  sourceName: string;
  sourceKind: 'legacy canvas' | 'portable package';
  nodes: Node<BayesNodeData>[];
  edges: Edge[];
  summary: string;
  importWarnings: string[];
  diagnostics: number;
  blockingDiagnostics: number;
  preview?: PortablePackageImportPreview;
}

export function useImportPreview(
  prepareNode: (node: Node<BayesNodeData>) => Node<BayesNodeData>,
  limits: { maxBytes: number; maxDepth: number },
) {
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(null);

  const parseText = useCallback((
    sourceName: string,
    input: string,
  ): PendingImportState => {
    const parsed = parseImportJsonText(input, limits);
    return buildPendingImport(parsed, sourceName, prepareNode);
  }, [limits, prepareNode]);

  const parseFile = useCallback((file: File): Promise<PendingImportState> => new Promise((resolve, reject) => {
    if (file.size > limits.maxBytes) {
      reject(new Error(`ファイルが大きすぎます。上限は ${Math.round(limits.maxBytes / 1024)}KB です。`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseText(file.name, String(reader.result)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('JSON形式が正しくありません。'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めませんでした。'));
    reader.readAsText(file);
  }), [limits, parseText]);

  return { pendingImport, setPendingImport, parseFile, parseText };
}

function buildPendingImport(
  parsed: unknown,
  sourceName: string,
  prepareNode: (node: Node<BayesNodeData>) => Node<BayesNodeData>,
): PendingImportState {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Bayes CanvasのJSONオブジェクトではありません。');
  }
  const modelFile = parsed as Partial<CanvasState>;
  if (isPortablePackageImportCandidate(parsed)) {
    const preview = previewPortablePackageImport(parsed);
    return {
      sourceName,
      sourceKind: 'portable package',
      nodes: preview.projected.nodes.map(prepareNode),
      edges: preview.projected.edges.map(prepareEdge),
      summary: preview.summary,
      importWarnings: preview.importWarnings,
      diagnostics: preview.semantic.diagnostics.length,
      blockingDiagnostics: preview.semantic.diagnostics.filter((diagnostic) => diagnostic.blocksHandoff).length,
      preview,
    };
  }
  if (!Array.isArray(modelFile.nodes) || !Array.isArray(modelFile.edges)) {
    throw new Error('必須field `nodes` / `edges` または portable package の `model` / `files.model.json` がありません。');
  }
  const legacyNodes = modelFile.nodes.map(prepareNode);
  const legacySemantic = deriveCanvasModel(legacyNodes, modelFile.edges).semantic;
  return {
    sourceName,
    sourceKind: 'legacy canvas',
    nodes: legacyNodes,
    edges: modelFile.edges.map(prepareEdge),
    summary: `${modelFile.nodes.length} nodes / ${modelFile.edges.length} links`,
    importWarnings: [],
    diagnostics: legacySemantic.diagnostics.length,
    blockingDiagnostics: legacySemantic.diagnostics.filter((diagnostic) => diagnostic.blocksHandoff).length,
  };
}

function prepareEdge(edge: Edge): Edge {
  return {
    ...edge,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
  };
}
