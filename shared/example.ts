import type { ModelSpec } from "./contracts.ts";

// An illustrative starting point, deliberately vague so the worlds it produces
// include implausible ones worth talking about. Not fitted to any real data.
export const EXAMPLE_SPEC: ModelSpec = {
  title: "材料強度と試験温度（模式例）",
  question: "温度が上がると、この材料の引張強度はどう変わるか",
  x: { name: "T", label: "試験温度", unit: "°C", min: 20, max: 300, points: 15 },
  y: { name: "strength", label: "引張強度", unit: "MPa" },
  params: [
    { name: "s20", label: "20°C での強度", unit: "MPa", prior: { family: "normal", mu: 400, sigma: 150 }, note: "" },
    { name: "slope", label: "温度あたりの変化", unit: "MPa/°C", prior: { family: "normal", mu: 0, sigma: 2 }, note: "" },
    { name: "curv", label: "曲がり", unit: "MPa/°C²", prior: { family: "normal", mu: 0, sigma: 0.01 }, note: "" },
    { name: "sigma", label: "ばらつき", unit: "MPa", prior: { family: "halfnormal", sigma: 40 }, note: "" },
  ],
  mean: "s20 + slope * (T - 20) + curv * (T - 20)^2",
  noise: { family: "normal", sigma: "sigma" },
};
