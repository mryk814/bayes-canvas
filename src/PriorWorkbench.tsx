import { useState } from "react";
import type { Family, Proposal, State } from "../shared/contracts.ts";
import { buildPriorSpec, priorTargets, validatePriorPreview } from "../shared/prior-workbench.ts";
import { compileSpec, simulateWorlds, viewPoints, type ViewPoint } from "../shared/sim.ts";
import { ErrorNote, ProposalCard } from "./Ledger.tsx";
import { sharedDomains, WorldPlot, type Domains } from "./WorldPlot.tsx";
import { post, useAction } from "./api.ts";
import "./prior-workbench.css";

const meanings: Record<Family, string> = {
  normal: "muは平均、sigmaは標準偏差です。どちらも量と同じ単位です。",
  lognormal: "muとsigmaは対数上の正規分布の平均と標準偏差です。量そのものの平均・標準偏差ではありません。",
  halfnormal: "sigmaは0を中心とした正規分布の標準偏差です。その絶対値を生成します。",
  exponential: "rateは率です。平均は1/rate、rateの単位は量の単位の逆数です。",
  uniform: "lowerとupperは下限と上限で、量と同じ単位です。",
  studentt: "nuは自由度、muは位置、sigmaは尺度です。sigmaは標準偏差ではありません。",
  gamma: "shapeは形状、rateは率です。平均はshape/rate、rateの単位は量の単位の逆数です。",
  beta: "aとbは形状パラメータです。0～1の値を生成します。",
  poisson: "rateは生成する件数の平均です。非負整数を生成します。",
  bernoulli: "pは1になる確率です。0または1を生成します。",
  binomial: "nは試行数、pは各試行の成功確率です。成功した件数を生成します。",
};
const textArgs = (args: Record<string, number>) => Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)]));

