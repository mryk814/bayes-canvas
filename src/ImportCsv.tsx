import { useEffect, useRef, useState } from "react";
import type { Dataset, ModelVersion } from "../shared/contracts.ts";
import { parseCsv } from "../shared/csv.ts";
import { modelCsvFields, previewModelCsv } from "../shared/import-csv.ts";
import type { ImportOptions } from "../shared/import-csv.ts";
import { post } from "./api.ts";
import { DatasetPassport } from "./DatasetPassport.tsx";

export function ImportCsv(props: { version: ModelVersion; onImported?: (dataset: Dataset) => void }) {
  return <ImportForm key={props.version.id} {...props} />;
}

function ImportForm({ version, onImported }: { version: ModelVersion; onImported?: (dataset: Dataset) => void }) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [provenance, setProvenance] = useState<"" | "real" | "synthetic">("");
  const [columns, setColumns] = useState<ImportOptions["columns"]>({});
  const [passportFields, setPassportFields] = useState({ sampling: "", instrument: "", preprocessing: "" });
  const [preview, setPreview] = useState<ReturnType<typeof previewModelCsv> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const readSequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readSequence.current++; }; }, []);
  const fields = modelCsvFields(version.spec);
  const parsed = parseCsv(text);
  const passport = Object.fromEntries(Object.entries(passportFields).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
  const invalidate = () => { setPreview(null); setConfirmed(false); setMessage(""); };
  const updateMapping = (name: string, patch: Partial<{ source: string; unit: string }>) => {
    invalidate(); setColumns(current => ({ ...current, [name]: { ...(current[name] ?? { source: "", unit: "" }), ...patch } }));
  };
  return <section className="card stack" aria-label="CSV取り込み">
    <h3>CSVからデータを取り込む</h3>
    <p>対象: {version.spec.title} · 版 {version.number}。列と単位を指定し、確認後に保存します。</p>
    <fieldset disabled={busy} className="stack">
      <label>CSVファイル（UTF-8）<input type="file" accept=".csv,text/csv" onChange={async event => {
        const file = event.currentTarget.files?.[0]; if (!file) return;
        const sequence = ++readSequence.current;
        invalidate();
        try {
          const content = await file.text();
          if (!alive.current || sequence !== readSequence.current) return;
          setText(content); setLabel(file.name);
        } catch { if (alive.current) setMessage("ファイルを読み込めませんでした。CSVを貼り付けてください。"); }
      }} /></label>
      <label>CSV内容<textarea rows={6} value={text} placeholder="temperature,strength,group" onChange={event => { readSequence.current++; invalidate(); setText(event.target.value); }} /></label>
      <label>データ名<input value={label} onChange={event => { invalidate(); setLabel(event.target.value); }} /></label>
      <label>データの由来<select value={provenance} onChange={event => { invalidate(); setProvenance(event.target.value as typeof provenance); }}>
        <option value="">選択してください</option><option value="real">実際に観測したデータ</option><option value="synthetic">合成・試験データ</option>
      </select></label>
      <details className="dataset-passport-input"><summary>採取・装置・前処理を記録する（任意）</summary><div className="stack">
        <p className="small muted">わかる項目だけ記録できます。空欄は未記録になります。提供者の申告であり、妥当性をアプリが検証するものではありません。</p>
        <label>採取・対象の選び方<textarea rows={3} maxLength={2000} value={passportFields.sampling} onChange={event => { invalidate(); setPassportFields({ ...passportFields, sampling: event.target.value }); }}/></label>
        <label>装置・測定条件<textarea rows={3} maxLength={2000} value={passportFields.instrument} onChange={event => { invalidate(); setPassportFields({ ...passportFields, instrument: event.target.value }); }}/></label>
        <label>取り込み前の前処理<textarea rows={3} maxLength={2000} value={passportFields.preprocessing} onChange={event => { invalidate(); setPassportFields({ ...passportFields, preprocessing: event.target.value }); }} placeholder="このCSVができるまでに行った処理"/></label>
        <p className="small muted">各項目2000文字まで。ここは元CSVに至る処理の記録です。この画面での単位換算や群添字化は、別の自動来歴に残ります。</p>
      </div></details>
      {fields.map(field => <div className="stack" key={field.name}>
        <label>{field.label}（{field.name}） ← CSV列<select value={columns[field.name]?.source ?? ""} onChange={event => updateMapping(field.name, { source: event.target.value })}>
          <option value="">選択してください</option>{parsed.headers.map((header, i) => <option key={i} value={header}>{header}</option>)}
        </select></label>
        {field.indexOf ? <p>群名を初出順に0始まりの添字へ変換します。対応表を次の画面で確認してください。</p> : <label>元の単位 → {field.unit || "単位なし"}<select value={columns[field.name]?.unit ?? ""} onChange={event => updateMapping(field.name, { unit: event.target.value })}>
          <option value="">{field.unit ? "選択してください" : "単位なし"}</option>
          {[...new Set([field.unit, ...(["°C", "C", "K"].includes(field.unit) ? ["C", "K"] : ["MPa", "kPa"].includes(field.unit) ? ["MPa", "kPa"] : [])])].filter(Boolean).map(unit => <option key={unit}>{unit}</option>)}
        </select></label>}
      </div>)}
      <button type="button" className="btn" disabled={!text || !provenance} onClick={() => { setConfirmed(false); setMessage(""); if (provenance) setPreview(previewModelCsv(version, text, { label, provenance, columns, ...(Object.keys(passport).length ? { passport } : {}) })); }}>取り込み内容を確認</button>
    </fieldset>
    {preview && <div className="stack" aria-label="取り込みプレビュー">
      <h4>確認: {preview.rowCount} 行</h4>
      {preview.errors.map((error, i) => <p role="alert" key={i}>{error}</p>)}
      {preview.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
      {preview.dataset && <>
        <p>{preview.dataset.provenance === "real" ? "実測" : "合成"}データ「{preview.dataset.label}」。表示は先頭6行です。</p>
        <div className="tools-table"><table><thead><tr>{fields.map(field => <th key={field.name}>{field.label} {field.unit}</th>)}</tr></thead><tbody>
          {Array.from({ length: Math.min(6, preview.rowCount) }, (_, i) => <tr key={i}>{fields.map(field => <td key={field.name}>{preview.dataset!.columns[field.name][i]}</td>)}</tr>)}
        </tbody></table></div>
        {Object.entries(preview.groups).map(([name, categories]) => <div key={name}><strong>{name} の群対応</strong><ul>{categories.map((category, i) => <li key={i}>{JSON.stringify(category)} → {i}</li>)}</ul></div>)}
        <details><summary>保存する列・単位・群の来歴</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.dataset.note}</pre></details>
        <DatasetPassport passport={preview.dataset.passport}/>
        <label className="tools-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />対象モデル・列・単位・群対応・データの由来と、パスポートの記録／未記録を確認しました</label>
        <button className="btn btn-primary" type="button" disabled={!confirmed || busy} onClick={async () => {
          if (!preview.dataset || busy) return;
          setBusy(true); setMessage("");
          try {
            const dataset = await post<Dataset>("/api/human/datasets", { ...preview.dataset, versionId: version.id });
            if (!alive.current) return;
            setMessage(`「${dataset.label}」を保存しました。`); setPreview(null); setConfirmed(false); onImported?.(dataset);
          } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : String(error)); }
          finally { if (alive.current) setBusy(false); }
        }}>{busy ? "保存中…" : "確認したデータを保存"}</button>
      </>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
