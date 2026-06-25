import { DISTRIBUTIONS, type DistributionDefinition as UiDistributionDefinition } from '../distributionRegistry.js';
import type { DistributionDefinition, DistributionRegistry, Domain } from './model.js';

export class InMemoryDistributionRegistry implements DistributionRegistry {
  private readonly definitions = new Map<string, DistributionDefinition>();

  constructor(definitions: readonly DistributionDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) {
        throw new Error(`Duplicate distribution ID: ${definition.id}`);
      }
      this.definitions.set(definition.id, definition);
      for (const alias of definition.aliases ?? []) {
        const normalizedAlias = normalizeRegistryKey(alias);
        if (!this.definitions.has(normalizedAlias)) this.definitions.set(normalizedAlias, definition);
      }
    }
  }

  get(id: string): DistributionDefinition | undefined {
    return this.definitions.get(normalizeRegistryKey(id));
  }
}

export const minimalDistributionRegistry = new InMemoryDistributionRegistry(
  DISTRIBUTIONS.map(toCompilerDistribution),
);

function toCompilerDistribution(distribution: UiDistributionDefinition): DistributionDefinition {
  return {
    id: distribution.id,
    label: distribution.name,
    requiredArgs: distribution.params.filter((param) => param.required).map((param) => param.name),
    optionalArgs: distribution.params.filter((param) => !param.required).map((param) => param.name),
    support: supportToDomain(distribution.support),
    eventRank: distribution.family === 'multivariate' ? 1 : 0,
    aliases: [distribution.name, ...(distribution.aliases ?? [])].map(normalizeRegistryKey),
    deprecated: distribution.deprecated,
  };
}

function normalizeRegistryKey(value: string): string {
  const lowered = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (lowered === 'studentt') return 'student_t';
  if (lowered === 'multivariatenormal' || lowered === 'mvn') return 'multivariate_normal';
  return lowered;
}

function supportToDomain(support: string): Domain {
  if (support === 'real') return { kind: 'real' };
  if (support === 'positive' || support === 'positive_definite_matrix' || support === 'cholesky_factor_corr') return { kind: 'positive' };
  if (support === 'unit_interval') return { kind: 'unit_interval' };
  if (support === 'simplex') return { kind: 'simplex', axisId: 'component' };
  if (support === 'ordered') return { kind: 'ordered', axisId: 'category' };
  if (support === 'correlation_matrix') return { kind: 'correlation_matrix', axisId: 'dimension' };
  return { kind: 'custom', description: support };
}
