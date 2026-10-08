import { DIST_ARGS, ModelSpecSchema, type DataColumn, type Family, type ModelNode, type ModelSpec } from "./contracts.ts";
import { refs } from "./expr.ts";
import { compileSpec } from "./sim.ts";

export type StoryStep = {
  name: string; label: string; unit: string; role: "input" | ModelNode["role"];
  scope: string; narrative: string; formula: string; references: string[]; note: string;
};

const distributionStory: Record<Family, (a: Record<string, string>) => string> = {
  normal: a => `正規分布（平均 mu=${a.mu}、標準偏差 sigma=${a.sigma}）`,
  lognormal: a => `対数正規分布（自然対数上の平均 mu=${a.mu}、自然対数上の標準偏差 sigma=${a.sigma}）`,
  halfnormal: a => `半正規分布（平均0の元の正規分布の標準偏差 sigma=${a.sigma} を用い、その絶対値を取る）`,
  exponential: a => `指数分布（率 rate=${a.rate}）`,
  uniform: a => `一様分布（下限 lower=${a.lower}、上限 upper=${a.upper}）`,
  studentt: a => `Student-t分布（自由度 nu=${a.nu}、位置 mu=${a.mu}、尺度 sigma=${a.sigma}。sigmaは標準偏差ではない）`,
  gamma: a => `Gamma分布（形状 shape=${a.shape}、率 rate=${a.rate}。rateは尺度ではない）`,
  beta: a => `Beta分布（形状 a=${a.a}、形状 b=${a.b}）`,
  poisson: a => `Poisson分布（平均件数 rate=${a.rate}）`,
  bernoulli: a => `Bernoulli分布（1になる確率 p=${a.p}、それ以外は0）`,
  binomial: a => `二項分布（試行回数 n=${a.n}、各試行の成功確率 p=${a.p} による成功回数）`,
};

function inputStory(column: DataColumn, spec: ModelSpec) {
  const g = column.generate;
  switch (g.kind) {
    case "linspace": return { formula: `linspace(from=${g.from}, to=${g.to})`, narrative: `${g.from}から${g.to}まで等間隔に並べる。1件なら${g.from}を使う。` };
    case "uniform": return { formula: `uniform(lower=${g.lower}, upper=${g.upper})`, narrative: `${g.lower}から${g.upper}の範囲の例示値を、行数で決まる固定seedで用意する。世界ごとには引き直さない。` };
    case "values": return { formula: `values(${JSON.stringify(g.values)})`, narrative: `指定された値 ${JSON.stringify(g.values)} を順に使い、行数が多ければ先頭へ戻って繰り返す。` };
    case "cycle": {
      const size = spec.plates.find(p => p.name === column.indexOf)!.size;
      return { formula: `cycle(indexOf=${column.indexOf}, size=${size})`, narrative: `${column.indexOf}の添字0〜${size - 1}を順に使い、先頭へ戻って繰り返す。` };
    }
  }
}

/** A reading of the model definition, not a replay of sampling or inference. */
export function buildGenerativeStory(spec: ModelSpec): { ok: true; steps: StoryStep[] } | { ok: false; problems: string[] } {
  const parsed = ModelSpecSchema.safeParse(spec);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) };
  const result = compileSpec(parsed.data);
  if (!result.ok) return result;
  const c = result.compiled;
  const scope = (plate: string | null) => {
    if (plate === null) return "共有scalar（1個の値）";
    const p = spec.plates.find(p => p.name === plate)!;
    return `${p.label}（${p.name}、モデル定義の${p.size}件それぞれ）`;
  };
  const steps: StoryStep[] = c.data.map(column => {
    const story = inputStory(column, spec);
    return { name: column.name, label: column.label, unit: column.unit, role: "input", scope: scope(column.plate),
      narrative: `事前世界用の入力例。${story.narrative} 実測の採取過程を記述したものではない。`,
      formula: `${column.name} ← ${story.formula}`, references: [], note: "" };
  });
  for (const cn of c.nodes) {
    const n = cn.node;
    const expressions = [...Object.values(cn.args), ...(cn.expr ? [cn.expr] : []), ...(cn.censor ? [cn.censor] : [])];
    const references = [...new Set(expressions.flatMap(expr => refs(expr).flatMap(ref => ref.index ? [ref.name, ref.index] : [ref.name])))];
    let formula: string, narrative: string;
    if (n.role === "deterministic") {
      formula = `${n.name} = ${n.expr}`;
      narrative = `式 ${n.expr} を計算して値を決める。ここでは新しい乱数を引かない。`;
    } else {
      const dist = n.dist!;
      formula = `${n.name} ~ ${dist.family}(${DIST_ARGS[dist.family].map(arg => `${arg}=${dist.args[arg]}`).join(", ")})`;
      const role = n.role === "param" ? "パラメーター" : n.role === "latent" ? "観測されない潜在量" : "観測される値";
      narrative = `${role}を${distributionStory[dist.family](dist.args)}から生成する定義。`;
    }
    if (cn.censor) {
      formula += `; 生成値 > ${n.censorAbove} のとき ${n.censorAbove} として記録`;
      narrative += ` 生成値が上限式 ${n.censorAbove} を厳密に超えた場合だけ上限値として記録する。等しい場合は打ち切らない。`;
    }
    steps.push({ name: n.name, label: n.label, unit: n.unit, role: n.role, scope: scope(n.plate), narrative, formula, references, note: n.note });
  }
  return { ok: true, steps };
}
