import { useEffect, useMemo, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { buildModelViewProjections } from '../lib/modelViewProjections';
import { buildCanvasHandoff, buildCanvasPortablePackage, compileCanvas } from '../lib/documentAdapter';
import { generateAiPromptFromDocument, generateTexFromDocument } from '../lib/documentOutputs';
import { diffModelDocuments } from '../lib/core/semantic-diff';
import type { HandoffTarget } from '../lib/core/handoff';
import type { BayesNodeData } from '../lib/modelIr';

export function useCompiledCanvas(
  nodes: Node<BayesNodeData>[],
  edges: Edge[],
  target: HandoffTarget,
  options: { needsPrompt: boolean; needsPackage: boolean },
) {
  const debouncedNodes = useDebouncedValue(nodes, 180);
  const debouncedEdges = useDebouncedValue(edges, 180);
  const compiledCanvas = useMemo(
    () => compileCanvas(debouncedNodes, debouncedEdges, target),
    [debouncedEdges, debouncedNodes, target],
  );
  const handoffBundle = useMemo(
    () => buildCanvasHandoff(debouncedNodes, debouncedEdges, target),
    [debouncedEdges, debouncedNodes, target],
  );
  const modelViewProjections = useMemo(
    () => buildModelViewProjections({
      document: compiledCanvas.document,
      semantic: compiledCanvas.semantic,
      handoff: handoffBundle,
    }),
    [compiledCanvas.document, compiledCanvas.semantic, handoffBundle],
  );
  const prompt = useMemo(
    () => options.needsPrompt
      ? generateAiPromptFromDocument(compiledCanvas.document, compiledCanvas.semantic, target)
      : '',
    [compiledCanvas.document, compiledCanvas.semantic, options.needsPrompt, target],
  );
  const fullTex = useMemo(() => generateTexFromDocument(compiledCanvas.document), [compiledCanvas.document]);
  const portablePackage = useMemo(
    () => options.needsPackage ? buildCanvasPortablePackage(debouncedNodes, debouncedEdges, target) : null,
    [debouncedEdges, debouncedNodes, options.needsPackage, target],
  );
  return {
    compiledCanvas,
    handoffBundle,
    modelViewProjections,
    prompt,
    fullTex,
    portablePackage,
    semanticDiffFrom(initialDocument: typeof compiledCanvas.document) {
      return diffModelDocuments(initialDocument, compiledCanvas.document);
    },
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [delayMs, value]);
  return debounced;
}
