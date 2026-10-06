import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ModelDocument } from '../lib/core/model';
import type { ImplementationReceipt } from '../lib/core/receipt';
import { findDistribution } from '../lib/distributionRegistry';
import {
  MEANING_LABEL,
  SUPPORT_LABEL,
  lhsTex,
  shapeFor,
  statementTex,
  storyFor,
  type MeaningChange,
  type RowSupport,
  type ScoreProjection,
  type ScoreRow,
  type StoryPart,
} from './scoreModel';
import { Spark } from './Plots';
import { Tex } from './Tex';

export type ReadingMode = 'math' | 'story' | 'shape' | 'impl';

export const READING_MODES: Array<{ id: ReadingMode; label: string; hint: string }> = [
  { id: 'math', label: '式', hint: '生成文を数式として読む' },
  { id: 'story', label: '物語', hint: '同じ文をデータ生成の物語として読む' },
  { id: 'shape', label: '形', hint: 'index・shape・plate として読む' },
  { id: 'impl', label: '実装', hint: '実装との対応として読む' },
];

interface Anchor {
  y: number;
}

export interface SheetProps {
  projection: ScoreProjection;
  document: ModelDocument;
  mode: ReadingMode;
  focus: string | null;
  onFocus: (id: string | null) => void;
  brushed: string | null;
  onBrush: (id: string | null) => void;
  supports: Record<string, RowSupport>;
  /** Compare mode: the other version and the meaning changes per entity. */
  compare?: { document: ModelDocument; projection: ScoreProjection; changes: Record<string, MeaningChange[]>; t: number };
  receipt: ImplementationReceipt | null;
  renderDossier: (row: ScoreRow) => ReactNode;
  highlight: Set<string>;
  sparks: Record<string, number[]>;
  ghostSparks?: Record<string, number[]>;
  sparkT: number;
  shifts: Record<string, number>;
}

