import type { Edge, Node } from '@xyflow/react';

export type BayesNodeKind = 'data' | 'parameter' | 'hyperparameter' | 'latent' | 'deterministic' | 'likelihood';

export interface BayesNodeData extends Record<string, unknown> {
  kind: BayesNodeKind;
  name: string;
  shape?: string[];
  observed?: boolean;
  plate?: string;
  distribution?: {
    name: string;
    args: Record<string, string>;
  };
  expression?: string;
}

export interface ModelIr {
  version: string;
  model: {
    name: string;
    description?: string;
  };
  plates: Array<{
    id: string;
    label: string;
    index: string;
    size: string;
  }>;
  nodes: Array<BayesNodeData & { id: string }>;
  edges: Array<{
    from: string;
    to: string;
    role: string;
  }>;
}

export function exportModelIr(nodes: Node[], edges: Edge[]): ModelIr {
  return {
    version: '0.1.0',
    model: {
      name: 'hierarchical_regression',
      description: 'Random-intercept Bayesian regression example.',
    },
    plates: [
      { id: 'obs', label: 'observations', index: 'i', size: 'N' },
      { id: 'group', label: 'groups', index: 'j', size: 'J' },
    ],
    nodes: nodes.map((node) => ({ id: node.id, ...(node.data as BayesNodeData) })),
    edges: edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      role: String(edge.data?.role ?? 'dependency'),
    })),
  };
}

export function generateAiPrompt(model: ModelIr): string {
  return [
    'Implement the following Bayesian model in PyMC.',
    'Preserve dimensions, plates, observed variables, priors, deterministic expressions, and likelihoods.',
    'Also include prior predictive checks, posterior predictive checks, and ArviZ diagnostics.',
    '',
    JSON.stringify(model, null, 2),
  ].join('\n');
}
