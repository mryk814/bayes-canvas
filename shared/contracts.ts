// The meaning contracts shared by the browser, the local server and the MCP bridge.
// Three kinds of action never mix:
//   display change   — reseed, zoom, prior vs a run, which worlds are shown. Never stored as knowledge.
//   knowledge        — what the person says about worlds. Unconfirmed until they pick a meaning.
//   model proposal   — a new spec. Only becomes a ModelVersion when the person adopts it.
// Inference runs and datasets are separate artifacts tied to a version; they never edit the model.
import { z } from "zod";

const ident = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "名前は英字で始まる英数字と _ にしてください");
const expr = z.union([z.string().min(1), z.number()]).transform((v) => String(v));

// ---------- model: a generative program -------------------------------------------

export const DIST_ARGS = {
  normal: ["mu", "sigma"],
  lognormal: ["mu", "sigma"],
  halfnormal: ["sigma"],
  exponential: ["rate"],
  uniform: ["lower", "upper"],
  studentt: ["nu", "mu", "sigma"],
  gamma: ["shape", "rate"],
  beta: ["a", "b"],
  poisson: ["rate"],
  bernoulli: ["p"],
  binomial: ["n", "p"],
} as const;
export type Family = keyof typeof DIST_ARGS;
export const DISCRETE: Family[] = ["poisson", "bernoulli", "binomial"];

export const DistSchema = z.object({
  family: z.enum(Object.keys(DIST_ARGS) as [Family, ...Family[]]),
  args: z.record(z.string(), expr),
});
export type Dist = z.infer<typeof DistSchema>;

export const PlateSchema = z.object({
  name: ident,
  label: z.string().min(1),
  size: z.number().int().min(1).max(2000),
});
export type Plate = z.infer<typeof PlateSchema>;

// Known inputs. For prior worlds they are generated; a dataset replaces them with real values.
export const DataColumnSchema = z.object({
  name: ident,
  label: z.string().min(1),
  unit: z.string().default(""),
  plate: ident,
  // index columns hold 0-based positions into another plate: device[i] ∈ {0..size-1}
  indexOf: ident.nullable().default(null),
  generate: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("linspace"), from: z.number(), to: z.number() }),
    z.object({ kind: z.literal("uniform"), lower: z.number(), upper: z.number() }),
    z.object({ kind: z.literal("cycle") }),
    z.object({ kind: z.literal("values"), values: z.array(z.number()).min(1) }),
  ]),
});
export type DataColumn = z.infer<typeof DataColumnSchema>;

export const NODE_ROLES = ["param", "latent", "deterministic", "observed"] as const;
export const NodeSchema = z.object({
  name: ident,
  label: z.string().min(1),
  unit: z.string().default(""),
  plate: ident.nullable().default(null),
  role: z.enum(NODE_ROLES),
  dist: DistSchema.optional(),
  expr: expr.optional(),
  // observation process: values above this are recorded as the limit (right-censoring)
  censorAbove: expr.optional(),
  note: z.string().default(""),
});
export type ModelNode = z.infer<typeof NodeSchema>;

export const ViewSchema = z.object({
  x: ident,
  y: ident,
  line: ident.optional(),
  group: ident.optional(),
});

export const ModelSpecSchema = z.object({
  title: z.string().min(1),
  question: z.string().default(""),
  plates: z.array(PlateSchema).max(8).default([]),
  data: z.array(DataColumnSchema).max(32).default([]),
  nodes: z.array(NodeSchema).min(1).max(64),
  view: ViewSchema,
});
export type ModelSpec = z.infer<typeof ModelSpecSchema>;

export const ModelSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  currentVersionId: z.string(),
});
export type Model = z.infer<typeof ModelSchema>;

export const ModelVersionSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  number: z.number().int().positive(),
  spec: ModelSpecSchema,
  createdAt: z.string(),
  origin: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("proposal"), proposalId: z.string(), knowledgeIds: z.array(z.string()) }),
    z.object({ kind: z.literal("example"), exampleId: z.string() }),
    z.object({ kind: z.literal("revert"), toVersionId: z.string() }),
  ]),
  summary: z.string(),
});
export type ModelVersion = z.infer<typeof ModelVersionSchema>;

