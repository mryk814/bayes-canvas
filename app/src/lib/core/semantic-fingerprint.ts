import { createStableFingerprint, type StableFingerprint } from './fingerprint.js';
import type { AxisUse, Domain, ModelConstraint, ModelDocument, ModelEntity, ObservationProcess } from './model.js';

/**
 * The fingerprint of the probabilistic model alone. Two documents get the same
 * value when they describe the same joint distribution and queries, however
 * they are written down. It is an additional matching key next to the
 * implementation fingerprint (`createStableFingerprint(document)`), which keeps
 * its meaning for handoff, Evidence and Receipt.
 */
export function semanticFingerprint(document: ModelDocument): StableFingerprint {
  return createStableFingerprint(semanticProjection(document));
}

/**
 * Same probabilistic model → same projection. Excluded: revision, documentId,
 * model name/description/intent, labels, notes, tags, authorship, hints,
 * priorRationale, extensions, entity order, macro status and layout.
 * IDs are replaced with keys derived from symbols, so a generated binding
 * (`obs_y`) and an imported one (`y_data`) with the same symbol coincide.
 */
export function semanticProjection(document: ModelDocument): unknown {
  const axisKey = keyMap(Object.values(document.axes).map((axis) => [axis.id, `axis:${axis.symbol}`]));
  const plateKey = keyMap(Object.values(document.plates).map((plate) => [
    plate.id,
    `plate:${document.axes[plate.axisId]?.symbol ?? plate.axisId}:${plate.indexSymbol}`,
  ]));
  const entityKey = keyMap(Object.values(document.entities).map((entity) => [entity.id, `entity:${entity.symbol}`]));
  const axis = (id: string) => axisKey.get(id) ?? `missing:${id}`;
  const plate = (id: string) => plateKey.get(id) ?? `missing:${id}`;
  const entity = (id: string) => entityKey.get(id) ?? `missing:${id}`;

  const domain = (value: Domain | undefined): Domain | undefined => {
    if (!value || !('axisId' in value)) return value;
    return { ...value, axisId: axis(value.axisId) };
  };
  const constraint = (value: ModelConstraint): ModelConstraint => ('axisId' in value ? { ...value, axisId: axis(value.axisId) } : value);
  const observation = (value: ObservationProcess | undefined): ObservationProcess | undefined => (
    value?.kind === 'measurement_error' ? { ...value, latentTrueEntityId: entity(value.latentTrueEntityId) } : value
  );

  const project = (item: ModelEntity) => {
    const base = {
      kind: item.kind,
      symbol: item.symbol,
      valueType: {
        scalar: item.valueType.scalar,
        axes: item.valueType.axes.map((use: AxisUse) => ({ axisId: axis(use.axisId), role: use.role })),
        domain: domain(item.valueType.domain),
      },
      plateIds: item.plateIds.map(plate).sort(),
    };
    switch (item.kind) {
      case 'data':
        return { ...base, dataRole: item.dataRole, unit: item.unit, missingValuePolicy: item.missingValuePolicy };
      case 'random_variable':
        return {
          ...base,
          role: item.role,
          distribution: item.distribution,
          transform: item.transform,
          observedDataId: item.observedDataId ? entity(item.observedDataId) : undefined,
          observationProcess: observation(item.observationProcess),
          constraints: item.constraints?.map(constraint),
        };
      case 'deterministic':
        return { ...base, expression: item.expression };
      case 'factor':
        return { ...base, logDensity: item.logDensity, normalization: item.normalization };
      case 'block_instance':
        return {
          ...base,
          blockTypeId: item.blockTypeId,
          blockVersion: item.blockVersion,
          inputs: Object.fromEntries(Object.entries(item.inputs).map(([port, binding]) => [port, {
            portId: binding.portId,
            entityId: binding.entityId ? entity(binding.entityId) : undefined,
            expression: binding.expression,
          }])),
          outputs: Object.fromEntries(Object.entries(item.outputs).map(([port, id]) => [port, entity(id)])),
          config: item.config,
        };
      case 'query':
        return { ...base, queryRole: item.queryRole, expression: item.expression, scale: item.scale };
    }
  };

  return {
    schemaVersion: document.schemaVersion,
    axes: Object.fromEntries(Object.values(document.axes).map((item) => [axis(item.id), {
      size: item.size,
      coordinateDataId: item.coordinateDataId ? entity(item.coordinateDataId) : undefined,
    }])),
    plates: Object.fromEntries(Object.values(document.plates).map((item) => [plate(item.id), {
      axisId: axis(item.axisId),
      parentPlateIds: item.parentPlateIds.map(plate).sort(),
      assumption: item.assumption,
    }])),
    entities: Object.fromEntries(Object.values(document.entities).map((item) => [entity(item.id), project(item)])),
    macros: Object.values(document.macros ?? {})
      .map((macro) => ({
        macroTypeId: macro.macroTypeId,
        macroVersion: macro.macroVersion,
        bindings: Object.fromEntries(Object.entries(macro.bindings).map(([name, value]) => [
          name,
          typeof value === 'string' ? entityKey.get(value) ?? value : value,
        ])),
        config: macro.config,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

/** Symbol-derived keys; a duplicated symbol falls back to a stable per-document suffix. */
function keyMap(pairs: Array<[string, string]>): Map<string, string> {
  const seen = new Map<string, number>();
  const result = new Map<string, string>();
  for (const [id, key] of [...pairs].sort(([a], [b]) => a.localeCompare(b))) {
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    result.set(id, count ? `${key}#${count}` : key);
  }
  return result;
}
