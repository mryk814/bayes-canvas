import type { ModelSpec } from "./contracts.ts";

// Illustrative starting points. Deliberately imperfect so their worlds give
// something to talk about. Not fitted to any real data.

export const CURVE_EXAMPLE: ModelSpec = {
  title: "材料強度と試験温度（模式例）",
  question: "温度が上がると、この材料の引張強度はどう変わるか",
  plates: [{ name: "point", label: "測定点", size: 15 }],
  data: [{ name: "T", label: "試験温度", unit: "°C", plate: "point", indexOf: null, generate: { kind: "linspace", from: 20, to: 300 } }],
  nodes: [
    { name: "s20", label: "20°C での強度", unit: "MPa", plate: null, role: "param", dist: { family: "normal", args: { mu: "400", sigma: "150" } }, note: "" },
    { name: "slope", label: "温度あたりの変化", unit: "MPa/°C", plate: null, role: "param", dist: { family: "normal", args: { mu: "0", sigma: "2" } }, note: "" },
    { name: "curv", label: "曲がり", unit: "MPa/°C²", plate: null, role: "param", dist: { family: "normal", args: { mu: "0", sigma: "0.01" } }, note: "" },
    { name: "sigma", label: "ばらつき", unit: "MPa", plate: null, role: "param", dist: { family: "halfnormal", args: { sigma: "40" } }, note: "" },
    { name: "mu", label: "平均の強度", unit: "MPa", plate: "point", role: "deterministic", expr: "s20 + slope * (T - 20) + curv * (T - 20)^2", note: "" },
    { name: "strength", label: "引張強度", unit: "MPa", plate: "point", role: "observed", dist: { family: "normal", args: { mu: "mu", sigma: "sigma" } }, note: "" },
  ],
  view: { x: "T", y: "strength", line: "mu" },
};

// Inside a Dot: every recorded value passes through the specimen, the machine and the recorder.
export const OBSERVATION_EXAMPLE: ModelSpec = {
  title: "試験機で測る材料強度（模式例・観測過程つき）",
  question: "記録された強度のばらつきは、材料の差か、試験機と記録の仕組みか",
  plates: [
    { name: "specimen", label: "試料", size: 36 },
    { name: "machine", label: "試験機", size: 3 },
  ],
  data: [
    { name: "T", label: "試験温度", unit: "°C", plate: "specimen", indexOf: null, generate: { kind: "linspace", from: 20, to: 300 } },
    { name: "machine_of", label: "使った試験機", unit: "", plate: "specimen", indexOf: "machine", generate: { kind: "cycle" } },
  ],
  nodes: [
    { name: "s20", label: "20°C での材料強度", unit: "MPa", plate: null, role: "param", dist: { family: "normal", args: { mu: "450", sigma: "60" } }, note: "" },
    { name: "decline", label: "温度あたりの低下", unit: "MPa/°C", plate: null, role: "param", dist: { family: "halfnormal", args: { sigma: "1" } }, note: "" },
    { name: "sigma_mat", label: "材料の個体差", unit: "MPa", plate: null, role: "param", dist: { family: "halfnormal", args: { sigma: "25" } }, note: "" },
    { name: "true_strength", label: "試料の真の強度", unit: "MPa", plate: "specimen", role: "latent", dist: { family: "normal", args: { mu: "s20 - decline * (T - 20)", sigma: "sigma_mat" } }, note: "観測されない" },
    { name: "tau_bias", label: "試験機の偏りの大きさ", unit: "MPa", plate: null, role: "param", dist: { family: "halfnormal", args: { sigma: "15" } }, note: "" },
    { name: "bias", label: "試験機の偏り", unit: "MPa", plate: "machine", role: "latent", dist: { family: "normal", args: { mu: "0", sigma: "tau_bias" } }, note: "" },
    { name: "sigma_meas", label: "測定誤差", unit: "MPa", plate: null, role: "param", dist: { family: "halfnormal", args: { sigma: "10" } }, note: "全試験機・全温度で同じと仮定" },
    {
      name: "recorded", label: "記録された強度", unit: "MPa", plate: "specimen", role: "observed",
      dist: { family: "normal", args: { mu: "true_strength + bias[machine_of]", sigma: "sigma_meas" } },
      censorAbove: "520", note: "試験機の荷重上限を超えると 520 として記録される",
    },
  ],
  view: { x: "T", y: "recorded", group: "machine_of" },
};

export const EXAMPLES: { id: string; label: string; summary: string; spec: ModelSpec }[] = [
  { id: "curve", label: "温度と強度の曲線", summary: "パラメータ4つの単純な曲線。prior の世界に慣れるため", spec: CURVE_EXAMPLE },
  { id: "observation", label: "観測点を開く", summary: "試料・試験機・記録上限を通って値が記録される。点を開いて層を指す", spec: OBSERVATION_EXAMPLE },
];