// ---------- data and runs: evidence, never edits ----------------------------------

export const DatasetSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  createdAt: z.string(),
  label: z.string().min(1),
  provenance: z.enum(["real", "synthetic"]),
  note: z.string().default(""),
  plates: z.record(z.string(), z.number().int().min(1).max(5000)),
  columns: z.record(z.string(), z.array(z.number())),
});
export type Dataset = z.infer<typeof DatasetSchema>;

export const RunSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  versionId: z.string(),
  datasetId: z.string(),
  createdAt: z.string(),
  method: z.string().min(1),
  // approximate (e.g. Pathfinder) results are shown as such and replaced when MCMC lands
  fidelity: z.enum(["approximate", "mcmc"]).default("mcmc"),
  // who started it: the app's background ladder, or an agent by hand
  origin: z.enum(["auto", "agent"]).default("agent"),
  warnings: z.array(z.string()).default([]),
  note: z.string().default(""),
  diagnostics: z
    .object({
      maxRhat: z.number().nullable().default(null),
      minEss: z.number().nullable().default(null),
      divergences: z.number().int().nullable().default(null),
      chains: z.number().int().nullable().default(null),
      // Pathfinder's own check of its approximation; above 0.7 the approximation is not trustworthy
      paretoK: z.number().nullable().default(null),
      // wall-clock seconds of the fit, compilation included
      seconds: z.number().nullable().default(null),
    })
    .default({ maxRhat: null, minEss: null, divergences: null, chains: null, paretoK: null, seconds: null }),
  // set when the draws came from an inference algorithm written for this version
  algorithmId: z.string().nullable().default(null),
  // draws[node][k] holds the node's values (one per plate element) in joint draw k.
  draws: z.record(z.string(), z.array(z.array(z.number()))),
});
export type Run = z.infer<typeof RunSchema>;

// ---------- how to infer: algorithms written for one version, and their report cards ----
// The model says what; an algorithm says how. An agent writes one (collapsed, Gibbs, ...);
// the app runs it, checks it against the model (calibration, NUTS, held-out prediction),
// and the person adopts it or not. An adopted algorithm replaces NUTS for that version.

export const AlgorithmSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  versionId: z.string(),
  createdAt: z.string(),
  name: z.string().min(1).max(80),
  // what it exploits and why it should be faster or steadier, in the person's words
  note: z.string().default(""),
  // a Python module following the algorithm contract in inference/pw_numpyro.py
  code: z.string().min(1).max(100_000),
  status: z.enum(["proposed", "adopted", "rejected"]).default("proposed"),
  decidedAt: z.string().nullable().default(null),
});
export type Algorithm = z.infer<typeof AlgorithmSchema>;

// who an evaluation is about: the ladder's own methods, or an algorithm (by id)
const EvaluationBase = {
  id: z.string(),
  versionId: z.string(),
  datasetId: z.string(),
  createdAt: z.string(),
  subject: z.string(),
  method: z.string(),
};
export const EvaluationSchema = z.discriminatedUnion("kind", [
  // the algorithm on the real data: diagnostics, and where it disagrees with NUTS
  z.object({
    ...EvaluationBase,
    kind: z.literal("fit"),
    diagnostics: RunSchema.shape.diagnostics,
    gaps: z.array(z.string()).default([]),
    reference: z.string().nullable().default(null),
  }),
  // fitted without some records, scored on predicting them: outside the Bayesian bookkeeping.
  // One score per observed quantity, in its own unit; splits answer different questions
  // ("records": the next record of a unit already seen, "groups:<plate>": an unseen unit).
  z.object({
    ...EvaluationBase,
    kind: z.literal("holdout"),
    split: z.string(),
    plate: z.string(),
    held: z.number().int(),
    scores: z.array(
      z.object({
        node: z.string(), unit: z.string(), rows: z.number().int(),
        crps: z.number(), mae: z.number(), coverage90: z.number(), width90: z.number(),
        // per held-out record, in held order (null where it could not be scored), for paired comparisons
        rowCrps: z.array(z.number().nullable()).default([]),
      }),
    ),
    // whether the fit passed its own checks (Pareto k for approximations, R-hat/ESS/divergences for MCMC)
    trusted: z.boolean().default(true),
    seconds: z.number().nullable().default(null),
  }),
  // simulation-based calibration: ranks of true values among posterior draws. Not detecting a
  // bias with this many datasets and quantities is not a proof of correctness.
  z.object({
    ...EvaluationBase,
    kind: z.literal("calibration"),
    reps: z.number().int(),
    draws: z.number().int(),
    params: z.array(z.object({ name: z.string(), p: z.number(), hist: z.array(z.number().int()) })),
    divergences: z.number().int(),
    seconds: z.number(),
    biasDetected: z.boolean(),
  }),
]);
export type Evaluation = z.infer<typeof EvaluationSchema>;
export type EvaluationInput = Evaluation extends infer E ? (E extends Evaluation ? Omit<E, "id" | "createdAt"> : never) : never;

