export type CsvIssue = { severity: "error" | "warning"; row?: number; column?: string; message: string };
export type CsvMapping = {
  columns: { temperature: string; strength: string; group: string };
  units: { temperature: string; strength: string };
};
export type CsvRow = { temperature: number; strength: number; group: string };

/** Row numbers count CSV records, including the header, rather than physical lines. */
export function parseCsv(text: string): { headers: string[]; records: string[][]; errors: CsvIssue[] } {
  const errors: CsvIssue[] = [];
  const records: string[][] = [];
  let record: string[] = [], field = "", quoted = false, closed = false;
  const source = text.replace(/^\uFEFF/, "");
  const error = (message: string) => errors.push({ severity: "error", row: records.length + 1, message });
  const endField = () => { record.push(field); field = ""; closed = false; };
  const endRecord = () => { endField(); records.push(record); record = []; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (char === ",") endField();
    else if (char === "\r" || char === "\n") {
      endRecord();
      if (char === "\r" && source[i + 1] === "\n") i++;
    } else if (closed) error("閉じ引用符の後は区切りまたは改行が必要です。");
    else if (char === '"') {
      if (field.length) error("引用符はフィールドの先頭に置いてください。");
      else quoted = true;
    } else field += char;
  }
  if (quoted) error("引用符が閉じられていません。");
  if (field.length || record.length || closed || quoted) endRecord();
  const headers = (records.shift() ?? []).map(header => header.trim());
  if (!headers.length || headers.some(header => !header)) errors.push({ severity: "error", row: 1, message: "空でない列名が必要です。" });
  if (new Set(headers).size !== headers.length) errors.push({ severity: "error", row: 1, message: "列名が重複しています。" });
  records.forEach((row, i) => {
    if (row.length !== headers.length) errors.push({ severity: "error", row: i + 2, message: `列数が一致しません（期待 ${headers.length}、実際 ${row.length}）。` });
  });
  return { headers, records, errors };
}

export function previewCsv(text: string, mapping: CsvMapping) {
  const parsed = parseCsv(text);
  const issues: CsvIssue[] = [...parsed.errors];
  const provenance = {
    columns: { ...mapping.columns }, sourceUnits: { ...mapping.units },
    targetUnits: { temperature: "C", strength: "MPa" },
    recordCount: parsed.records.length,
  };
  const fail = (message: string, row?: number, column?: string) => issues.push({ severity: "error", message, row, column });
  if (!["C", "K"].includes(mapping.units.temperature)) fail("温度単位は C または K を明示してください。");
  if (!["MPa", "kPa"].includes(mapping.units.strength)) fail("強度単位は MPa または kPa を明示してください。");
  const selected = Object.values(mapping.columns);
  if (new Set(selected).size !== selected.length) fail("温度・強度・群には別々の列を指定してください。");
  for (const name of selected) if (!parsed.headers.includes(name)) fail(`指定列「${name}」がありません。`, 1, name);
  for (const name of parsed.headers) if (!selected.includes(name)) issues.push({ severity: "warning", column: name, message: `列「${name}」は取り込み対象外です。` });
  if (!parsed.records.length) fail("データ行がありません。");
  const rows: CsvRow[] = [];
  if (!issues.some(issue => issue.severity === "error")) {
    const index = {
      temperature: parsed.headers.indexOf(mapping.columns.temperature),
      strength: parsed.headers.indexOf(mapping.columns.strength),
      group: parsed.headers.indexOf(mapping.columns.group),
    };
    parsed.records.forEach((record, i) => {
      const number = (key: "temperature" | "strength") => {
        const value = record[index[key]].trim();
        // Decimal scientific notation only; blank strings and JS hex literals are not measurements.
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
          fail(`「${mapping.columns[key]}」に有限の数値が必要です。`, i + 2, mapping.columns[key]);
          return NaN;
        }
        return Number(value);
      };
      const temperature = number("temperature") - (mapping.units.temperature === "K" ? 273.15 : 0);
      const strength = number("strength") / (mapping.units.strength === "kPa" ? 1000 : 1);
      const group = record[index.group];
      if (!group.trim()) fail("群の値が空です。", i + 2, mapping.columns.group);
      if (temperature < -273.15) fail("温度が絶対零度を下回っています。", i + 2, mapping.columns.temperature);
      rows.push({ temperature, strength, group });
    });
  }
  const canImport = !issues.some(issue => issue.severity === "error");
  return { canImport, headers: parsed.headers, rows: canImport ? rows : [], issues, provenance };
}

export const CSV_EXAMPLES: { name: string; text: string; mapping: CsvMapping }[] = [
  {
    name: "合成データ · C / MPa",
    text: "temperature,strength,group\n20,42,A\n40,39,A\n60,35,A\n20,47,B\n40,44,B\n60,40,B\n",
    mapping: { columns: { temperature: "temperature", strength: "strength", group: "group" }, units: { temperature: "C", strength: "MPa" } },
  },
  {
    name: "合成データ · K / kPa",
    text: "temp_K,load_kPa,batch\n293.15,42000,A\n313.15,39000,A\n333.15,35000,A\n293.15,47000,B\n313.15,44000,B\n333.15,40000,B\n",
    mapping: { columns: { temperature: "temp_K", strength: "load_kPa", group: "batch" }, units: { temperature: "K", strength: "kPa" } },
  },
];