export function Sheet(props: SheetProps) {
  const { projection, document, mode, focus, onFocus, onBrush, brushed, supports, compare, highlight } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Record<string, Anchor>>({});
  const [height, setHeight] = useState(0);

  const known = useMemo(() => new Set(Object.values(document.entities).map((entity) => entity.symbol)), [document]);
  const symbolToId = useMemo(() => Object.fromEntries(Object.values(document.entities).map((entity) => [entity.symbol, entity.id])), [document]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const next: Record<string, Anchor> = {};
      const base = container.getBoundingClientRect().top;
      container.querySelectorAll<HTMLElement>('[data-anchor]').forEach((element) => {
        const rect = element.getBoundingClientRect();
        next[element.dataset.anchor!] = { y: rect.top - base + rect.height / 2 };
      });
      setAnchors(next);
      setHeight(container.scrollHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll('.row').forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [projection, mode, focus, compare?.t, compare?.document]);

  const lineage = useMemo(() => {
    if (!focus) return { up: new Set<string>(), down: new Set<string>(), directUp: new Set<string>(), directDown: new Set<string>() };
    const walk = (start: string, next: (row: ScoreRow) => string[]) => {
      const seen = new Set<string>();
      const stack = [...(projection.byId[start] ? next(projection.byId[start]!) : [])];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const row = projection.byId[id];
        if (row) stack.push(...next(row));
      }
      return seen;
    };
    const row = projection.byId[focus];
    return {
      up: walk(focus, (item) => item.parents),
      down: walk(focus, (item) => item.children),
      directUp: new Set(row?.parents ?? []),
      directDown: new Set(row?.children ?? []),
    };
  }, [focus, projection]);

  const handleOver = (event: React.MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-sym]');
    const symbol = target?.dataset.sym;
    onBrush(symbol ? symbolToId[symbol] ?? null : null);
  };
  const handleSymbolClick = (event: React.MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-sym]');
    const id = target?.dataset.sym ? symbolToId[target.dataset.sym] : undefined;
    if (id && id !== focus && projection.byId[id]) {
      event.stopPropagation();
      onFocus(id);
      return true;
    }
    return false;
  };

  let previousGrade: string | null = null;
  return (
    <div className={`sheet mode-${mode}`} ref={containerRef} onMouseOver={handleOver} onMouseLeave={() => onBrush(null)}>
      <Gutter projection={projection} anchors={anchors} height={height} focus={focus} lineage={lineage} brushed={brushed} />
      {projection.stages.map((stage, stageIndex) => { previousGrade = null; return (
        <section key={stage.id} className={`stage${stage.plateIds.length ? ' is-plated' : ''}`} style={{ ['--depth' as string]: stage.plateIds.length }}>
          <header className="stage-head">
            <h2>{stage.title}</h2>
            {stage.range && <span className="stage-range num">{stage.range}</span>}
          </header>
          {stage.rows.map((row, rowIndex) => {
            const support = supports[row.id];
            const grade = support?.grade ?? 'stated';
            const showGrade = grade !== previousGrade;
            previousGrade = grade;
            const changes = compare?.changes[row.id];
            const relation = row.id === focus ? 'focus'
              : lineage.directUp.has(row.id) ? 'parent'
                : lineage.directDown.has(row.id) ? 'child'
                  : lineage.up.has(row.id) ? 'ancestor'
                    : lineage.down.has(row.id) ? 'descendant' : '';
            const before = compare ? compare.projection.byId[row.id] : undefined;
            return (
              <article
                key={row.id}
                className={[
                  'row',
                  `rel-${relation || 'none'}`,
                  brushed === row.id ? 'is-brushed' : '',
                  highlight.has(row.id) ? 'is-highlighted' : '',
                  props.shifts[row.id] ? 'is-shifted' : '',
                  changes?.length ? 'is-changed' : '',
                  compare && !before ? 'is-added' : '',
                ].join(' ')}
                style={{ ['--i' as string]: stageIndex * 4 + rowIndex }}
              >
                <div
                  className="row-line"
                  role="button"
                  tabIndex={0}
                  aria-expanded={row.id === focus}
                  aria-label={`${row.entity.label ?? row.entity.symbol}（${SUPPORT_LABEL[grade]}）`}
                  onClick={(event) => {
                    if (handleSymbolClick(event)) return;
                    onFocus(row.id === focus ? null : row.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onFocus(row.id === focus ? null : row.id);
                    }
                  }}
                >
                  <span className="row-anchor" data-anchor={row.id} />
                  <span className="row-relation">{relationLabel(relation)}</span>
                  <div className="row-face">
                    {compare && changes?.length && before ? (
                      <div className="morph" style={{ ['--t' as string]: compare.t }}>
                        <div className="morph-a" aria-label="比較元 A">
                          <Face row={before} document={compare.document} mode={mode} known={known} receipt={props.receipt} />
                        </div>
                        <span className="morph-arrow" aria-hidden="true">→</span>
                        <div className="morph-b">
                          <Face row={row} document={document} mode={mode} known={known} receipt={props.receipt} />
                        </div>
                      </div>
                    ) : (
                      <div className="face" key={mode}>
                        <Face row={row} document={document} mode={mode} known={known} receipt={props.receipt} />
                      </div>
                    )}
                  </div>
                  <span className="row-spark" title={props.shifts[row.id] ? `90%区間の幅 ×${props.shifts[row.id]!.toFixed(2)}` : row.entity.kind === 'data' ? undefined : '含意された事前分布の形'}>
                    {row.entity.kind !== 'data' && <Spark samples={props.sparks[row.id]} ghost={props.ghostSparks?.[row.id]} t={props.sparkT} />}
                  </span>
                  {changes?.length ? (
                    <span className="row-change">{[...new Set(changes.map((change) => MEANING_LABEL[change.kind]))].join('・')}</span>
                  ) : compare && !before ? <span className="row-change">追加</span> : null}
                  <span className={`rail rail-${grade}`}>
                    {showGrade && <span className="rail-label">{SUPPORT_LABEL[grade]}</span>}
                    {support?.implementation && <span className="rail-impl" title={`${support.implementation.file}`}>impl</span>}
                  </span>
                </div>
                {row.id === focus && props.renderDossier(row)}
              </article>
            );
          })}
        </section>
      ); })}
    </div>
  );
}

function relationLabel(relation: string): string {
  switch (relation) {
    case 'parent': return '依存';
    case 'child': return '影響';
    default: return '';
  }
}

/* ------------------------------------------------------------------ */

function Face({ row, document, mode, known, receipt }: { row: ScoreRow; document: ModelDocument; mode: ReadingMode; known: Set<string>; receipt: ImplementationReceipt | null }) {
  if (mode === 'math') return <Tex tex={statementTex(row, known)} />;
  if (mode === 'story') return <Story parts={storyFor(row, document, known)} />;
  if (mode === 'shape') return <ShapeFace row={row} document={document} known={known} />;
  return <ImplFace row={row} receipt={receipt} />;
}

function Story({ parts }: { parts: StoryPart[] }) {
  return (
    <p className="story">
      {parts.map((part, index) => part.sym
        ? <span key={index} className="story-sym" data-sym={part.sym}>{part.text}</span>
        : <Fragment key={index}>{part.text}</Fragment>)}
    </p>
  );
}