// ---------- what the person points at ----------------------------------------------

// Pixels are never stored; only data-space values and ids.
export const SceneRefSchema = z.object({
  modelVersionId: z.string(),
  seed: z.number().int(),
  runId: z.string().nullable().default(null),
});
export type SceneRef = z.infer<typeof SceneRefSchema>;

const world = z.number().int().nonnegative();
export const MarkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("verdict"), world, verdict: z.enum(["implausible", "plausible"]) }),
  z.object({
    kind: z.literal("sketch"),
    world: world.nullable(),
    // A gesture, not an observation. The meaning is decided later, with the person.
    points: z.array(z.tuple([z.number(), z.number()])).min(2).max(400),
  }),
  z.object({ kind: z.literal("range"), world: world.nullable(), from: z.number(), to: z.number() }),
  z.object({ kind: z.literal("point"), world, unit: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("layer"), world, unit: z.number().int().nonnegative(), node: ident }),
  // Two quantities that move together in a run, and two draws from opposite ends of that ridge.
  z.object({ kind: z.literal("ridge"), a: ident, b: ident, worlds: z.tuple([world, world]) }),
  // The shape the person believes one argument of the observation has along x (a gesture, not data).
  z.object({
    kind: z.literal("shape"),
    arg: ident,
    group: z.number().int().nonnegative().nullable(),
    points: z.array(z.tuple([z.number(), z.number()])).min(2).max(400),
  }),
  // One bin of the shape check the person finds suspicious.
  z.object({ kind: z.literal("bin"), arg: ident, group: z.number().int().nonnegative().nullable(), from: z.number(), to: z.number() }),
]);
export type Mark = z.infer<typeof MarkSchema>;

export const KNOWLEDGE_KINDS = ["hypothesis", "constraint", "prior_knowledge", "observation_process", "check", "preference", "measurement_need"] as const;
export const KnowledgeKindSchema = z.enum(KNOWLEDGE_KINDS);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

export const CandidateSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  kind: KnowledgeKindSchema,
  statement: z.string().min(1),
  reasoning: z.string().default(""),
  edit: z.object({ spec: ModelSpecSchema, summary: z.string().min(1) }).optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const MessageSchema = z.object({ from: z.enum(["human", "agent"]), text: z.string(), at: z.string() });

export const IntentSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  createdAt: z.string(),
  scene: SceneRefSchema,
  marks: z.array(MarkSchema),
  thread: z.array(MessageSchema).min(1),
  // pending: waiting for the agent. answered: candidates (or a question) are waiting for the person.
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
  modelId: z.string(),
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
  // null: the proposal starts a new model when adopted
  modelId: z.string().nullable(),
  createdAt: z.string(),
  baseVersionId: z.string().nullable(),
  spec: ModelSpecSchema,
  summary: z.string(),
  knowledgeIds: z.array(z.string()),
  intentId: z.string().nullable(),
  status: z.enum(["proposed", "adopted", "rejected"]),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const STATE_SCHEMA = "possible-worlds@2";

