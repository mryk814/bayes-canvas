import type { compileModel } from './core/compiler.js';
import type { LayoutDocument, ModelDocument } from './core/model.js';
import type { PortableCanvasEdge } from './core/portable.js';

export type { PortableCanvasEdge } from './core/portable.js';

export interface EdgeResolutionResult {
  source: 'canvasEdges.json' | 'model extension' | 'semantic reconstruction';
  declared: number;
  edges: PortableCanvasEdge[];
  warnings: string[];
}

export function resolveImportEdges(
  document: ModelDocument,
  layout: LayoutDocument,
  semantic: ReturnType<typeof compileModel>,
  canvasEdgesFile: unknown,
): EdgeResolutionResult {
  if (canvasEdgesFile !== undefined) {
    const edges = parseCanvasEdgesJsonFile(canvasEdgesFile);
    validateCanvasEdges(edges, document, 'canvasEdges.json');
    if (!edges.length) {
      const reconstructed = reconstructSemanticEdges(document, layout, semantic);
      if (reconstructed.length) {
        return {
          source: 'semantic reconstruction',
          declared: 0,
          edges: reconstructed,
          warnings: [
            `canvasEdges.json declared 0 visual links, so ${reconstructed.length} links were reconstructed from semantic dependencies.`,
          ],
        };
      }
    }
    return { source: 'canvasEdges.json', declared: edges.length, edges, warnings: [] };
  }

  const extension = document.extensions?.['bayes-canvas'] as { annotationEdges?: PortableCanvasEdge[] } | undefined;
  if (extension?.annotationEdges) {
    validateCanvasEdges(extension.annotationEdges, document, 'model.json/extensions/bayes-canvas/annotationEdges');
    if (!extension.annotationEdges.length) {
      const reconstructed = reconstructSemanticEdges(document, layout, semantic);
      if (reconstructed.length) {
        return {
          source: 'semantic reconstruction',
          declared: 0,
          edges: reconstructed,
          warnings: [
            `bayes-canvas.annotationEdges declared 0 visual links, so ${reconstructed.length} links were reconstructed from semantic dependencies.`,
          ],
        };
      }
    }
    return {
      source: 'model extension',
      declared: extension.annotationEdges.length,
      edges: extension.annotationEdges,
      warnings: [],
    };
  }

  const edges = reconstructSemanticEdges(document, layout, semantic);
  return {
    source: 'semantic reconstruction',
    declared: 0,
    edges,
    warnings: [
      `canvasEdges.json and bayes-canvas.annotationEdges were missing, so ${edges.length} visual links were reconstructed from semantic dependencies.`,
    ],
  };
}

export function reconstructSemanticEdges(
  document: ModelDocument,
  layout: LayoutDocument,
  semantic: ReturnType<typeof compileModel>,
): PortableCanvasEdge[] {
  const visibleEntityIds = new Set(projectableEntityIds(document, layout));
  return semantic.dependencyEdges
    .filter((edge) => visibleEntityIds.has(edge.from) && visibleEntityIds.has(edge.to))
    .map((edge) => ({
      id: `semantic-${edge.from}-${edge.to}`,
      from: edge.from,
      to: edge.to,
      role: `semantic-${edge.role}`,
    }));
}

export function projectableEntityIds(document: ModelDocument, layout: LayoutDocument): string[] {
  return document.entityOrder
    .filter((entityId) => document.entities[entityId])
    .filter((entityId) => document.entities[entityId].authorship !== 'generated')
    .filter((entityId) => !layout.hiddenEntityIds?.includes(entityId));
}

function parseCanvasEdgesJsonFile(value: unknown): PortableCanvasEdge[] {
  const parsed = parseJsonLike(value, 'canvasEdges.json');
  const edgeValue = isRecord(parsed) && Array.isArray(parsed.edges) ? parsed.edges : parsed;
  if (!Array.isArray(edgeValue)) {
    throw new Error('canvasEdges.json must contain a JSON array.');
  }

  try {
    return edgeValue.map((edge, index) => {
      if (!isRecord(edge)) {
        throw new Error(`canvasEdges.json/${index}: Edge must be an object.`);
      }
      if (typeof edge.id !== 'string' || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
        throw new Error(`canvasEdges.json/${index}: Edge id, from, and to must be strings.`);
      }
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        role: typeof edge.role === 'string' && edge.role.trim() ? edge.role : 'dependency',
      };
    });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('canvasEdges.json is not valid JSON.');
  }
}

function validateCanvasEdges(edges: PortableCanvasEdge[], document: ModelDocument, scope: string): void {
  const ids = new Set<string>();
  const issues: string[] = [];
  edges.forEach((edge, index) => {
    if (ids.has(edge.id)) issues.push(`${scope}/${index}/id: Duplicate edge id "${edge.id}".`);
    ids.add(edge.id);
    if (!document.entities[edge.from]) issues.push(`${scope}/${index}/from: Unknown entity "${edge.from}".`);
    if (!document.entities[edge.to]) issues.push(`${scope}/${index}/to: Unknown entity "${edge.to}".`);
  });
  if (issues.length) {
    throw new Error(`Portable package validation failed: ${issues.join(' / ')}`);
  }
}

function parseJsonLike(value: unknown, fileName: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${fileName} is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
