import type { BackendCapabilityItem, HandoffTarget } from './handoff.js';
import type { ModelDocument } from './model.js';
import { TARGET_PROFILES } from './target-profiles.js';
import { builtInBlockRegistry } from './block-registry.js';

export function buildCapabilityReport(document: ModelDocument, target: HandoffTarget): BackendCapabilityItem[] {
  const items: BackendCapabilityItem[] = [
    {
      feature: 'ModelDocument schema',
      support: 'native',
      relatedEntityIds: [],
      note: 'Canvas semantics are exported separately from layout state.',
    },
    {
      feature: 'Expression AST and symbol binding',
      support: 'native',
      relatedEntityIds: [],
      note: 'Expressions are parsed by the compiler before handoff.',
    },
    {
      feature: `${TARGET_PROFILES[target].label} target profile`,
      support: TARGET_PROFILES[target].defaultSupport,
      relatedEntityIds: [],
      note: TARGET_PROFILES[target].notes.join(' '),
    },
  ];

  for (const entity of Object.values(document.entities)) {
    if (entity.kind === 'block_instance') {
      const definition = builtInBlockRegistry.get(entity.blockTypeId, entity.blockVersion);
      const support = definition?.backendCapabilities?.[target] ?? (target === 'review' ? 'unknown' : 'unsupported');
      items.push({
        feature: `${entity.blockTypeId} block`,
        support,
        relatedEntityIds: [entity.id],
        note: definition
          ? 'Block internals are pure data boundaries; implementation must preserve ports and config.'
          : 'Unknown external block is diagnostic-only and must not be silently lowered into backend code.',
      });
    }
    if (entity.kind === 'random_variable') {
      const backendName = TARGET_PROFILES[target].distributionNames[entity.distribution.distributionId];
      items.push({
        feature: `${entity.distribution.distributionId} distribution`,
        support: backendName ? 'native' : distributionSupportForTarget(target),
        relatedEntityIds: [entity.id],
        note: backendName ? `Backend name: ${backendName}` : 'No backend-specific distribution name is registered.',
      });
      if (entity.distribution.truncation) {
        items.push({
          feature: `${entity.distribution.distributionId} truncation`,
          support: truncationSupportForTarget(target, entity.distribution.distributionId),
          relatedEntityIds: [entity.id],
          note: truncationNoteForTarget(target, entity.distribution.distributionId),
        });
      }
    }
    if (entity.kind === 'random_variable' && entity.distribution.distributionId === 'wishart') {
      items.push({
        feature: 'Wishart covariance prior',
        support: 'unsupported',
        relatedEntityIds: [entity.id],
        note: 'Prefer LKJ correlation plus scale priors unless a backend-specific reason is documented.',
      });
    }
  }

  return items;
}

function truncationSupportForTarget(
  target: HandoffTarget,
  distributionId: string,
): BackendCapabilityItem['support'] {
  if (target === 'review') return 'native';
  if (target === 'generic') return 'unknown';
  if (target === 'stan') return 'native';
  if (target === 'pymc' && distributionId === 'normal') return 'native';
  return 'lowered';
}

function truncationNoteForTarget(target: HandoffTarget, distributionId: string): string {
  if (target === 'stan') return 'Use Stan truncation syntax T[lower, upper].';
  if (target === 'pymc' && distributionId === 'normal') return 'Use pm.TruncatedNormal with explicit bounds.';
  if (target === 'pymc') return 'Lower to pm.Truncated around the declared base distribution.';
  if (target === 'numpyro') return 'Lower to the matching one- or two-sided truncated distribution wrapper.';
  return 'Preserve the base distribution and normalization bounds as distinct semantics.';
}

function distributionSupportForTarget(target: HandoffTarget): BackendCapabilityItem['support'] {
  if (target === 'generic' || target === 'review') return TARGET_PROFILES[target].defaultSupport;
  return 'unsupported';
}
