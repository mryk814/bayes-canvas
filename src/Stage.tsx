import { motion, AnimatePresence } from "motion/react";
import { IconArrowsShuffle, IconPencil, IconPointer, IconRulerMeasure, IconX, IconCheck, IconStack2 } from "@tabler/icons-react";
import type { Mark, ModelSpec } from "../shared/contracts.ts";
import type { World } from "../shared/sim.ts";
import { WorldPlot, type Tool } from "./WorldPlot.tsx";

export type Focus = number | "all" | null;

type Props = {
  spec: ModelSpec;
  versionNumber: number;
  seed: number;
  worlds: World[];
  yDomain: [number, number];
  marks: Mark[];
  focus: Focus;
  tool: Tool;
  showObs: boolean;
  reseedBlocked: boolean;
  onFocus: (f: Focus) => void;
  onTool: (t: Tool) => void;
  onShowObs: (v: boolean) => void;
  onReseed: () => void;
  onMark: (m: Mark) => void;
};

export function verdictOf(marks: Mark[], world: number) {
  const v = marks.find((m) => m.kind === "verdict" && m.world === world);
  return v?.kind === "verdict" ? v.verdict : null;
}

export function Stage(p: Props) {
  const focusWorlds = p.focus === "all" ? p.worlds : p.focus === null ? [] : p.worlds.filter((w) => w.index === p.focus);
  const focusMarks = p.marks.filter((m) => m.kind !== "verdict" && (p.focus === "all" ? m.world === null : m.world === p.focus));
  const toggleVerdict = (world: number, verdict: "implausible" | "plausible") => p.onMark({ kind: "verdict", world, verdict });

  return (
    <section className="stage" aria-label="可能世界">
      <div className="stage-bar">
        <div className="provenance" title="何が表示されているか">
          <span className="badge badge-illustrative">prior からの世界</span>
          <span className="muted">
            v{p.versionNumber} · seed <span className="num">{p.seed}</span> · 実データではありません
          </span>
        </div>
        <div className="stage-actions">
          <label className="toggle">
            <input type="checkbox" checked={p.showObs} onChange={(e) => p.onShowObs(e.target.checked)} />
            観測点
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

      <AnimatePresence initial={false}>
        {p.focus !== null && (
          <motion.div
            className="focus"
            key="focus"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="focus-head">
              <h2>{p.focus === "all" ? `${p.worlds.length} 世界の平均曲線` : `世界 ${pad(p.focus)}`}</h2>
              <div className="tools" role="toolbar" aria-label="指し示す道具">
                <ToolButton tool="look" current={p.tool} onTool={p.onTool} icon={<IconPointer size={16} />} label="見る" />
                <ToolButton tool="sketch" current={p.tool} onTool={p.onTool} icon={<IconPencil size={16} />} label="なぞる" />
                <ToolButton tool="range" current={p.tool} onTool={p.onTool} icon={<IconRulerMeasure size={16} />} label="範囲" />
              </div>
              {typeof p.focus === "number" && (
                <Verdicts current={verdictOf(p.marks, p.focus)} onPick={(v) => toggleVerdict(p.focus as number, v)} />
              )}
              <button className="btn btn-quiet" onClick={() => p.onFocus(null)} aria-label="閉じる">
                <IconX size={16} />
              </button>
            </div>
            <WorldPlot
              spec={p.spec}
              worlds={focusWorlds}
              yDomain={p.yDomain}
              width={760}
              height={340}
              detailed
              overlay={p.focus === "all"}
              marks={focusMarks}
              tool={p.tool}
              onMark={p.onMark}
              worldIndex={p.focus === "all" ? null : p.focus}
              showObs={p.showObs}
            />
            <p className="focus-hint muted">
              {p.tool === "sketch" && "あり得ると思う形をなぞります。なぞった線は観測データにはなりません。"}
              {p.tool === "range" && "気になる x の範囲をドラッグで囲みます。"}
              {p.tool === "look" && "「なぞる」「範囲」で指し示し、右のメモに言葉を添えて Claude に渡します。"}
            </p>
            {typeof p.focus === "number" && <ParamTable spec={p.spec} world={focusWorlds[0]} />}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.ol className="world-grid" layout>
        {p.worlds.map((w) => {
          const verdict = verdictOf(p.marks, w.index);
          const own = p.marks.filter((m) => m.kind !== "verdict" && m.world === w.index);
          return (
            <motion.li
              key={`${p.seed}-${w.index}`}
              className={`world-card ${verdict ?? ""} ${p.focus === w.index ? "is-focused" : ""}`}
              layout="position"
            >
              <button className="world-open" onClick={() => p.onFocus(w.index)} aria-label={`世界 ${w.index} を開く`}>
                <span className="world-no num">{pad(w.index)}</span>
                {w.broken && <span className="badge badge-warn">値が壊れています</span>}
                {verdict && (
                  <span className={`stamp stamp-${verdict}`}>{verdict === "implausible" ? "あり得ない" : "あり得る"}</span>
                )}
                <WorldPlot spec={p.spec} worlds={[w]} yDomain={p.yDomain} width={240} height={140} marks={own} showObs={p.showObs} />
              </button>
              <Verdicts compact current={verdict} onPick={(v) => toggleVerdict(w.index, v)} />
            </motion.li>
          );
        })}
      </motion.ol>
    </section>
  );
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

function ParamTable({ spec, world }: { spec: ModelSpec; world?: World }) {
  if (!world) return null;
  return (
    <table className="param-table">
      <tbody>
        {spec.params.map((q) => (
          <tr key={q.name}>
            <th>{q.label}</th>
            <td className="mono">{q.name}</td>
            <td className="num">{fmt(world.params[q.name])}</td>
            <td className="muted">{q.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function fmt(v: number) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a !== 0 && (a < 0.01 || a >= 1e5) ? v.toExponential(2) : Number(v.toPrecision(4)).toString();
}
