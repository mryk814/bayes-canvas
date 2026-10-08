/* eslint-disable @typescript-eslint/no-explicit-any */
// possible-worlds@1 stored one curve model ({x, y, params, mean, noise}).
// @2 stores generative programs; @3 adds saved checks and result histories.
// Upgrade only in memory until the next change, preserving the old file as .bak.
import { STATE_SCHEMA } from "../shared/contracts.ts";

type V1Dist = { family: string } & Record<string, number | string>;
type V1Spec = {
  title: string;
  question?: string;
  x: { name: string; label: string; unit?: string; min: number; max: number; points: number };
  y: { name: string; label: string; unit?: string };
  params: { name: string; label: string; unit?: string; prior: V1Dist; note?: string }[];
  mean: string;
  noise: { family: "normal" | "studentt"; sigma: string; nu?: number };
};

function upgradeSpec(s: V1Spec) {
  const taken = new Set([s.x.name, s.y.name, ...s.params.map((p) => p.name)]);
  let mu = "mu";
  while (taken.has(mu)) mu += "_";
  const args = (d: V1Dist) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "family").map(([k, v]) => [k, String(v)]));
  return {
    title: s.title,
    question: s.question ?? "",
    plates: [{ name: "point", label: "測定点", size: s.x.points }],
    data: [{ name: s.x.name, label: s.x.label, unit: s.x.unit ?? "", plate: "point", indexOf: null, generate: { kind: "linspace", from: s.x.min, to: s.x.max } }],
    nodes: [
      ...s.params.map((p) => ({ name: p.name, label: p.label, unit: p.unit ?? "", plate: null, role: "param", dist: { family: p.prior.family, args: args(p.prior) }, note: p.note ?? "" })),
      { name: mu, label: "平均", unit: s.y.unit ?? "", plate: "point", role: "deterministic", expr: s.mean, note: "" },
      {
        name: s.y.name, label: s.y.label, unit: s.y.unit ?? "", plate: "point", role: "observed", note: "",
        dist: s.noise.family === "studentt"
          ? { family: "studentt", args: { nu: String(s.noise.nu ?? 4), mu, sigma: s.noise.sigma } }
          : { family: "normal", args: { mu, sigma: s.noise.sigma } },
      },
    ],
    view: { x: s.x.name, y: s.y.name, line: mu },
  };
}

export function migrate(raw: any): any {
  if (raw?.schema === "possible-worlds@2") return { ...raw, schema: STATE_SCHEMA, checks: [], checkResults: [] };
  if (raw?.schema !== "possible-worlds@1") return raw;
  const modelId = "mdl_migrated";
  const versions = (raw.versions ?? []).map((v: any) => ({
    ...v,
    modelId,
    spec: upgradeSpec(v.spec),
    origin: v.origin.kind === "example" ? { kind: "example", exampleId: "curve" } : v.origin,
  }));
  const current = versions.find((v: any) => v.id === raw.currentVersionId);
  return {
    schema: STATE_SCHEMA,
    models: current ? [{ id: modelId, title: current.spec.title, createdAt: versions[0].createdAt, currentVersionId: current.id }] : [],
    versions,
    intents: (raw.intents ?? []).map((i: any) => ({
      ...i,
      modelId,
      scene: { ...i.scene, runId: null },
      candidates: (i.candidates ?? []).map((c: any) => (c.edit ? { ...c, edit: { ...c.edit, spec: upgradeSpec(c.edit.spec) } } : c)),
    })),
    knowledge: (raw.knowledge ?? []).map((k: any) => ({ ...k, modelId, scene: k.scene ? { ...k.scene, runId: null } : null })),
    proposals: (raw.proposals ?? []).map((p: any) => ({ ...p, modelId, spec: upgradeSpec(p.spec) })),
    datasets: [],
    runs: [],
    checks: [],
    checkResults: [],
  };
}
