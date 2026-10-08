import { z } from "zod";

const id = z.string().min(1).refine(value => value.trim().length > 0, "空の識別子は使えません");
const rowSchema = z.object({
  id, outcome: z.number().finite().nullable(),
  group: id.nullable().optional(), time: z.number().finite().nullable().optional(),
}).strict();
export type ResearchRow = z.infer<typeof rowSchema>;

const target = z.string().trim().min(1);
const planSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group"), testGroups: z.array(id).min(1), target }).strict(),
  z.object({ kind: z.literal("time"), testFrom: z.number().finite(), target }).strict(),
  z.object({ kind: z.literal("explicit"), trainIds: z.array(id).min(1), testIds: z.array(id).min(1), target }).strict(),
]);
export type ResearchSplitPlan = z.infer<typeof planSchema>;

function unique(values: string[], label: string): Set<string> {
  const result = new Set(values);
  if (result.size !== values.length) throw new Error(`${label}が重複しています`);
  return result;
}

/** A separate research artifact: never rewrites Dataset, imputes values or certifies preprocessing. */
export function splitResearchRows(input: readonly ResearchRow[], requested: ResearchSplitPlan) {
  const rows = z.array(rowSchema).min(1).parse(input);
  const plan = planSchema.parse(requested);
  const rowIds = unique(rows.map(row => row.id), "行ID");
  const train: ResearchRow[] = [], test: ResearchRow[] = [];
  const excluded: { row: ResearchRow; reason: "not-selected" }[] = [];
  if (plan.kind === "group") {
    if (rows.some(row => row.group == null)) throw new Error("群による分割にはすべての行の群が必要です");
    const groups = new Set(rows.map(row => row.group));
    const testGroups = unique(plan.testGroups, "保留群");
    for (const group of testGroups) if (!groups.has(group)) throw new Error(`保留群 ${group} が存在しません`);
    for (const row of rows) (testGroups.has(row.group!) ? test : train).push(row);
  } else if (plan.kind === "time") {
    if (rows.some(row => row.time == null)) throw new Error("時刻による分割にはすべての行の時刻が必要です");
    for (const row of rows) (row.time! >= plan.testFrom ? test : train).push(row);
  } else {
    const trainIds = unique(plan.trainIds, "訓練行ID"), testIds = unique(plan.testIds, "保留行ID");
    for (const selected of [...trainIds, ...testIds]) {
      if (!rowIds.has(selected)) throw new Error(`行 ${selected} が存在しません`);
      if (trainIds.has(selected) && testIds.has(selected)) throw new Error(`行 ${selected} が訓練と保留の両方にあります`);
    }
    for (const row of rows) {
      if (trainIds.has(row.id)) train.push(row);
      else if (testIds.has(row.id)) test.push(row);
      else excluded.push({ row, reason: "not-selected" });
    }
  }
  if (!train.length || !test.length) throw new Error("訓練行と保留行がそれぞれ1行以上必要です");
  const scoreable = test.filter(row => row.outcome !== null);
  const missingTestOutcome = test.filter(row => row.outcome === null);
  return {
    target: plan.target, plan, train, test, excluded, scoreable, missingTestOutcome,
    counts: { total: rows.length, train: train.length, test: test.length, scoreable: scoreable.length,
      missingTestOutcome: missingTestOutcome.length, excluded: excluded.length },
  };
}
