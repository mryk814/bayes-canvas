import { useMemo } from "react";
import { drawCount, type Compiled, type ViewPoint, type World } from "../shared/sim.ts";
import { summarizeWorldView } from "../shared/view-contract.ts";
import type { Focus, Source } from "./Stage.tsx";
import type { DataPoint, Domains } from "./WorldPlot.tsx";
import "./view-contract.css";

type Props = {
  compiled: Compiled; versionId: string; versionNumber: number; seed: number; source: Source;
  worlds: World[]; points: ViewPoint[][]; data: DataPoint[]; domains: Domains; showObs: boolean; focus: Focus;
};

export function ViewContract(p: Props) {
  const summary = useMemo(() => summarizeWorldView({ spec: p.compiled.spec, worlds: p.worlds, points: p.points, data: p.data, domains: p.domains, showObs: p.showObs, focus: p.focus }), [p.compiled, p.worlds, p.points, p.data, p.domains, p.showObs, p.focus]);
  const source = p.source;
  const referenceMismatch = source.kind === "run" && (source.run.versionId !== p.versionId || source.run.datasetId !== source.dataset.id || source.run.modelId !== source.dataset.modelId);
  const quantity = (q: { name: string; label: string; unit: string } | null) => q ? `${q.label} (${q.name})${q.unit ? ` [${q.unit}]` : " · 単位なし"}` : "指定なし";
  return <details className="view-contract">
    <summary>図の表示条件</summary>
    <div className="view-contract-body">
      <p className="small muted">世界の棚と開いた図の条件です。表示変更はモデル・データ・runを変更しません。</p>
      <section aria-label="図の参照元">
        <h3>参照元</h3>
        <dl>
          <dt>表示中の版</dt><dd>v{p.versionNumber} · <code>{p.versionId}</code>{source.kind === "run" && source.stale && <strong> · 旧版の結果</strong>}</dd>
          <dt>seed</dt><dd>{p.seed}</dd>
          <dt>世界の由来</dt><dd>{source.kind === "prior" ? "priorからの生成世界（実データではありません）" : `保存run · 方法: ${source.run.method}`}</dd>
          {source.kind === "run" && <>
            <dt>run</dt><dd><code>{source.run.id}</code> · 全{drawCount(source.run)} draw</dd>
            <dt>Dataset</dt><dd>{source.dataset.label} · {source.dataset.provenance === "synthetic" ? "合成" : "実測"}<br/><code>{source.dataset.id}</code></dd>
          </>}
        </dl>
      </section>
      {referenceMismatch || !summary.ok ? <p className="error-note" role="alert">表示条件を照合できません: {referenceMismatch ? "runのモデル版またはDataset参照が表示対象と一致しません" : !summary.ok ? summary.problems.join(" / ") : ""}</p> : <>
        <section aria-label="共通軸の条件">
          <h3>共通軸と表示する量</h3>
          <dl>
            <dt>x軸（線形）</dt><dd>{quantity(summary.axes.x)}<br/>{summary.axes.x.domain.join(" ～ ")}</dd>
            <dt>y軸（線形）</dt><dd>{quantity(summary.axes.y)}<br/>{summary.axes.y.domain.join(" ～ ")}</dd>
            <dt>線</dt><dd>{quantity(summary.axes.line)} · 確率帯ではありません</dd>
            <dt>群</dt><dd>{quantity(summary.axes.group)}</dd>
          </dl>
          <p className="small muted">棚と単独・重ねの図は同じ軸範囲です。xは有限な点の最小・最大に余白を加えます。yは全表示世界とデータの有限な点、線の値の2・98%点に余白と目盛り調整を加えます。x・yがともに有限な点がなければ両軸とも0～1です。全極値を含む保証はなく、範囲外は図の枠で切られます。</p>
        </section>
        <section aria-label="表示対象の点数">
          <h3>棚と詳細の対象</h3>
          <p>棚の{source.kind === "prior" ? "世界" : "draw"}番号: {summary.worldIndices.join(", ") || "なし"}</p>
          {source.kind === "run" && <p className="small muted">最大12本を全drawの範囲から等間隔の添字で選び、12本以下なら全drawを表示します。表示用の抽出で、診断・確率計算の標本選別ではありません。</p>}
          {summary.brokenWorldIndices.length > 0 && <p className="warn-note">壊れた値を持つ世界: {summary.brokenWorldIndices.join(", ")}</p>}
          <Counts label="棚の点数" counts={summary.grid}/>
          {summary.focus ? <>
            <p>詳細: {p.focus === "all" ? "重ね表示" : "単独表示"} · 番号 {summary.focus.worldIndices.join(", ")}</p>
            <Counts label="詳細の点数" counts={summary.focus}/>
          </> : <p className="small muted">詳細の図は閉じています。</p>}
          <p className="small muted">「非有限」はxかyが有限でない点。「範囲外」は有限な中心座標が軸範囲外の点です。ピクセルの可視性や線の本数は数えていません。Datasetは棚の各図で共通の一組を使い、表では一回だけ数えます。</p>
        </section>
        <p className="small muted">生成点は{p.showObs ? "表示ON" : "表示OFF"}。チェックを外すと生成点を隠します。重ね表示では、line値が設定された点が2点以上ある世界の生成点も隠します。Dataset点はどちらの操作でも残ります。「規則で隠す」は非有限・範囲外と重複することがあります。</p>
      </>}
    </div>
  </details>;
}

type Count = { total: number; nonFinite: number; outside: number };
function Counts({ label, counts }: { label: string; counts: { generated: Count; data: Count; suppressedGenerated: number } }) {
  return <div className="view-contract-table" tabIndex={0} role="region" aria-label={label}><table>
    <caption>{label}</caption>
    <thead><tr><th scope="col">点の由来</th><th scope="col">全点</th><th scope="col">非有限</th><th scope="col">範囲外</th><th scope="col">規則で隠す</th></tr></thead>
    <tbody>{([["生成", counts.generated, counts.suppressedGenerated], ["Dataset", counts.data, 0]] as const).map(([name, values, hidden]) => <tr key={name}><th scope="row">{name}</th><td>{values.total}</td><td>{values.nonFinite}</td><td>{values.outside}</td><td>{hidden}</td></tr>)}</tbody>
  </table></div>;
}
