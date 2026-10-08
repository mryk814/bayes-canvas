import { z } from "zod";

const rowSchema = z.object({
  id: z.string().min(1).refine(id => id.trim().length > 0, "空の識別子は使えません"),
  outcome: z.number().finite().nullable(),
  baselineMean: z.number().finite().optional(),
  weight: z.number().finite().positive().default(1),
}).strict().refine(row => row.outcome !== null || row.baselineMean !== undefined, "欠測行には基準の条件付き平均が必要です");
export type SensitivityRow = z.input<typeof rowSchema>;

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error("感度計算の途中結果が有限ではありません。値や重みの尺度を見直してください");
  return value;
}

/** Conditional-mean scenarios, not imputation or estimated missingness mechanisms.
 * Baseline means, positive target weights and deltas are caller-supplied assumptions.
 * No uncertainty interval, probability of exceeding a threshold, or app state is produced.
 */
export function missingnessSensitivity(input: readonly SensitivityRow[], deltas: readonly number[], threshold: number) {
  const rows = z.array(rowSchema).min(1).parse(input);
  const shifts = z.array(z.number().finite()).min(1).parse(deltas);
  z.number().finite().parse(threshold);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("行IDが重複しています");
  const observed = rows.filter(row => row.outcome !== null);
  const missing = rows.filter(row => row.outcome === null);
  const sumWeights = (items: typeof rows) => items.reduce((sum, row) => finite(sum + row.weight), 0);
  const observedWeight = sumWeights(observed), missingWeight = sumWeights(missing);
  const totalWeight = finite(observedWeight + missingWeight);
  const observedSum = observed.reduce((sum, row) => finite(sum + finite(row.weight * row.outcome!)), 0);
  const observedOnlyMean = observed.length ? finite(observedSum / observedWeight) : null;
  const scenarios = shifts.map(delta => {
    const sum = missing.reduce((current, row) => finite(current + finite(row.weight * finite(row.baselineMean! + delta))), observedSum);
    const weightedMean = finite(sum / totalWeight);
    return { delta, weightedMean, exceedsThreshold: weightedMean > threshold };
  });
  return {
    threshold, counts: { total: rows.length, observed: observed.length, missing: missing.length },
    totalWeight, observedWeight, missingWeight, missingWeightFraction: missingWeight / totalWeight,
    observedOnlyMean, scenarios,
  };
}
