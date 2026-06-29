import { useCallback, useState } from 'react';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { deriveCanvasModel } from '../lib/canvasCompiler';
import { assertJsonComplexity } from '../lib/core/migrations';
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

  const parseFile = useCallback((file: File): Promise<PendingImportState> => new Promise((resolve, reject) => {
    if (file.size > limits.maxBytes) {
      reject(new Error(`ファイルが大きすぎます。上限は ${Math.round(limits.maxBytes / 1024)}KB です。`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseImportJsonText(String(reader.result), limits);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('Bayes CanvasのJSONオブジェクトではありません。'));
          return;
        }
        const modelFile = parsed as Partial<CanvasState>;
        if (isPortablePackageImportCandidate(parsed)) {
          const preview = previewPortablePackageImport(parsed);
          resolve({
            sourceName: file.name,
            sourceKind: 'portable package',
            nodes: preview.projected.nodes.map(prepareNode),
            edges: preview.projected.edges.map(prepareEdge),
            summary: preview.summary,
            importWarnings: preview.importWarnings,
            diagnostics: preview.semantic.diagnostics.length,
            blockingDiagnostics: preview.semantic.diagnostics.filter((diagnostic) => diagnostic.blocksHandoff).length,
            preview,
          });
          return;
        }
        if (!Array.isArray(modelFile.nodes) || !Array.isArray(modelFile.edges)) {
          reject(new Error('必須field `nodes` / `edges` または portable package の `model` / `files.model.json` がありません。'));
          return;
        }
        const legacyNodes = modelFile.nodes.map(prepareNode);
        const legacySemantic = deriveCanvasModel(legacyNodes, modelFile.edges).semantic;
        resolve({
          sourceName: file.name,
          sourceKind: 'legacy canvas',
          nodes: legacyNodes,
          edges: modelFile.edges.map(prepareEdge),
          summary: `${modelFile.nodes.length} nodes / ${modelFile.edges.length} links`,
          importWarnings: [],
          diagnostics: legacySemantic.diagnostics.length,
          blockingDiagnostics: legacySemantic.diagnostics.filter((diagnostic) => diagnostic.blocksHandoff).length,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('JSON形式が正しくありません。'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めませんでした。'));
    reader.readAsText(file);
  }), [limits, prepareNode]);

  return { pendingImport, setPendingImport, parseFile };
}

function parseImportJsonText(input: string, limits: { maxBytes: number; maxDepth: number }): unknown {
  try {
    return assertJsonComplexity(input, limits);
  } catch (error) {
    if (error instanceof Error && (error.message.includes('too large') || error.message.includes('nesting'))) {
      throw error;
    }
    const extracted = extractImportJsonPayload(input);
    if (extracted === input.trim()) throw error;
    return assertJsonComplexity(extracted, limits);
  }
}

function extractImportJsonPayload(input: string): string {
  const trimmed = input.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  if (fenced) return fenced[1].trim();
  const firstObject = trimmed.indexOf('{');
  const firstArray = trimmed.indexOf('[');
  const first = [firstObject, firstArray].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return trimmed;
  const opener = trimmed[first];
  const closer = opener === '{' ? '}' : ']';
  const last = trimmed.lastIndexOf(closer);
  return last > first ? trimmed.slice(first, last + 1).trim() : trimmed;
}

function prepareEdge(edge: Edge): Edge {
  return {
    ...edge,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
  };
}