export const StateSchema = z.object({
  schema: z.literal(STATE_SCHEMA),
  models: z.array(ModelSchema),
  versions: z.array(ModelVersionSchema),
  intents: z.array(IntentSchema),
  knowledge: z.array(KnowledgeSchema),
  proposals: z.array(ProposalSchema),
  datasets: z.array(DatasetSchema),
  runs: z.array(RunSchema),
  algorithms: z.array(AlgorithmSchema).default([]),
  evaluations: z.array(EvaluationSchema).default([]),
});
export type State = z.infer<typeof StateSchema>;

export function emptyState(): State {
  return { schema: STATE_SCHEMA, models: [], versions: [], intents: [], knowledge: [], proposals: [], datasets: [], runs: [], algorithms: [], evaluations: [] };
}

// ---------- inputs accepted at the boundary --------------------------------------
// The agent side can only propose and attach evidence; the human side decides.

export const HumanIntentInput = z.object({
  scene: SceneRefSchema,
  marks: z.array(MarkSchema).max(64),
  utterance: z.string().trim().min(1, "何が気になったかを一言書いてください").max(4000),
});
export const HumanFollowUpInput = z.object({ text: z.string().trim().min(1).max(4000) });
export const HumanChooseInput = z.object({ candidateId: z.string() });
export const HumanExampleInput = z.object({ exampleId: z.string() });

export const AgentReplyInput = z.object({
  intentId: z.string(),
  message: z.string().default(""),
  candidates: z.array(CandidateSchema.omit({ id: true })).max(4).default([]),
});
export const AgentProposeInput = z.object({
  modelId: z.string().nullable().default(null).describe("null starts a new model"),
  spec: ModelSpecSchema,
  summary: z.string().min(1),
  knowledgeIds: z.array(z.string()).default([]),
});
export const AgentDatasetInput = DatasetSchema.omit({ id: true, createdAt: true });
export const AgentSynthesizeInput = z.object({
  modelId: z.string(),
  label: z.string().min(1),
  note: z.string().default(""),
  truth: ModelSpecSchema.describe("The generating spec. It may differ from the model on purpose; it is not shown to the person as the model."),
  seed: z.number().int(),
  plates: z.record(z.string(), z.number().int().min(1).max(5000)).default({}),
});
export const AgentRunInput = RunSchema.omit({ id: true, createdAt: true, modelId: true, origin: true });
export const AgentAlgorithmInput = z.object({
  versionId: z.string(),
  name: z.string().min(1).max(80),
  note: z.string().default("").describe("What the algorithm exploits and why it should beat NUTS here, for the person"),
  code: z.string().min(1).max(100_000).describe("Python module following the ALGORITHM CONTRACT in pw_numpyro.py"),
});

// Background inference: jobs per (version, dataset), climbing approximate → mcmc, then the
// report cards. approximate: Laplace or mean-field ADVI, checked with Pareto k. mcmc: NUTS, or
// the adopted algorithm. trial / calibrate: a proposed algorithm on the real data / on data
// simulated from the prior. holdout: fit without 20% of the records, score predicting them.
export type JobStage = "approximate" | "mcmc" | "trial" | "calibrate" | "holdout";
export type Job = {
  id: string;
  modelId: string;
  versionId: string;
  datasetId: string;
  stage: JobStage;
  // "approximate", "nuts", or an algorithm id
  subject: string;
  // holdout only: which records are held out
  split: string | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  phase: string;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  runId: string | null;
};

export const KIND_LABELS: Record<KnowledgeKind, string> = {
  hypothesis: "仮説",
  constraint: "制約",
  prior_knowledge: "事前の知識",
  observation_process: "観測の仕組み",
  check: "検査したいこと",
  preference: "判断の好み",
  measurement_need: "測りたいこと",
};

export const ROLE_LABELS: Record<ModelNode["role"], string> = {
  param: "パラメータ",
  latent: "潜在",
  deterministic: "計算",
  observed: "観測",
};
