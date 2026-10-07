export type JointCondition = {
  variable: string;
  op: "gt" | "gte" | "lt" | "lte";
  threshold: number;
};

export type JointDataset = {
  modelRef: string;
  runRef: string;
  draws: { id: string; values: Record<string, number> }[];
};

export type JointResult =
  | { ok: false; modelRef: string; runRef: string; errors: string[] }
  | {
      ok: true;
      modelRef: string;
      runRef: string;
      totalDraws: number;
      matchedDrawIds: string[];
      joint: { count: number; probability: number };
      marginals: { condition: JointCondition; count: number; probability: number }[];
    };

/** Every input draw contributes to the denominator; invalid input rejects the whole query. */
export function queryJoint(dataset: JointDataset, conditions: JointCondition[]): JointResult {
  const { modelRef, runRef, draws } = dataset;
  const errors: string[] = [];
  if (!modelRef.trim() || !runRef.trim()) errors.push("モデルと run の参照が必要です。");
  if (!draws.length) errors.push("draw が空のため計算できません。");
  if (!conditions.length) errors.push("条件を少なくとも1つ指定してください。");
  for (const condition of conditions) {
    if (!condition.variable.trim() || !["gt", "gte", "lt", "lte"].includes(condition.op) || !Number.isFinite(condition.threshold)) {
      errors.push("条件には変数、有効な比較、有限の閾値が必要です。");
    }
  }
  const ids = new Set<string>();
  for (const draw of draws) {
    if (!draw.id.trim() || ids.has(draw.id)) errors.push(`draw ID が空または重複しています: ${draw.id}`);
    ids.add(draw.id);
    for (const { variable } of conditions) {
      if (!Object.hasOwn(draw.values, variable) || !Number.isFinite(draw.values[variable])) {
        errors.push(`${draw.id}: ${variable} が欠損または非有限です。draw を除外せず計算を停止しました。`);
      }
    }
  }
  if (errors.length) return { ok: false, modelRef, runRef, errors };

  const counts = conditions.map(() => 0);
  const matchedDrawIds: string[] = [];
  for (const draw of draws) {
    const matches = conditions.map(({ variable, op, threshold }, index) => {
      const value = draw.values[variable];
      const match = op === "gt" ? value > threshold : op === "gte" ? value >= threshold : op === "lt" ? value < threshold : value <= threshold;
      if (match) counts[index]++;
      return match;
    });
    if (matches.every(Boolean)) matchedDrawIds.push(draw.id);
  }
  return {
    ok: true, modelRef, runRef, totalDraws: draws.length, matchedDrawIds,
    joint: { count: matchedDrawIds.length, probability: matchedDrawIds.length / draws.length },
    marginals: conditions.map((condition, index) => ({ condition: { ...condition }, count: counts[index], probability: counts[index] / draws.length })),
  };
}

export type JointFixture = {
  id: string;
  title: string;
  description: string;
  labels: Record<string, string>;
  units: Record<string, string>;
  dataset: JointDataset;
  conditions: JointCondition[];
  expectedJointProbability: number;
};

/** Deliberately synthetic eight-draw teaching fixtures, not posterior inference. */
export const JOINT_FIXTURES: JointFixture[] = [
  {
    id: "negative",
    title: "個体差と測定誤差の取り合い",
    description: "合成8 draw。片方が大きいともう片方は小さい。周辺では各50%でも、同時に大きい draw は0%。端部の1と19も母数に含めます。",
    labels: { individual: "個体差の標準偏差", measurement: "測定誤差の標準偏差" },
    units: { individual: "MPa", measurement: "MPa" },
    dataset: {
      modelRef: "synthetic/individual-measurement/v1", runRef: "synthetic/negative-eight/v1",
      draws: [1, 3, 5, 7, 13, 15, 17, 19].map((individual, index) => ({ id: `im-${index + 1}`, values: { individual, measurement: 20 - individual } })),
    },
    conditions: [{ variable: "individual", op: "gt", threshold: 10 }, { variable: "measurement", op: "gt", threshold: 10 }],
    expectedJointProbability: 0,
  },
  {
    id: "positive",
    title: "費用と効果が一緒に増える",
    description: "合成8 draw。費用と効果が同方向に動く。各条件は50%、両方を満たす割合も50%。周辺比率の積25%とは異なります。",
    labels: { cost: "費用", effect: "改善量" },
    units: { cost: "万円", effect: "点" },
    dataset: {
      modelRef: "synthetic/cost-effect/v1", runRef: "synthetic/positive-eight/v1",
      draws: [1, 2, 3, 4, 6, 7, 8, 100].map((cost, index) => ({ id: `ce-${index + 1}`, values: { cost, effect: cost * 2 } })),
    },
    conditions: [{ variable: "cost", op: "gt", threshold: 5 }, { variable: "effect", op: "gt", threshold: 10 }],
    expectedJointProbability: 0.5,
  },
];
