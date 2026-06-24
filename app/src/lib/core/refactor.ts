import { rewriteReference } from './expression.js';
import type { EntityId, ModelDocument, SourceText } from './model.js';

export interface RenameResult {
  document: ModelDocument;
  touchedPaths: string[];
}

/**
 * A semantic rename updates the declaration and every parsed reference.
 * It deliberately refuses invalid or colliding names rather than doing a text replace.
 */
export function renameEntitySymbol(
  document: ModelDocument,
  entityId: EntityId,
  nextSymbol: string,
): RenameResult {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(nextSymbol)) {
    throw new Error(`Invalid symbol: ${nextSymbol}`);
  }
  const entity = document.entities[entityId];
  if (!entity) throw new Error(`Unknown entity: ${entityId}`);
  const collision = Object.values(document.entities).find(
    (candidate) => candidate.id !== entityId && candidate.symbol === nextSymbol,
  );
  if (collision) throw new Error(`Symbol already exists: ${nextSymbol}`);

  const previousSymbol = entity.symbol;
  if (previousSymbol === nextSymbol) return { document, touchedPaths: [] };

  const next = structuredClone(document);
  const touchedPaths: string[] = [];
  next.entities[entityId]!.symbol = nextSymbol;
  touchedPaths.push(`/entities/${escapePointer(entityId)}/symbol`);

  const rewrite = (source: SourceText, path: string): SourceText => {
    const updated = rewriteReference(source, previousSymbol, nextSymbol);
    if (updated.source !== source.source) touchedPaths.push(path);
    return updated;
  };

  for (const [axisId, axis] of Object.entries(next.axes)) {
    axis.size = rewrite(axis.size, `/axes/${escapePointer(axisId)}/size`);
  }

  for (const [currentId, current] of Object.entries(next.entities)) {
    const basePath = `/entities/${escapePointer(currentId)}`;
    if (current.kind === 'deterministic' || current.kind === 'query') {
      current.expression = rewrite(current.expression, `${basePath}/expression`);
    } else if (current.kind === 'factor') {
      current.logDensity = rewrite(current.logDensity, `${basePath}/logDensity`);
    } else if (current.kind === 'random_variable') {
      for (const [argName, source] of Object.entries(current.distribution.args)) {
        current.distribution.args[argName] = rewrite(
          source,
          `${basePath}/distribution/args/${escapePointer(argName)}`,
        );
      }
      if (current.distribution.truncation?.lower) {
        current.distribution.truncation.lower = rewrite(
          current.distribution.truncation.lower,
          `${basePath}/distribution/truncation/lower`,
        );
      }
      if (current.distribution.truncation?.upper) {
        current.distribution.truncation.upper = rewrite(
          current.distribution.truncation.upper,
          `${basePath}/distribution/truncation/upper`,
        );
      }
      const process = current.observationProcess;
      if (process?.kind === 'measurement_error' && process.errorScale) {
        process.errorScale = rewrite(process.errorScale, `${basePath}/observationProcess/errorScale`);
      } else if (process?.kind === 'censored') {
        if (process.lower) process.lower = rewrite(process.lower, `${basePath}/observationProcess/lower`);
        if (process.upper) process.upper = rewrite(process.upper, `${basePath}/observationProcess/upper`);
      } else if (process?.kind === 'truncated') {
        if (process.lower) process.lower = rewrite(process.lower, `${basePath}/observationProcess/lower`);
        if (process.upper) process.upper = rewrite(process.upper, `${basePath}/observationProcess/upper`);
      } else if (process?.kind === 'rounded') {
        process.unit = rewrite(process.unit, `${basePath}/observationProcess/unit`);
      }
    } else if (current.kind === 'block_instance') {
      for (const [portId, binding] of Object.entries(current.inputs)) {
        if (binding.expression) {
          binding.expression = rewrite(
            binding.expression,
            `${basePath}/inputs/${escapePointer(portId)}/expression`,
          );
        }
      }
    }
  }

  next.revision += 1;
  return { document: next, touchedPaths };
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
