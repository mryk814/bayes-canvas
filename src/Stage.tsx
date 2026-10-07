import { motion, AnimatePresence } from "motion/react";
import { IconArrowsShuffle, IconPencil, IconPointer, IconRulerMeasure, IconX, IconCheck, IconStack2 } from "@tabler/icons-react";
import type { Dataset, Mark, Run } from "../shared/contracts.ts";
import type { Compiled, ViewPoint, World } from "../shared/sim.ts";
import { Anatomy } from "./Anatomy.tsx";
import { Lens } from "./Lens.tsx";
import { Shape } from "./Shape.tsx";
import { fmt, groupName, pad } from "./format.ts";
import { WorldPlot, type DataPoint, type Domains, type Tool } from "./WorldPlot.tsx";

export type Focus = number | "all" | null;
export type Source = { kind: "prior" } | { kind: "run"; run: Run; dataset: Dataset; stale: boolean };
export type RunOption = { id: string; label: string };
export type StageMode = "worlds" | "lens" | "shape";

type Props = {
  compiled: Compiled;
  versionNumber: number;
  seed: number;
  source: Source;
  runOptions: RunOption[];
  sourceValue: string;
  pending: string | null;
  worlds: World[];
  points: ViewPoint[][];
  data: DataPoint[];
  domains: Domains;
  marks: Mark[];
  focus: Focus;
  tool: Tool;
  showObs: boolean;
  reseedBlocked: boolean;
  opened: number | null;
  mode: StageMode;
  onMode: (m: StageMode) => void;
  onSource: (runId: string | null) => void;
  onFocus: (f: Focus) => void;
  onTool: (t: Tool) => void;
  onShowObs: (v: boolean) => void;
  onReseed: () => void;
  onMark: (m: Mark) => void;
  onOpen: (unit: number | null) => void;
};

export function verdictOf(marks: Mark[], world: number) {
  const v = marks.find((m) => m.kind === "verdict" && m.world === world);
  return v?.kind === "verdict" ? v.verdict : null;
}

export function worldName(source: Source, index: number) {
  return source.kind === "prior" ? `世界 ${pad(index)}` : `draw ${index}`;
}

