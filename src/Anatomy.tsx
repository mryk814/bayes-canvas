import { motion } from "motion/react";
import { IconHandFinger, IconX } from "@tabler/icons-react";
import { ROLE_LABELS, type Mark } from "../shared/contracts.ts";
import { anatomy, type Compiled, type Layer, type World } from "../shared/sim.ts";
import { fmt, groupName } from "./format.ts";

type Props = {
  compiled: Compiled;
  world: World;
  worlds: World[];
  unit: number;
  source: "prior" | "posterior";
  dataValue: number | null;
  dataCensored: boolean;
  marks: Mark[];
  onMark: (m: Mark) => void;
  onClose: () => void;
};

// Inside a Dot: the recorded value first, then everything that produced it.
export function Anatomy(p: Props) {
  const y = p.compiled.spec.view.y;
  const layers = anatomy(p.compiled, p.world, y, p.unit).reverse();
  const isMarked = (node: string) => p.marks.some((m) => m.kind === "layer" && m.world === p.world.index && m.unit === p.unit && m.node === node);
  const pointMarked = p.marks.some((m) => m.kind === "point" && m.world === p.world.index && m.unit === p.unit);
  const unitPlate = p.compiled.unitPlate;
  const plateLabel = p.compiled.spec.plates.find((x) => x.name === unitPlate)?.label ?? "点";
  const group = p.compiled.spec.view.group;

  return (
    <section className="anatomy" aria-label="観測点を開く">
      <header className="anatomy-head">
        <h3>
          {plateLabel} <span className="num">{p.unit}</span> を開く
        </h3>
        {group && (
          <span className="badge">
            {groupName(p.compiled, group, p.world.values[group][p.unit])}
          </span>
        )}
        <button
          className={`btn ${pointMarked ? "is-on" : ""}`}
          aria-pressed={pointMarked}
          onClick={() => p.onMark({ kind: "point", world: p.world.index, unit: p.unit })}
        >
          <IconHandFinger size={16} /> この点を指す
        </button>
        <button className="btn btn-quiet" onClick={p.onClose} aria-label="閉じる">
          <IconX size={16} />
        </button>
      </header>
      <p className="muted small">
        {p.source === "prior"
          ? "prior から生まれた一つの世界での値です。潜在の層は観測されない仮説の値で、真値ではありません。"
          : "事後分布の一つの draw での値です。潜在の層は推定であり、観測された事実ではありません。"}
      </p>
      {p.dataValue !== null && (
        <div className="anatomy-data">
          <span className="badge badge-data">データ</span>
          <span className="num big">{fmt(p.dataValue)}</span>
          {p.dataCensored && <span className="badge badge-warn">記録上限で打ち切り</span>}
          <span className="muted small">実際に記録された値。下の「観測」層はこの draw から再シミュレーションした値です。</span>
        </div>
      )}
      <ol className="layers">
        {layers.map((l, i) => (
          <motion.li
            key={`${l.name}@${l.element}`}
            className={`layer role-${l.role} ${isMarked(l.name) ? "is-marked" : ""}`}
            initial={{ y: -10 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.03 }}
          >
            <div className="layer-main">
              <span className={`role-chip role-${l.role}`}>{l.role === "data" ? "データ" : ROLE_LABELS[l.role]}</span>
              <div className="layer-text">
                <div className="layer-title">
                  {l.label} <span className="mono muted">{l.name}{l.element !== null && l.plate !== unitPlate ? `[${l.element}]` : ""}</span>
                </div>
                <div className="mono muted small">{l.how}</div>
              </div>
              <div className="layer-value">
                <span className="num">{l.role === "data" && p.compiled.data.find((d) => d.name === l.name)?.indexOf ? groupName(p.compiled, l.name, l.value) : fmt(l.value)}</span>
                <span className="muted small">{l.unit}</span>
                {l.censored && <span className="badge badge-warn">上限</span>}
              </div>
            </div>
            <div className="layer-foot">
              <Strip layer={l} world={p.world} worlds={p.worlds} />
              {l.role !== "data" && (
                <button
                  className={`btn btn-quiet layer-point ${isMarked(l.name) ? "is-on" : ""}`}
                  aria-pressed={isMarked(l.name)}
                  onClick={() => p.onMark({ kind: "layer", world: p.world.index, unit: p.unit, node: l.name })}
                >
                  <IconHandFinger size={14} /> この層を指す
                </button>
              )}
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

// Where this value sits among its siblings: the other elements in this world, or this value in the other worlds.
function Strip({ layer, world, worlds }: { layer: Layer; world: World; worlds: World[] }) {
  const plated = layer.plate !== null && (world.values[layer.name]?.length ?? 0) > 1;
  const values = plated ? world.values[layer.name] : worlds.map((w) => w.values[layer.name]?.[0] ?? NaN);
  const mine = plated ? (layer.element ?? 0) : worlds.findIndex((w) => w.index === world.index);
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return <span className="strip-empty" />;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const W = 180;
  const sx = (v: number) => (hi === lo ? W / 2 : 6 + ((v - lo) / (hi - lo)) * (W - 12));
  return (
    <svg className="strip" viewBox={`0 0 ${W} 16`} width={W} height={16} aria-label={plated ? "この世界の他の要素との位置" : "他の世界との位置"}>
      <line x1={4} x2={W - 4} y1={8} y2={8} className="strip-axis" />
      {values.map((v, i) =>
        Number.isFinite(v) ? <circle key={i} cx={sx(v)} cy={8} r={i === mine ? 4 : 2} className={i === mine ? "strip-mine" : "strip-dot"} /> : null,
      )}
      <title>{plated ? "同じ世界の他の要素" : "表示中の他の世界"}</title>
    </svg>
  );
}