function ShapeFace({ row, document, known }: { row: ScoreRow; document: ModelDocument; known: Set<string> }) {
  const shape = shapeFor(row.entity, document);
  return (
    <div className="shape-face">
      <span className="shape-symbol" data-sym={row.entity.symbol}><Tex tex={lhsTex(row.entity, row.indices, known)} /></span>
      <span className="shape-blocks" aria-label={shape.text}>
        {shape.axes.length === 0 && <span className="shape-scalar" title="scalar" />}
        {shape.axes.map((axis) => (
          <span key={axis.axisId} className={`shape-axis ${axis.plate ? 'is-plate' : 'is-free'}`}>
            <span className="num">{axis.size}</span>
            <span className="shape-axis-note">{axis.plate ? `plate ${document.plates[axis.plate]?.indexSymbol}` : axis.role}</span>
          </span>
        ))}
      </span>
      <span className="shape-type num">{shape.text}</span>
      {shape.gathers.map((gather) => (
        <span key={`${gather.target}-${gather.via}`} className="shape-gather num">
          <span data-sym={gather.via}>{gather.from}</span> → <span data-sym={gather.via}>{gather.via}[{gather.from}]</span> → <span data-sym={gather.target}>{gather.target}</span>
        </span>
      ))}
    </div>
  );
}

function ImplFace({ row, receipt }: { row: ScoreRow; receipt: ImplementationReceipt | null }) {
  const entity = row.entity;
  const mapping = receipt?.mappings.find((item) => item.entityId === entity.id || item.entityId === row.observedData?.id);
  const backend = entity.kind === 'random_variable' ? findDistribution(entity.distribution.distributionId)?.backendNames : undefined;
  const hints = entity.kind === 'random_variable' ? entity.hints ?? [] : [];
  return (
    <div className="impl-face">
      <span className="impl-id num" data-sym={entity.symbol}>{entity.id}</span>
      {mapping ? (
        <span className="impl-map num">
          {mapping.implementationSymbol} <span className="impl-file">{mapping.file}{mapping.lineRange ? `:${mapping.lineRange[0]}–${mapping.lineRange[1]}` : ''}</span>
        </span>
      ) : (
        <span className="impl-missing">{receipt ? 'receipt に対応なし' : '未実装'}</span>
      )}
      {backend && <span className="impl-backend num">{backend.pymc ?? backend.numpyro}</span>}
      {hints.map((hint, index) => (
        <span key={index} className="impl-hint">{hint.kind === 'parameterization' ? hint.value.replace('_', '-') : hint.kind}</span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gutter: arc diagram of dependencies with PGM-style markers          */
/* ------------------------------------------------------------------ */

const MARK_X = 118;

function Gutter({ projection, anchors, height, focus, lineage, brushed }: {
  projection: ScoreProjection;
  anchors: Record<string, Anchor>;
  height: number;
  focus: string | null;
  lineage: { up: Set<string>; down: Set<string>; directUp: Set<string>; directDown: Set<string> };
  brushed: string | null;
}) {
  const edges = projection.rows.flatMap((row) => row.parents
    .filter((parent) => anchors[parent] && anchors[row.id])
    .map((parent) => ({ from: parent, to: row.id })));

  const classify = (from: string, to: string) => {
    if (!focus) return brushed && (from === brushed || to === brushed) ? 'arc is-brushed' : 'arc';
    if (to === focus && lineage.directUp.has(from)) return 'arc is-up';
    if (from === focus && lineage.directDown.has(to)) return 'arc is-down';
    if (lineage.up.has(from) && (lineage.up.has(to) || to === focus)) return 'arc is-up-far';
    if (lineage.down.has(to) && (lineage.down.has(from) || from === focus)) return 'arc is-down-far';
    return 'arc is-quiet';
  };

  return (
    <svg className="gutter" width={MARK_X + 14} height={height} aria-hidden="true">
      {edges.map(({ from, to }) => {
        const y1 = anchors[from]!.y;
        const y2 = anchors[to]!.y;
        const bulge = Math.min(MARK_X - 8, 14 + Math.abs(y2 - y1) * 0.32);
        return (
          <path
            key={`${from}-${to}`}
            className={classify(from, to)}
            d={`M${MARK_X},${y1} C${MARK_X - bulge},${y1} ${MARK_X - bulge},${y2} ${MARK_X},${y2}`}
          />
        );
      })}
      {projection.rows.map((row) => {
        const anchor = anchors[row.id];
        if (!anchor) return null;
        const cls = `mark mark-${row.role}${row.id === focus ? ' is-focus' : ''}${row.id === brushed ? ' is-brushed' : ''}`;
        const y = anchor.y;
        switch (row.role) {
          case 'given':
          case 'index':
            return <rect key={row.id} className={cls} x={MARK_X - 4.5} y={y - 4.5} width={9} height={9} />;
          case 'derived':
            return <path key={row.id} className={cls} d={`M${MARK_X},${y - 6} L${MARK_X + 6},${y} L${MARK_X},${y + 6} L${MARK_X - 6},${y} Z`} />;
          case 'observation':
            return <circle key={row.id} className={cls} cx={MARK_X} cy={y} r={6} />;
          default:
            return <circle key={row.id} className={cls} cx={MARK_X} cy={y} r={5.5} />;
        }
      })}
    </svg>
  );
}
