import { z } from "zod";
import { DatasetSchema, ModelVersionSchema, RunSchema, type Dataset, type ModelVersion, type Run } from "./contracts.ts";
import { runProblems } from "./evidence-validation.ts";
import { compileSpec } from "./sim.ts";

export const CapsuleSchema = z.object({
  schema: z.literal("evidence-capsule@1"),
  modelVersion: ModelVersionSchema,
  dataset: DatasetSchema,
  run: RunSchema,
});
export type EvidenceCapsule = z.infer<typeof CapsuleSchema>;
export type CapsuleRead = { ok: true; capsule: EvidenceCapsule } | { ok: false; problems: string[] };

/** Structural/reference validation, not a signature or a claim that inference can be reproduced. */
export function readCapsule(input: unknown): CapsuleRead {
  const parsed = CapsuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "capsule"}: ${issue.message}`) };
  const capsule = parsed.data;
  const { modelVersion: version, dataset, run } = capsule;
  const problems: string[] = [];
  for (const [name, id] of Object.entries({ modelId: version.modelId, versionId: version.id, datasetId: dataset.id, runId: run.id })) {
    if (!id.trim()) problems.push(`${name} が空です`);
  }
  if (dataset.modelId !== version.modelId || run.modelId !== version.modelId) problems.push("モデルIDが版・データ・runで一致しません");
  if (run.versionId !== version.id) problems.push("runの版IDがモデル版と一致しません");
  if (run.datasetId !== dataset.id) problems.push("runのデータIDがデータと一致しません");
  const compiled = compileSpec(version.spec);
  if (!compiled.ok) problems.push(...compiled.problems);
  problems.push(...runProblems(version.spec, dataset, run));
  return problems.length ? { ok: false, problems } : { ok: true, capsule };
}

export function createCapsule(modelVersion: ModelVersion, dataset: Dataset, run: Run): EvidenceCapsule {
  const result = readCapsule({ schema: "evidence-capsule@1", modelVersion, dataset, run });
  if (!result.ok) throw new Error(result.problems.join("\n"));
  return result.capsule;
}
