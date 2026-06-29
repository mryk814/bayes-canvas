import type { SourceSpan } from './expression.js';

export type DiagnosticStage =
  | 'schema'
  | 'migration'
  | 'syntax'
  | 'binding'
  | 'type'
  | 'shape'
  | 'support'
  | 'graph'
  | 'statistical'
  | 'portability'
  | 'handoff';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticCertainty = 'certain' | 'likely' | 'heuristic';

export type JsonPatchOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

export interface RelatedLocation {
  message: string;
  path: string;
  range?: SourceSpan;
}

export interface DiagnosticFix {
  id: string;
  title: string;
  kind: 'quickfix' | 'refactor' | 'source_action';
  expectedRevision: number;
  patch: JsonPatchOperation[];
  isPreferred?: boolean;
}

export interface Diagnostic {
  /** Stable machine-readable rule code, e.g. BC-SYMBOL-001. */
  code: string;
  ruleVersion: string;
  stage: DiagnosticStage;
  severity: DiagnosticSeverity;
  certainty: DiagnosticCertainty;
  message: string;
  /** JSON Pointer into the authoring document. */
  path: string;
  /** Original generated path when a lowered macro diagnostic was remapped. */
  generatedPath?: string;
  /** Editable macro source path when a lowered diagnostic can be repaired in a macro field. */
  sourceMacroPath?: string;
  /** User-facing editable path for review panels and handoff reports. */
  displayPath?: string;
  range?: SourceSpan;
  related?: RelatedLocation[];
  fixes?: DiagnosticFix[];
  blocksHandoff: boolean;
  documentationKey?: string;
}

export function diagnostic(
  value: Omit<Diagnostic, 'ruleVersion' | 'certainty'> &
    Partial<Pick<Diagnostic, 'ruleVersion' | 'certainty'>>,
): Diagnostic {
  return {
    ruleVersion: value.ruleVersion ?? '1.0.0',
    certainty: value.certainty ?? 'certain',
    ...value,
  };
}

export function summarizeDiagnostics(diagnostics: readonly Diagnostic[]): {
  errors: number;
  warnings: number;
  infos: number;
  handoffBlocked: boolean;
} {
  return {
    errors: diagnostics.filter((item) => item.severity === 'error').length,
    warnings: diagnostics.filter((item) => item.severity === 'warning').length,
    infos: diagnostics.filter((item) => item.severity === 'info').length,
    handoffBlocked: diagnostics.some((item) => item.blocksHandoff),
  };
}
