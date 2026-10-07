import { AgentDatasetInput } from "./contracts.ts";
import type { Dataset, ModelSpec, ModelVersion } from "./contracts.ts";
import { parseCsv } from "./csv.ts";
import { datasetProblems } from "./evidence-validation.ts";

export type ImportOptions = { label: string; provenance: "real" | "synthetic"; passport?: Dataset["passport"]; columns: Record<string, { source: string; unit: string }> };
export function modelCsvFields(spec: ModelSpec) {
  return [...spec.data.map(d => ({ name: d.name, label: d.label, unit: d.unit, plate: d.plate as string | null, indexOf: d.indexOf })),
    ...spec.nodes.filter(n => n.role === "observed").map(n => ({ name: n.name, label: n.label, unit: n.unit, plate: n.plate, indexOf: null as string | null }))];
}
const unitName = (unit: string) => unit === "°C" ? "C" : unit;
function convert(value: number, from: string, to: string): number {
  from = unitName(from); to = unitName(to);
  if (from === to) return value;
  if (from === "K" && to === "C") return value - 273.15;
  if (from === "C" && to === "K") return value + 273.15;
  if (from === "kPa" && to === "MPa") return value / 1000;
  if (from === "MPa" && to === "kPa") return value * 1000;
  return NaN;
}
export function previewModelCsv(version: ModelVersion, text: string, options: ImportOptions) {
  const parsed = parseCsv(text);
  const errors = parsed.errors.map(e => `${e.row ? `行 ${e.row}: ` : ""}${e.message}`);
  const warnings: string[] = [];
  const fields = modelCsvFields(version.spec);
  const plates: Record<string, number> = {};
  const columns: Record<string, number[]> = {};
  const groups: Record<string, string[]> = {};
  const rowPlates = new Set(fields.map(f => f.plate));
  if (rowPlates.size !== 1 || rowPlates.has(null)) errors.push("入力・観測列が同じプレート上にある矩形CSVのみ対応しています。別プレートや単独観測は個別に準備してください。");
  const rowPlate = fields[0]?.plate;
  const targets = fields.filter(f => f.indexOf).map(f => f.indexOf!);
  if (targets.includes(rowPlate ?? "") || new Set(targets).size !== targets.length) errors.push("同じプレートを複数列から参照する構造、または自己参照には対応していません。");
  for (const p of version.spec.plates) {
    if (p.name !== rowPlate && !targets.includes(p.name)) errors.push(`プレート ${p.name} の大きさをCSVから明示できません。`);
  }
  if (!parsed.records.length || parsed.records.length > 5000) errors.push("データ行は1〜5000行にしてください。");
  if (!options.label.trim()) errors.push("データ名を入力してください。");
  const selected = fields.map(f => options.columns[f.name]?.source);
  if (new Set(selected).size !== selected.length) errors.push("入力・観測にはそれぞれ別のCSV列を対応してください。");
  for (const field of fields) {
    const mapping = options.columns[field.name];
    if (!mapping || !parsed.headers.includes(mapping.source)) { errors.push(`${field.label} の元の列を指定してください。`); continue; }
    if (!field.indexOf && !Number.isFinite(convert(0, mapping.unit, field.unit))) errors.push(`${field.label}: ${mapping.unit || "単位なし"} から ${field.unit || "単位なし"} への換算は未対応です。`);
    const at = parsed.headers.indexOf(mapping.source);
    const categories: string[] = [];
    columns[field.name] = parsed.records.map((record, i) => {
      const raw = record[at] ?? "";
      if (field.indexOf) {
        if (!raw.trim()) errors.push(`行 ${i + 2}: ${field.label} が空です。`);
        if (!categories.includes(raw)) categories.push(raw);
        return categories.indexOf(raw);
      }
      const trimmed = raw.trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) { errors.push(`行 ${i + 2}: ${field.label} は有限の数値で指定してください。`); return NaN; }
      const value = convert(Number(trimmed), mapping.unit, field.unit);
      if (!Number.isFinite(value)) errors.push(`行 ${i + 2}: ${field.label} の換算結果が有限ではありません。`);
      if ((unitName(field.unit) === "C" && value < -273.15) || (field.unit === "K" && value < 0)) errors.push(`行 ${i + 2}: ${field.label} が絶対零度未満です。`);
      return value;
    });
    if (field.indexOf) { groups[field.name] = categories; plates[field.indexOf] = categories.length; }
  }
  if (rowPlate) plates[rowPlate] = parsed.records.length;
  for (const header of parsed.headers) if (!selected.includes(header)) warnings.push(`列「${header}」は取り込み対象外です。`);
  const input = {
    modelId: version.modelId, label: options.label.trim(), provenance: options.provenance, plates, columns,
    ...(options.passport === undefined ? {} : { passport: options.passport }),
    note: `CSV取込・確認対象版 ${version.id}\n列・単位対応: ${JSON.stringify(options.columns)}\n群対応（配列位置=0始まり添字）: ${JSON.stringify(groups)}`,
  };
  const validated = AgentDatasetInput.safeParse(input);
  if (!validated.success) errors.push(...validated.error.issues.map(i => `${i.path.join(".")}: ${i.message}`));
  else errors.push(...datasetProblems(version.spec, validated.data));
  return { errors, warnings, groups, rowCount: parsed.records.length, dataset: errors.length || !validated.success ? null : validated.data as Omit<Dataset, "id" | "createdAt"> };
}
