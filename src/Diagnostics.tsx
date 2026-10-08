import type { Run } from "../shared/contracts.ts";
import { diagnoseRun } from "../shared/diagnose.ts";

const statusLabel = {
  attention: "要確認",
  unavailable: "情報不足・不正",
  "within-guide": "目安内",
  "not-applicable": "適用外",
};

export function Diagnostics({ run, currentVersionId }: { run: Run; currentVersionId: string }) {
  const report = diagnoseRun(run, currentVersionId);
  return (
    <section className="stack" aria-label="推論診断と次の確認">
      <div>
        <h3>計算のどこを確かめる？</h3>
        <p className="small muted">{run.method} · run {report.runId}</p>
        <p className="small muted">モデル版 {report.versionId} · データ {report.datasetId}</p>
        {report.stale && <p className="small"><span className="badge badge-warn">旧版の結果</span> 現在の版の診断ではありません。</p>}
      </div>
      {report.checks.map(check => (
        <article className="card" key={check.id}>
          <header>
            <strong>{check.title}：{check.value ?? "未取得"}</strong>
            <span className={`badge ${check.status === "within-guide" ? "" : "badge-warn"}`}>{statusLabel[check.status]}</span>
          </header>
          <p className="small">{check.reason}</p>
          <p className="small muted">次に：{check.next}</p>
        </article>
      ))}
      <p className="small muted">{report.summary}</p>
    </section>
  );
}
