import type { ModelDocument, ModelEntity } from './model.js';

export type SemanticDiffKind =
  | 'entity_added'
  | 'entity_removed'
  | 'entity_symbol_changed'
  | 'entity_distribution_changed'
  | 'entity_expression_changed'
  | 'axis_changed'
  | 'plate_changed'
  | 'note_changed'
  | 'macro_changed';

export interface SemanticDiffItem {
  kind: SemanticDiffKind;
  path: string;
  label: string;
  before?: unknown;
  after?: unknown;
  entityId?: string;
}

export function diffModelDocuments(before: ModelDocument, after: ModelDocument): SemanticDiffItem[] {
  return [
    ...diffRecords('/axes', before.axes, after.axes, 'axis_changed'),
    ...diffRecords('/plates', before.plates, after.plates, 'plate_changed'),
    ...diffEntities(before.entities, after.entities),
    ...diffRecords('/notes', before.notes, after.notes, 'note_changed'),
    ...diffRecords('/macros', before.macros ?? {}, after.macros ?? {}, 'macro_changed'),
  ];
}

function diffEntities(before: Record<string, ModelEntity>, after: Record<string, ModelEntity>): SemanticDiffItem[] {
  const output: SemanticDiffItem[] = [];
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of ids) {
    const left = before[id];
    const right = after[id];
    if (!left && right) {
      output.push({ kind: 'entity_added', path: `/entities/${id}`, label: `Added ${right.symbol}`, after: summarizeEntity(right), entityId: id });
      continue;
    }
    if (left && !right) {
      output.push({ kind: 'entity_removed', path: `/entities/${id}`, label: `Removed ${left.symbol}`, before: summarizeEntity(left), entityId: id });
      continue;
    }
    if (!left || !right) continue;
    if (left.symbol !== right.symbol) {
      output.push({ kind: 'entity_symbol_changed', path: `/entities/${id}/symbol`, label: `Renamed ${left.symbol} to ${right.symbol}`, before: left.symbol, after: right.symbol, entityId: id });
    }
    if (left.kind === 'random_variable' && right.kind === 'random_variable') {
      if (JSON.stringify(left.distribution) !== JSON.stringify(right.distribution)) {
        output.push({ kind: 'entity_distribution_changed', path: `/entities/${id}/distribution`, label: `Changed distribution for ${right.symbol}`, before: left.distribution, after: right.distribution, entityId: id });
      }
    }
    if ('expression' in left && 'expression' in right && JSON.stringify(left.expression) !== JSON.stringify(right.expression)) {
      output.push({ kind: 'entity_expression_changed', path: `/entities/${id}/expression`, label: `Changed expression for ${right.symbol}`, before: left.expression, after: right.expression, entityId: id });
    }
  }
  return output;
}

function diffRecords<T>(
  basePath: string,
  before: Record<string, T>,
  after: Record<string, T>,
  kind: SemanticDiffKind,
): SemanticDiffItem[] {
  const output: SemanticDiffItem[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    output.push({
      kind,
      path: `${basePath}/${key}`,
      label: `${kind.replaceAll('_', ' ')}: ${key}`,
      before: before[key],
      after: after[key],
    });
  }
  return output;
}

function summarizeEntity(entity: ModelEntity): Record<string, unknown> {
  return {
    id: entity.id,
    kind: entity.kind,
    symbol: entity.symbol,
    plateIds: entity.plateIds,
  };
}
