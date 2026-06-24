import type { LoweringSourceMap, MacroInstance, ModelDocument, ModelEntity, SourceText } from './model.js';

export interface LoweringResult {
  document: ModelDocument;
  generatedEntityIds: string[];
  sourceMap: LoweringSourceMap[];
}

export function lowerMacros(document: ModelDocument): LoweringResult {
  const generated: Record<string, ModelEntity> = {};
  const sourceMap: LoweringSourceMap[] = [];

  for (const macro of Object.values(document.macros ?? {})) {
    if (macro.macroTypeId === 'horseshoe_prior') {
      const target = String(macro.bindings.target ?? macro.id);
      const scale = sourceFromBinding(macro.bindings.scale) ?? expr('tau0');
      const localId = `${macro.id}_local_scale`;
      generated[localId] = {
        id: localId,
        kind: 'random_variable',
        role: 'parameter',
        symbol: `${target}_lambda`,
        valueType: { scalar: 'real', axes: [], domain: { kind: 'positive' } },
        plateIds: [],
        distribution: { distributionId: 'halfnormal', args: { sigma: scale } },
        notes: `Lowered from macro ${macro.id}.`,
      };
      sourceMap.push({ generatedEntityId: localId, macroInstanceId: macro.id, macroFieldPath: '/bindings/scale' });
    }
  }

  return {
    document: {
      ...document,
      entities: { ...document.entities, ...generated },
      entityOrder: [...document.entityOrder, ...Object.keys(generated)],
      loweringSourceMap: [...(document.loweringSourceMap ?? []), ...sourceMap],
    },
    generatedEntityIds: Object.keys(generated),
    sourceMap,
  };
}

export function createMacroInstance(
  id: string,
  macroTypeId: string,
  bindings: MacroInstance['bindings'],
  config: Record<string, unknown> = {},
): MacroInstance {
  return {
    id,
    macroTypeId,
    macroVersion: '1.0.0',
    bindings,
    config,
    status: 'collapsed',
  };
}

function sourceFromBinding(value: string | SourceText | undefined): SourceText | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return expr(value);
  return value;
}

function expr(source: string): SourceText {
  return { language: 'bayes-expr@1', source };
}
