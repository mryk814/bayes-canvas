import type { ModelDocument, ModelEntity } from './model.js';

export type SemanticDiffKind =
  | 'entity_added'
  | 'entity_removed'
  | 'entity_symbol_changed'
  | 'entity_value_type_changed'
  | 'entity_plate_scope_changed'
  | 'entity_distribution_changed'
  | 'entity_expression_changed'
  | 'observation_binding_changed'
  | 'observation_process_changed'
  | 'constraint_changed'
  | 'hint_changed'
  | 'query_contract_changed'
  | 'block_contract_changed'
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
  severity?: 'info' | 'warning' | 'critical';
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
    if (JSON.stringify(left.valueType) !== JSON.stringify(right.valueType)) {
      output.push(change('entity_value_type_changed', id, '/valueType', `Changed value type for ${right.symbol}`, left.valueType, right.valueType, 'critical'));
    }
    if (JSON.stringify(left.plateIds) !== JSON.stringify(right.plateIds)) {
      output.push(change('entity_plate_scope_changed', id, '/plateIds', `Changed plate scope for ${right.symbol}`, left.plateIds, right.plateIds, 'critical'));
    }
    if (left.kind === 'random_variable' && right.kind === 'random_variable') {
      if (JSON.stringify(left.distribution) !== JSON.stringify(right.distribution)) {
        output.push({ kind: 'entity_distribution_changed', path: `/entities/${id}/distribution`, label: `Changed distribution for ${right.symbol}`, before: left.distribution, after: right.distribution, entityId: id });
      }
      if (left.observedDataId !== right.observedDataId) {
        output.push(change('observation_binding_changed', id, '/observedDataId', `Changed observation binding for ${right.symbol}`, left.observedDataId, right.observedDataId, 'critical'));
      }
      if (JSON.stringify(left.observationProcess) !== JSON.stringify(right.observationProcess)) {
        output.push(change('observation_process_changed', id, '/observationProcess', `Changed observation process for ${right.symbol}`, left.observationProcess, right.observationProcess, 'critical'));
      }
      if (JSON.stringify(left.constraints) !== JSON.stringify(right.constraints)) {
        output.push(change('constraint_changed', id, '/constraints', `Changed constraints for ${right.symbol}`, left.constraints, right.constraints, 'warning'));
      }
      if (JSON.stringify(left.hints) !== JSON.stringify(right.hints)) {
        output.push(change('hint_changed', id, '/hints', `Changed implementation hints for ${right.symbol}`, left.hints, right.hints, 'info'));
      }
    }
    if ('expression' in left && 'expression' in right && JSON.stringify(left.expression) !== JSON.stringify(right.expression)) {
      output.push({ kind: 'entity_expression_changed', path: `/entities/${id}/expression`, label: `Changed expression for ${right.symbol}`, before: left.expression, after: right.expression, entityId: id });
    }
    if (left.kind === 'query' && right.kind === 'query') {
      if (left.queryRole !== right.queryRole || left.scale !== right.scale) {
        output.push(change('query_contract_changed', id, '/queryRole', `Changed query contract for ${right.symbol}`, { queryRole: left.queryRole, scale: left.scale }, { queryRole: right.queryRole, scale: right.scale }, 'warning'));
      }
    }
    if (left.kind === 'block_instance' && right.kind === 'block_instance') {
      if (
        left.blockTypeId !== right.blockTypeId
        || left.blockVersion !== right.blockVersion
        || JSON.stringify(left.inputs) !== JSON.stringify(right.inputs)
        || JSON.stringify(left.outputs) !== JSON.stringify(right.outputs)
        || JSON.stringify(left.config) !== JSON.stringify(right.config)
      ) {
        output.push(change(
          'block_contract_changed',
          id,
          '/block',
          `Changed block contract for ${right.symbol}`,
          summarizeBlock(left),
          summarizeBlock(right),
          'critical',
        ));
      }
    }
  }
  return output;
}

function change(
  kind: SemanticDiffKind,
  entityId: string,
  suffix: string,
  label: string,
  before: unknown,
  after: unknown,
  severity: SemanticDiffItem['severity'],
): SemanticDiffItem {
  return {
    kind,
    path: `/entities/${entityId}${suffix}`,
    label,
    before,
    after,
    entityId,
    severity,
  };
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

function summarizeBlock(entity: Extract<ModelEntity, { kind: 'block_instance' }>): Record<string, unknown> {
  return {
    blockTypeId: entity.blockTypeId,
    blockVersion: entity.blockVersion,
    inputs: entity.inputs,
    outputs: entity.outputs,
    config: entity.config,
  };
}
