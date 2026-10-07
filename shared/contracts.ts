// The meaning contracts shared by the browser, the local server and the MCP bridge.
// Three kinds of action never mix:
//   display change   — reseed, zoom, which worlds are shown. Never stored as knowledge.
//   knowledge        — what the person says about worlds. Unconfirmed until they pick a meaning.
//   model proposal   — a new spec. Only becomes a ModelVersion when the person adopts it.
import { z } from "zod";

const ident = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "名前は英字で始まる英数字と _ にしてください");

export const DistSchema = z.discriminatedUnion("family", [
  z.object({ family: z.literal("normal"), mu: z.number(), sigma: z.number().positive() }),
  z.object({ family: z.literal("lognormal"), mu: z.number(), sigma: z.number().positive() }),
  z.object({ family: z.literal("halfnormal"), sigma: z.number().positive() }),
  z.object({ family: z.literal("exponential"), rate: z.number().positive() }),
  z.object({ family: z.literal("uniform"), lower: z.number(), upper: z.number() }),
  z.object({ family: z.literal("studentt"), nu: z.number().positive(), mu: z.number(), sigma: z.number().positive() }),
  z.object({ family: z.literal("gamma"), shape: z.number().positive(), rate: z.number().positive() }),
  z.object({ family: z.literal("beta"), a: z.number().positive(), b: z.number().positive() }),
]);
export type Dist = z.infer<typeof DistSchema>;

export const ParamSchema = z.object({
  name: ident,
  label: z.string().min(1),
  unit: z.string().default(""),
  prior: DistSchema,
  note: z.string().default(""),
});
export type Param = z.infer<typeof ParamSchema>;

// A generative model of one curve y(x) observed with noise.
// Small on purpose: enough to audition priors, honest about what it cannot say.
export const ModelSpecSchema = z.object({
  title: z.string().min(1),
  question: z.string().default(""),
  x: z.object({
    name: ident,
    label: z.string().min(1),
    unit: z.string().default(""),
    min: z.number(),
    max: z.number(),
    points: z.number().int().min(3).max(200),
  }),
  y: z.object({ name: ident, label: z.string().min(1), unit: z.string().default("") }),
  params: z.array(ParamSchema).min(1).max(24),
  mean: z.string().min(1),
  noise: z.object({
    family: z.enum(["normal", "studentt"]),
    sigma: z.string().min(1),
    nu: z.number().positive().optional(),
  }),
});
export type ModelSpec = z.infer<typeof ModelSpecSchema>;

export const ModelVersionSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  spec: ModelSpecSchema,
  createdAt: z.string(),
  origin: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("proposal"), proposalId: z.string(), knowledgeIds: z.array(z.string()) }),
    z.object({ kind: z.literal("example") }),
    z.object({ kind: z.literal("revert"), toVersionId: z.string() }),
  ]),
  summary: z.string(),
});
export type ModelVersion = z.infer<typeof ModelVersionSchema>;

// What the person pointed at. Pixels are never stored; only data-space values.
export const SceneRefSchema = z.object({
  modelVersionId: z.string(),
  seed: z.number().int(),
});
export type SceneRef = z.infer<typeof SceneRefSchema>;

export const MarkSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("verdict"),
    world: z.number().int().nonnegative(),
    verdict: z.enum(["implausible", "plausible"]),
  }),
  z.object({
    kind: z.literal("sketch"),
    world: z.number().int().nonnegative().nullable(),
    // A gesture, not an observation. The meaning is decided later, with the person.
    points: z.array(z.tuple([z.number(), z.number()])).min(2).max(400),
  }),
  z.object({
    kind: z.literal("range"),
    world: z.number().int().nonnegative().nullable(),
    from: z.number(),
    to: z.number(),
  }),
]);
export type Mark = z.infer<typeof MarkSchema>;

export const KNOWLEDGE_KINDS = ["hypothesis", "constraint", "prior_knowledge", "preference", "measurement_need"] as const;
export const KnowledgeKindSchema = z.enum(KNOWLEDGE_KINDS);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

export const CandidateSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  kind: KnowledgeKindSchema,
  statement: z.string().min(1),
  reasoning: z.string().default(""),
  edit: z
    .object({
      spec: ModelSpecSchema,
      summary: z.string().min(1),
    })
    .optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const MessageSchema = z.object({
  from: z.enum(["human", "agent"]),
  text: z.string(),
  at: z.string(),
});

export const IntentSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  scene: SceneRefSchema,
  marks: z.array(MarkSchema),
  thread: z.array(MessageSchema).min(1),
  // pending: waiting for the agent. answered: candidates are waiting for the person.
  status: z.enum(["pending", "answered", "resolved", "dismissed"]),
  candidates: z.array(CandidateSchema).default([]),
  resolution: z
    .object({ candidateId: z.string(), knowledgeId: z.string(), proposalId: z.string().nullable() })
    .nullable()
    .default(null),
});
export type Intent = z.infer<typeof IntentSchema>;

export const KnowledgeSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  kind: KnowledgeKindSchema,
  statement: z.string(),
  intentId: z.string().nullable(),
  scene: SceneRefSchema.nullable(),
  marks: z.array(MarkSchema),
  status: z.enum(["confirmed", "withdrawn"]),
});
export type Knowledge = z.infer<typeof KnowledgeSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  baseVersionId: z.string().nullable(),
  spec: ModelSpecSchema,
  summary: z.string(),
  knowledgeIds: z.array(z.string()),
  intentId: z.string().nullable(),
  status: z.enum(["proposed", "adopted", "rejected"]),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const STATE_SCHEMA = "possible-worlds@1";

export const StateSchema = z.object({
  schema: z.literal(STATE_SCHEMA),
  currentVersionId: z.string().nullable(),
  versions: z.array(ModelVersionSchema),
  intents: z.array(IntentSchema),
  knowledge: z.array(KnowledgeSchema),
  proposals: z.array(ProposalSchema),
});
export type State = z.infer<typeof StateSchema>;

export function emptyState(): State {
  return { schema: STATE_SCHEMA, currentVersionId: null, versions: [], intents: [], knowledge: [], proposals: [] };
}

// Inputs accepted at the boundary. The agent side can only propose; the human side decides.
export const HumanIntentInput = z.object({
  scene: SceneRefSchema,
  marks: z.array(MarkSchema).max(64),
  utterance: z.string().trim().min(1, "何が気になったかを一言書いてください").max(4000),
});
export const HumanFollowUpInput = z.object({ text: z.string().trim().min(1).max(4000) });
export const HumanChooseInput = z.object({ candidateId: z.string() });

export const AgentReplyInput = z.object({
  intentId: z.string(),
  message: z.string().default(""),
  candidates: z
    .array(CandidateSchema.omit({ id: true }))
    .max(4)
    .default([]),
});
export const AgentProposeInput = z.object({
  spec: ModelSpecSchema,
  summary: z.string().min(1),
  knowledgeIds: z.array(z.string()).default([]),
});

export const KIND_LABELS: Record<KnowledgeKind, string> = {
  hypothesis: "仮説",
  constraint: "制約",
  prior_knowledge: "事前の知識",
  preference: "判断の好み",
  measurement_need: "測りたいこと",
};