export function Stage(p: Props) {
  const spec = p.compiled.spec;
  const unitOf = (name: string) => [...spec.data, ...spec.nodes].find((n) => n.name === name);
  const label = (name: string) => {
    const n = unitOf(name);
    return n ? `${n.label}${n.unit ? ` [${n.unit}]` : ""}` : name;
  };
  const labels = { x: label(spec.view.x), y: label(spec.view.y) };
  const focusIdx = typeof p.focus === "number" ? p.worlds.findIndex((w) => w.index === p.focus) : -1;
  const focusPoints = p.focus === "all" ? p.points : focusIdx >= 0 ? [p.points[focusIdx]] : [];
  const focusMarks = p.marks.filter((m) => m.kind !== "verdict" && m.kind !== "ridge" && m.kind !== "shape" && m.kind !== "bin" && (p.focus === "all" ? m.world === null : m.world === p.focus));
  const toggleVerdict = (world: number, verdict: "implausible" | "plausible") => p.onMark({ kind: "verdict", world, verdict });
  const group = spec.view.group;
  const groupValues = group ? [...new Set(p.points[0]?.map((q) => q.group).filter((g): g is number => g !== null))].sort((a, b) => a - b) : [];
  const dataRow = p.source.kind === "run" && p.opened !== null ? p.data.find((d) => d.unit === p.opened) ?? null : null;

  return (
    <section className="stage" aria-label="可能世界">
      <div className="stage-bar">
        <Provenance source={p.source} versionNumber={p.versionNumber} seed={p.seed} pending={p.pending} />
        <div className="stage-actions">
          <label className="select">
            <span className="muted small">見る世界</span>
            <select value={p.sourceValue} onChange={(e) => p.onSource(e.target.value || null)}>
              <option value="">prior</option>
              {p.runOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="group" aria-label="表示">
            <button className={`btn ${p.mode === "worlds" ? "is-on" : ""}`} aria-pressed={p.mode === "worlds"} onClick={() => p.onMode("worlds")}>
              世界を並べる
            </button>
            <button className={`btn ${p.mode === "shape" ? "is-on" : ""}`} aria-pressed={p.mode === "shape"} onClick={() => p.onMode("shape")}>
              形
            </button>
            {p.source.kind === "run" && (
              <button className={`btn ${p.mode === "lens" ? "is-on" : ""}`} aria-pressed={p.mode === "lens"} onClick={() => p.onMode("lens")}>
                識別性
              </button>
            )}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={p.showObs} onChange={(e) => p.onShowObs(e.target.checked)} />
            {p.source.kind === "run" ? "予測点" : "観測点"}
          </label>
          <button className="btn" onClick={() => p.onFocus(p.focus === "all" ? null : "all")} aria-pressed={p.focus === "all"}>
            <IconStack2 size={16} /> 重ねて見る
          </button>
          <button
            className="btn"
            onClick={p.onReseed}
            disabled={p.reseedBlocked}
            title={p.reseedBlocked ? "メモがこの世界を指しています。渡すか消してから引き直してください" : "同じモデルから別の世界を引きます（モデルは変わりません）"}
          >
            <IconArrowsShuffle size={16} /> 別の世界を引く
          </button>
        </div>
      </div>

      {groupValues.length > 1 && (
        <div className="legend" aria-label="凡例">
          {groupValues.map((g) => (
            <span key={g} className="legend-item">
              <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden>
                <LegendGlyph g={g} />
              </svg>
              {groupName(p.compiled, group!, g)}
            </span>
          ))}
          {p.source.kind === "run" && (
            <span className="legend-item">
              <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden>
                <circle r="4" className="data" />
              </svg>
              データ（{p.source.dataset.provenance === "synthetic" ? "合成" : "実測"}）
            </span>
          )}
        </div>
      )}

      {p.mode === "shape" ? (
        <Shape
          compiled={p.compiled}
          run={p.source.kind === "run" ? p.source.run : null}
          dataset={p.source.kind === "run" ? p.source.dataset : null}
          marks={p.marks}
          onMark={p.onMark}
        />
      ) : p.source.kind === "run" && p.mode === "lens" ? (
        <Lens compiled={p.compiled} run={p.source.run} dataset={p.source.dataset} seed={p.seed} marks={p.marks} onMark={p.onMark} />
      ) : (
      <>
      <AnimatePresence initial={false}>
        {p.focus !== null && (
          <motion.div className="focus" key="focus" initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.18 }}>
            <div className="focus-head">
              <h2>{p.focus === "all" ? `${p.worlds.length} 世界を重ねる` : worldName(p.source, p.focus)}</h2>
              <div className="tools" role="toolbar" aria-label="指し示す道具">
                <ToolButton tool="look" current={p.tool} onTool={p.onTool} icon={<IconPointer size={16} />} label="見る・開く" />
                <ToolButton tool="sketch" current={p.tool} onTool={p.onTool} icon={<IconPencil size={16} />} label="なぞる" />
                <ToolButton tool="range" current={p.tool} onTool={p.onTool} icon={<IconRulerMeasure size={16} />} label="範囲" />
              </div>
              {typeof p.focus === "number" && <Verdicts current={verdictOf(p.marks, p.focus)} onPick={(v) => toggleVerdict(p.focus as number, v)} />}
              <button className="btn btn-quiet" onClick={() => p.onFocus(null)} aria-label="閉じる">
                <IconX size={16} />
              </button>
            </div>
            <div className="focus-body">
              <div className="focus-plot">
                <WorldPlot
                  points={focusPoints}
                  data={p.data}
                  domains={p.domains}
                  width={760}
                  height={340}
                  labels={labels}
                  detailed
                  overlay={p.focus === "all"}
                  marks={focusMarks}
                  tool={p.tool}
                  onMark={p.onMark}
                  onOpenPoint={(u) => p.onOpen(u)}
                  openedUnit={p.opened}
                  worldIndex={p.focus === "all" ? null : p.focus}
                  showObs={p.showObs}
                />
                <p className="focus-hint muted">
                  {p.tool === "sketch" && "あり得ると思う形をなぞります。なぞった線は観測データにはなりません。"}
                  {p.tool === "range" && "気になる横軸の範囲をドラッグで囲みます。"}
                  {p.tool === "look" && p.focus !== "all" && "点を押すと、その値を生んだ層が開きます。層を指して、右のメモに言葉を添えて渡します。"}
                  {p.tool === "look" && p.focus === "all" && "重ね表示では「なぞる」「範囲」で全体の形を指せます。"}
                </p>
              </div>
              {typeof p.focus === "number" && focusIdx >= 0 && p.opened !== null && (
                <Anatomy
                  compiled={p.compiled}
                  world={p.worlds[focusIdx]}
                  worlds={p.worlds}
                  unit={p.opened}
                  source={p.source.kind === "prior" ? "prior" : "posterior"}
                  dataValue={dataRow?.y ?? null}
                  dataCensored={dataRow?.censored ?? false}
                  marks={p.marks}
                  onMark={p.onMark}
                  onClose={() => p.onOpen(null)}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.ol className="world-grid" layout>
        {p.worlds.map((w, i) => {
          const verdict = verdictOf(p.marks, w.index);
          const own = p.marks.filter((m) => m.kind !== "verdict" && m.kind !== "ridge" && m.kind !== "shape" && m.kind !== "bin" && m.world === w.index);
          return (
            <motion.li key={`${p.seed}-${w.index}`} className={`world-card ${verdict ?? ""} ${p.focus === w.index ? "is-focused" : ""}`} layout="position">
              <button className="world-open" onClick={() => p.onFocus(w.index)} aria-label={`${worldName(p.source, w.index)} を開く`}>
                <span className="world-no num">{p.source.kind === "prior" ? pad(w.index) : `#${w.index}`}</span>
                {w.broken && <span className="badge badge-warn">値が壊れています</span>}
                {verdict && <span className={`stamp stamp-${verdict}`}>{verdict === "implausible" ? "あり得ない" : "あり得る"}</span>}
                <WorldPlot points={[p.points[i]]} data={p.data} domains={p.domains} width={240} height={140} marks={own} showObs={p.showObs} />
              </button>
              <Verdicts compact current={verdict} onPick={(v) => toggleVerdict(w.index, v)} />
            </motion.li>
          );
        })}
      </motion.ol>
      </>
      )}
    </section>
  );
}

function Provenance({ source, versionNumber, seed, pending }: { source: Source; versionNumber: number; seed: number; pending: string | null }) {
  if (source.kind === "prior") {
    return (
      <div className="provenance" title="何が表示されているか">
        <span className="badge badge-illustrative">prior からの世界</span>
        <span className="muted">
          v{versionNumber} · seed <span className="num">{seed}</span> · 実データではありません
        </span>
      </div>
    );
  }
  const d = source.run.diagnostics;
  const approx = source.run.fidelity === "approximate";
  const rhatBad = d.maxRhat !== null && d.maxRhat > 1.01;
  const divBad = (d.divergences ?? 0) > 0;
  const essBad = d.minEss !== null && d.minEss < 400;
  return (
    <div className="provenance">
      <span className="badge badge-posterior">事後予測の世界</span>
      {approx && (
        <span className="badge badge-approx" title="速い近似。自動で見ているときは NUTS の結果が届くと置き換わります">
          近似{d.paretoK !== null ? ` · Pareto k ${fmt(d.paretoK)}` : ""}
        </span>
      )}
      {approx && d.paretoK !== null && d.paretoK > 0.7 && <span className="badge badge-warn">信用できない近似</span>}
      {source.run.origin === "auto" && (
        <span className="badge" title="版とデータの変化を受けてアプリが自動で計算した結果">
          自動
        </span>
      )}
      {source.stale && <span className="badge badge-warn" title="この run は今の版より前の版で計算されています">旧版の結果</span>}
      <span className="muted">
        {source.run.method} · データ「{source.dataset.label}」（{source.dataset.provenance === "synthetic" ? "合成データ" : "実データ"}）
      </span>
      {!approx && (
        <>
          <span className={`diag ${rhatBad ? "bad" : ""}`}>R̂ ≤ {d.maxRhat === null ? "?" : fmt(d.maxRhat)}</span>
          <span className={`diag ${essBad ? "bad" : ""}`}>ESS ≥ {d.minEss === null ? "?" : Math.round(d.minEss)}</span>
          <span className={`diag ${divBad ? "bad" : ""}`}>発散 {d.divergences ?? "?"}</span>
        </>
      )}
      {pending && <span className="badge badge-pending-run">NUTS: {pending}</span>}
      {source.run.warnings.length > 0 && (
        <details className="run-warnings">
          <summary>注意 {source.run.warnings.length} 件</summary>
          <ul>
            {source.run.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function LegendGlyph({ g }: { g: number }) {
  const k = g % 4;
  if (k === 1) return <rect x={-4} y={-4} width={8} height={8} className={`obs g${k}`} />;
  if (k === 2) return <path d="M0,-5 L5,0 L0,5 L-5,0 Z" className={`obs g${k}`} />;
  if (k === 3) return <path d="M-4,-4 L4,4 M4,-4 L-4,4" className={`obs g${k}`} />;
  return <circle r={4} className={`obs g${k}`} />;
}

function ToolButton({ tool, current, onTool, icon, label }: { tool: Tool; current: Tool; onTool: (t: Tool) => void; icon: React.ReactNode; label: string }) {
  return (
    <button className={`btn ${current === tool ? "is-on" : ""}`} aria-pressed={current === tool} onClick={() => onTool(tool)}>
      {icon} {label}
    </button>
  );
}

function Verdicts({ current, onPick, compact }: { current: string | null; onPick: (v: "implausible" | "plausible") => void; compact?: boolean }) {
  return (
    <div className={`verdicts ${compact ? "compact" : ""}`}>
      <button className={`btn btn-verdict no ${current === "implausible" ? "is-on" : ""}`} aria-pressed={current === "implausible"} onClick={() => onPick("implausible")}>
        <IconX size={14} /> あり得ない
      </button>
      <button className={`btn btn-verdict yes ${current === "plausible" ? "is-on" : ""}`} aria-pressed={current === "plausible"} onClick={() => onPick("plausible")}>
        <IconCheck size={14} /> あり得る
      </button>
    </div>
  );
}
