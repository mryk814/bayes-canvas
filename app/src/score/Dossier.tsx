import { useRef, useState } from 'react';
import type { Diagnostic, JsonPatchOperation } from '../lib/core/diagnostics';
import type { ModelDocument, RandomVariableEntity } from '../lib/core/model';
import { findDistribution } from '../lib/distributionRegistry';
import { DensityPlot, FanPlot } from './Plots';
import type { PriorSimulation } from './priorSim';
import {
  SUPPORT_LABEL,
  shapeFor,
  type Finding,
  type Question,
  type RowSupport,
  type ScoreProjection,
  type ScoreRow,
} from './scoreModel';

export interface DossierProps {
  row: ScoreRow;
  document: ModelDocument;
  projection: ScoreProjection;
  support: RowSupport;
  questions: Question[];
  findings: Finding[];
  sim: PriorSimulation;
  ghost?: PriorSimulation;
  t: number;
  drafting: boolean;
  onScrub: (entityId: string, arg: string, value: string) => void;
  onEdit: (label: string, operations: JsonPatchOperation[]) => void;
  onFork: (label: string, variantLabel: string, operations: JsonPatchOperation[]) => void;
  onFocus: (id: string) => void;
}

export function Dossier(props: DossierProps) {
  const { row, document } = props;
  return (
    <div className="dossier" onClick={(event) => event.stopPropagation()}>
      <BeliefColumn {...props} />
      <section className="dossier-col">
        <h3>つながり</h3>
        <Links row={row} document={document} projection={props.projection} onFocus={props.onFocus} />
      </section>
      <section className="dossier-col">
        <h3>問い</h3>
        <Doubts {...props} />
      </section>
      <section className="dossier-col">
        <h3>根拠</h3>
        <Grounds row={row} support={props.support} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BeliefColumn({ row, document, sim, ghost, t, onScrub, drafting }: DossierProps) {
  const entity = row.entity;
  if (entity.kind === 'data') {
    return (
      <section className="dossier-col dossier-belief">
        <h3>データ契約</h3>
        <dl className="facts">
          <dt>role</dt><dd>{entity.dataRole}</dd>
          <dt>型</dt><dd className="num">{entity.valueType.scalar}</dd>
          <dt>単位</dt><dd>{entity.unit ?? <span className="missing">未設定</span>}</dd>
          <dt>欠測</dt><dd>{entity.missingValuePolicy ?? <span className="missing">未宣言</span>}</dd>
        </dl>
      </section>
    );
  }
  const samples = sim.marginals[entity.id] ?? [];
  const ghostSamples = ghost?.marginals[entity.id];
  const isObservation = entity.kind === 'random_variable' && entity.role === 'observation';
  const marginal = row.parents.some((parent) => document.entities[parent]?.kind !== 'data');
  return (
    <section className="dossier-col dossier-belief">
      <h3>{isObservation ? 'prior predictive' : marginal ? '含意された事前分布' : '事前の信念'}</h3>
      {sim.unsupported.length ? (
        <p className="note">ブラウザ内では抽出できません（{sim.unsupported.join(', ')}）。検証protocolを外部で実行してください。</p>
      ) : isObservation && sim.fan ? (
        <FanPlot {...sim.fan} ghost={ghost?.fan?.quantiles} />
      ) : (
        <DensityPlot samples={samples} ghost={ghostSamples} t={ghost ? t : 1} label={entity.symbol} />
      )}
      {marginal && !isObservation && <p className="note">上位の不確かさを周辺化した形。条件付きの式より裾が厚い。</p>}
      {entity.kind === 'random_variable' && <Args entity={entity} onScrub={onScrub} drafting={drafting} />}
    </section>
  );
}

function Args({ entity, onScrub, drafting }: { entity: RandomVariableEntity; onScrub: DossierProps['onScrub']; drafting: boolean }) {
  const definition = findDistribution(entity.distribution.distributionId);
  return (
    <div className="args">
      <span className="args-family">{definition?.name ?? entity.distribution.distributionId}</span>
      {Object.entries(entity.distribution.args).map(([key, arg]) => {
        const role = definition?.params.find((param) => param.name === key)?.role;
        const numeric = /^-?\d+(\.\d+)?$/.test(arg.source.trim());
        return (
          <span key={key} className="arg">
            <span className="arg-key">{key}</span>
            {numeric ? (
              <Scrub
                value={Number(arg.source)}
                positive={role === 'scale' || role === 'df' || role === 'rate' || role === 'shape'}
                onChange={(value) => onScrub(entity.id, key, value)}
                active={drafting}
              />
            ) : (
              <span className="arg-ref num" data-sym={arg.source.replace(/\[.*$/, '')}>{arg.source}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function tidy(value: number): string {
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, '');
  return Number(value.toPrecision(2)).toString();
}

/** A number you can drag. Scale-like values move multiplicatively. */
function Scrub({ value, positive, onChange, active }: { value: number; positive: boolean; onChange: (value: string) => void; active: boolean }) {
  const start = useRef<{ x: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const step = (direction: number) => {
    const next = positive ? value * Math.pow(1.25, direction) : value + direction * 0.25;
    onChange(tidy(next));
  };
  return (
    <span
      className={`scrub num${dragging ? ' is-dragging' : ''}${active ? ' is-draft' : ''}`}
      role="slider"
      tabIndex={0}
      aria-valuenow={value}
      aria-label="ドラッグまたは矢印キーで値を変える"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, value };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const dx = event.clientX - start.current.x;
        const next = positive ? start.current.value * Math.exp(dx / 90) : start.current.value + dx / 40;
        onChange(tidy(next));
      }}
      onPointerUp={() => {
        start.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          step(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          step(-1);
        }
      }}
    >
      {tidy(value)}
    </span>
  );
}

/* ------------------------------------------------------------------ */

function Links({ row, document, projection, onFocus }: { row: ScoreRow; document: ModelDocument; projection: ScoreProjection; onFocus: (id: string) => void }) {
  const entity = row.entity;
  const slotOf = (childId: string, symbol: string) => {
    const child = document.entities[childId];
    if (child?.kind === 'random_variable') {
      const slot = Object.entries(child.distribution.args).find(([, arg]) => arg.source.replace(/\[.*$/, '').trim() === symbol || arg.source.includes(`${symbol}[`));
      if (slot) return slot[0];
    }
    if (child?.kind === 'deterministic') return '式';
    return '';
  };
  const shape = shapeFor(entity, document);
  const plates = entity.plateIds.map((plateId) => document.plates[plateId]).filter(Boolean);
  return (
    <div className="links">
      <div className="link-group">
        <span className="link-head">依存する</span>
        {row.parents.length ? row.parents.map((parent) => (
          <button key={parent} type="button" className="link" data-sym={document.entities[parent]?.symbol} onClick={() => onFocus(parent)}>
            {document.entities[parent]?.symbol}
            <span className="link-slot">{slotOf(row.id, document.entities[parent]?.symbol ?? '')}</span>
          </button>
        )) : <span className="missing">なし（最上流）</span>}
      </div>
      <div className="link-group">
        <span className="link-head">影響する</span>
        {row.children.length ? row.children.map((child) => (
          <button key={child} type="button" className="link" data-sym={document.entities[child]?.symbol} onClick={() => onFocus(child)}>
            {document.entities[child]?.symbol}
            <span className="link-slot">{slotOf(child, entity.symbol)}</span>
          </button>
        )) : <span className="missing">{projection.queries.some((query) => query.parents.includes(row.id)) ? '推定目標' : 'なし'}</span>}
      </div>
      <dl className="facts">
        <dt>shape</dt><dd className="num">{shape.text}</dd>
        {plates.map((plate) => (
          <FragmentPlate key={plate!.id} label={plate!.label} index={plate!.indexSymbol} assumption={plate!.assumption} />
        ))}
        {row.observedData && <><dt>観測値</dt><dd className="num">{row.observedData.symbol}</dd></>}
      </dl>
      {shape.gathers.map((gather) => (
        <div key={gather.via} className="gather">
          <span className="num">{gather.from}</span>
          <svg width="28" height="10" aria-hidden="true"><path d="M2,5 H24 M20,1 L24,5 L20,9" /></svg>
          <span className="num" data-sym={gather.via}>{gather.via}</span>
          <svg width="28" height="10" aria-hidden="true"><path d="M2,5 H24 M20,1 L24,5 L20,9" /></svg>
          <span className="num" data-sym={gather.target}>{gather.target}</span>
          <span className="gather-note">観測ごとにグループの値を引く</span>
        </div>
      ))}
    </div>
  );
}

function FragmentPlate({ label, index, assumption }: { label: string; index: string; assumption: string }) {
  return (
    <>
      <dt>plate</dt>
      <dd>{label} <span className="num">({index})</span> · {assumption === 'conditionally_independent' ? '条件付き独立' : assumption === 'exchangeable' ? '交換可能' : '宣言のみ'}</dd>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Doubts({ questions, findings, support, onEdit, onFork }: DossierProps) {
  const [text, setText] = useState<Record<string, string>>({});
  const [all, setAll] = useState(false);
  const issues: Array<Diagnostic> = support.diagnostics;
  // Questions that fork an alternative come first: they invite comparison rather than a fix.
  const ranked = [...questions].sort((a, b) => Number(Boolean(b.alternative)) - Number(Boolean(a.alternative)));
  const limit = findings.length + issues.length > 0 ? 1 : 2;
  const visible = all ? ranked : ranked.slice(0, limit);
  if (!questions.length && !findings.length && !issues.length) return <p className="missing">この文から自動で出せる問いはありません。</p>;
  return (
    <ul className="doubts">
      {issues.map((item) => (
        <li key={`${item.code}-${item.path}`} className={`doubt doubt-${item.severity}`}>
          <span className="doubt-ask">{item.message}</span>
          <span className="doubt-why num">{item.code}</span>
          {item.fixes?.slice(0, 1).map((fix) => (
            <button key={fix.id} type="button" className="act" onClick={() => onEdit(fix.title, fix.patch)}>{fix.title}</button>
          ))}
        </li>
      ))}
      {findings.map((finding) => (
        <li key={finding.id} className="doubt doubt-warning">
          <span className="doubt-ask">{finding.title}</span>
          <span className="doubt-why">{finding.detail}</span>
          {finding.fix && <button type="button" className="act" onClick={() => onEdit(finding.fix!.label, finding.fix!.operations)}>{finding.fix.label}</button>}
        </li>
      ))}
      {visible.map((question) => (
        <li key={question.id} className="doubt">
          <span className="doubt-ask">{question.ask}</span>
          <span className="doubt-why">{question.why}</span>
          <span className="doubt-acts">
            {question.alternative && (
              <button type="button" className="act act-fork" onClick={() => onFork(question.alternative!.label, question.alternative!.variantLabel, question.alternative!.operations)}>
                {question.alternative.label}
              </button>
            )}
            {question.edit && question.edit.operations.length > 0 && (
              <button type="button" className="act" onClick={() => onEdit(question.edit!.label, question.edit!.operations)}>{question.edit.label}</button>
            )}
          </span>
          {question.needsText && (
            <form
              className="doubt-form"
              onSubmit={(event) => {
                event.preventDefault();
                const value = text[question.id]?.trim();
                if (value) onEdit(question.needsText!.label, question.needsText!.build(value));
              }}
            >
              <input
                value={text[question.id] ?? ''}
                placeholder={question.needsText.placeholder}
                aria-label={question.needsText.label}
                onChange={(event) => setText({ ...text, [question.id]: event.target.value })}
              />
              <button type="submit" className="act" disabled={!text[question.id]?.trim()}>記録</button>
            </form>
          )}
        </li>
      ))}
      {ranked.length > limit && (
        <li><button type="button" className="doubt-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? '問いをたたむ' : `ほかの問い ${ranked.length - limit} 件`}</button></li>
      )}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

function Grounds({ row, support }: { row: ScoreRow; support: RowSupport }) {
  const entity = row.entity;
  return (
    <div className="grounds">
      <div className={`grade grade-${support.grade}`}>
        <span className={`rail-sample rail-${support.grade}`} />
        {SUPPORT_LABEL[support.grade]}
      </div>
      {entity.kind === 'random_variable' && entity.role !== 'observation' && (
        entity.priorRationale
          ? <blockquote className="rationale">{entity.priorRationale}</blockquote>
          : <p className="missing">prior の意図は未記録。</p>
      )}
      {support.evidence.length ? (
        <ul className="evidence-links">
          {support.evidence.map((item, index) => (
            <li key={index} className={`ev ev-${item.status}`}>
              <span className="ev-status">{item.status === 'pass' ? '支持' : item.status === 'review' ? '要確認' : '反証'}</span>
              <span>{item.label}</span>
              <span className="ev-run num">{item.bundle.runType} · {item.bundle.backend}</span>
            </li>
          ))}
        </ul>
      ) : <p className="missing">現在の仕様に対する Evidence はありません。</p>}
      {support.staleEvidence > 0 && <p className="note">以前の仕様に対する Evidence が {support.staleEvidence} 件あります（fingerprint 不一致のため支持には数えない）。</p>}
      {support.implementation ? (
        <p className="impl-line num">{support.implementation.implementationSymbol} @ {support.implementation.file}{support.implementation.lineRange ? `:${support.implementation.lineRange.join('–')}` : ''}</p>
      ) : <p className="missing">実装との対応は未確認。</p>}
    </div>
  );
}
