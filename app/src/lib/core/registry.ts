import { DISTRIBUTIONS, normalizeDistributionId, toCompilerDistributionDefinition } from '../distributionRegistry.js';
import type { DistributionDefinition, DistributionRegistry } from './model.js';

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
  DISTRIBUTIONS.map(toCompilerDistributionDefinition),
);

function normalizeRegistryKey(value: string): string {
  return normalizeDistributionId(value);
}