export function PriorWorkbench({ state, modelId }: { state: State; modelId: string }) {
  const current = state.versions.find(v => v.id === state.models.find(m => m.id === modelId)!.currentVersionId)!;
  const [base, setBase] = useState(current);
  const targets = priorTargets(base.spec);
  const [nodeName, setNodeName] = useState(() => targets[0]?.nodeName ?? "");
  const target = targets.find(item => item.nodeName === nodeName);
  const [args, setArgs] = useState<Record<string, string>>(() => textArgs(target?.args ?? {}));
  const [seed, setSeed] = useState("1");
  const seedValue = Number(seed);
  const comparisonSeed = seed.trim() && Number.isSafeInteger(seedValue) && seedValue >= 0 && seedValue <= 2147483647 ? seedValue : 1;
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ before: ViewPoint[][]; after: ViewPoint[][]; domains: Domains; seed: number; args: Record<string, number> } | null>(null);
  const [problem, setProblem] = useState("");
  const [created, setCreated] = useState<Proposal | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const action = useAction();
  const stale = base.id !== current.id;
  const invalidate = () => { setPreview(null); setProblem(""); setSubmitted(false); action.clear(); };
  const loadCurrent = () => {
    const first = priorTargets(current.spec)[0];
    setBase(current); setNodeName(first?.nodeName ?? ""); setArgs(textArgs(first?.args ?? {})); setReason(""); invalidate();
  };
  const proposals = state.proposals.filter(p => p.modelId === modelId && p.status === "proposed");
  if (created && !state.proposals.some(p => p.id === created.id)) proposals.push(created);
  return <section className="stack prior-workbench" aria-label="priorを試す">
    <div><h2>priorを試す</h2><p className="muted">分布の引数を調整して、生成される世界を比べます。run選択とは独立したpriorの定義です。事後推論や因果効果ではありません。</p></div>
    <p>基点: v{base.number} · <code>{base.id}</code></p>
    {stale && <><p className="warn-note">現在の版が変わりました。下書きは保持していますが、旧基点からは提案できません。</p><button className="btn" disabled={action.busy} onClick={loadCurrent}>下書きを置き換え、最新版を読み込む</button></>}
    <p className="small muted">対象は、分布引数がすべて有限の数値リテラルであるスカラーparamです。式や群プレートを持つ量、latent・observed・計算ノードは対象外です。推測で数値に置き換えず、分布族も変えません。</p>
    {target ? <article className="card stack">
      <fieldset className="stack" disabled={action.busy || stale}>
        <label>試す量<select value={nodeName} onChange={event => { const next = targets.find(t => t.nodeName === event.target.value)!; setNodeName(next.nodeName); setArgs(textArgs(next.args)); invalidate(); }}>{targets.map(t => <option key={t.nodeName} value={t.nodeName}>{t.label} ({t.nodeName})</option>)}</select></label>
        <p><strong>{target.family}</strong> · 量の単位: {target.unit || "単位なし"}</p>
        <p className="small muted">{meanings[target.family]}</p>
        <div className="prior-arguments">{Object.entries(args).map(([name, value]) => <label key={`${nodeName}:${name}`}>{name} <span className="muted small">元の値: {target.args[name]}</span><input type="text" inputMode="decimal" value={value} onChange={event => { setArgs({ ...args, [name]: event.target.value }); invalidate(); }}/></label>)}</div>
        <div className="prior-seed"><label>比較のseed<input type="text" inputMode="numeric" value={seed} onChange={event => { setSeed(event.target.value); invalidate(); }}/></label><button className="btn" onClick={() => { setArgs(textArgs(target.args)); invalidate(); }}>引数を元に戻す</button></div>
        <label>試す理由<textarea rows={3} maxLength={2000} value={reason} onChange={event => { setReason(event.target.value); invalidate(); }}/></label>
        <button className="btn" onClick={() => {
          invalidate();
          try {
            if (Object.values(args).some(value => !value.trim() || !Number.isFinite(Number(value)))) throw new Error("各引数に有限の数値を入力してください。");
            if (!seed.trim()) throw new Error("seedを入力してください。");
            const values = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, Number(value)]));
            const spec = buildPriorSpec(base.spec, nodeName, values);
            validatePriorPreview(base.spec, spec, Number(seed));
            const points = [base.spec, spec].flatMap(candidate => {
              const compiled = compileSpec(candidate);
              if (!compiled.ok) throw new Error(compiled.problems.join(" / "));
              return simulateWorlds(compiled.compiled, Number(seed), 6).map(world => viewPoints(compiled.compiled, world));
            });
            const domains = sharedDomains(points);
            if ([domains.x, domains.y].some(([lo, hi]) => !Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(hi - lo) || hi <= lo)) throw new Error("生成値の範囲が大きすぎるため、共通軸で比較できません。引数を見直してください。");
            setPreview({ before: points.slice(0, 6), after: points.slice(6), domains, seed: Number(seed), args: values });
          } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
        }}>同じseedでプレビュー</button>
      </fieldset>
      {problem && <p className="error-note" role="alert">{problem}</p>}
      {preview && <section className="stack" aria-label="priorの比較プレビュー"><h3>v{base.number}の基点と候補 · seed {preview.seed}</h3>
        <div className="prior-pairs">{preview.before.map((before, index) => <article className="prior-pair" key={index} aria-label={`世界${index}の比較`}>
          <h4>世界 {index}</h4>
          <div><p className="small muted">基点</p><WorldPlot points={[before]} domains={preview.domains} width={160} height={92}/></div>
          <div><p className="small muted">候補</p><WorldPlot points={[preview.after[index]]} domains={preview.domains} width={160} height={92}/></div>
        </article>)}</div>
        <p className="small muted">各6世界の例示を同じseed・共通軸で並べます。同じseedでも乱数消費が変わる場合があり、個体の反実仮想対応ではありません。図の外の値を含め、分布全体を保証する比較ではありません。</p></section>}
      <button className="btn btn-primary" disabled={!preview || stale || action.busy || submitted || !reason.trim() || reason.trim().length > 2000} onClick={() => action.run(async () => {
        if (!preview) return;
        setCreated(await post<Proposal>("/api/human/prior-proposals", { baseVersionId: base.id, nodeName, args: preview.args, reason: reason.trim() }));
        setSubmitted(true);
      })}>このpriorの変更を提案</button>
      <ErrorNote error={action.error}/>{submitted && <p role="status">提案を作りました。採用するまではモデル版は変わりません。</p>}
      <p className="small muted">理由は1～2000文字。編集するとプレビューは無効になります。提案作成だけではモデル版・Dataset・runを変更しません。</p>
    </article> : <p className="empty-note">この版には、ここで調整できるpriorがありません。</p>}
    <section className="stack" aria-label="このモデルの未採用提案"><h3>差分を確かめ、採用する</h3><p className="small muted">このモデルの未採用提案をすべて表示します。ほかの道具からの提案も含みます。比較はseed {comparisonSeed}を使います（seed入力が不正な場合は1）。採用・見送りを明示的に選んでください。</p>{proposals.length ? proposals.map(p => <ProposalCard key={p.id} proposal={p} state={state} seed={comparisonSeed}/>) : <p className="empty-note">未採用の提案はありません。</p>}</section>
  </section>;
}
