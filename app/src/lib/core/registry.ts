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
        if (!this.definitions.has(alias)) this.definitions.set(alias, definition);
      }
    }
  }

  get(id: string): DistributionDefinition | undefined {
    return this.definitions.get(id);
  }
}

export const minimalDistributionRegistry = new InMemoryDistributionRegistry([
  {
    id: 'normal',
    label: 'Normal',
    requiredArgs: ['mu', 'sigma'],
    support: { kind: 'real' },
    eventRank: 0,
    aliases: ['gaussian'],
  },
  {
    id: 'half_normal',
    label: 'HalfNormal',
    requiredArgs: ['sigma'],
    support: { kind: 'positive' },
    eventRank: 0,
  },
  {
    id: 'bernoulli',
    label: 'Bernoulli',
    requiredArgs: ['p'],
    support: { kind: 'custom', description: '{0, 1}' },
    eventRank: 0,
  },
]);
