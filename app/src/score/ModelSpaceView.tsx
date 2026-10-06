import { AGREEMENT_LABEL, SOURCE_LABEL, type ModelSpace, type SpaceCandidate, type SpaceRow } from './modelSpace';

/**
 * Forest plot of one QoI across model candidates. Rows are grouped by which
 * kind of assumption differs from the current model.
 */
export function ModelSpaceView({ space, qoiChoices, compareId, onQoi, onCompare, onDelete, onAskAI, onImport, onCopyTable }: {
  space: ModelSpace;
  qoiChoices: string[];
  compareId: string | null;
  onQoi: (symbol: string) => void;
  onCompare: (variantId: string) => void;
  onDelete: (candidate: SpaceCandidate) => void;
  onAskAI: () => void;
  onImport: () => void;
  onCopyTable: () => void;
}) {
  const [lo, hi] = space.domain;
  const x = (value: number) => `${((Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo)) * 100}%`;
  const ticks = niceTicks(lo, hi, 5);
  const rows = space.groups.flatMap((group) => group.rows);
  const alone = rows.length === 1;

  return (
    <section className="space" aria-label="結論の地図">
      <div className="space-head">
        <div className="space-qoi" role="group" aria-label="推定目標">
          {qoiChoices.map((symbol) => (
            <button key={symbol} type="button" className={symbol === space.qoi ? 'is-on' : ''} aria-pressed={symbol === space.qoi} onClick={() => onQoi(symbol)}>
              {symbol}
            </button>
          ))}
        </div>
        <p className="space-headline">{space.headline || (alone ? '比べる案がまだありません。' : `${space.qoi} を比べられる結論がまだありません。`)}</p>
        <div className="space-acts">
          <button type="button" className="act" onClick={onAskAI}>AIに案を作らせる</button>
          <button type="button" className="act" onClick={onImport}>案を取り込む</button>
          <button type="button" className="quiet" onClick={onCopyTable} disabled={alone}>表をコピー</button>
        </div>
      </div>

      <div className="space-grid" role="table" aria-label={`${space.qoi} の 90% 区間`}>
        <div className="space-row space-axis" role="row">
          <span role="columnheader" className="space-col-label">案</span>
          <span role="columnheader" className="space-col-source">結論</span>
          <span role="columnheader" className="space-plot">
            {ticks.map((tick) => (
              <span key={tick} className="space-tick num" style={{ left: x(tick) }}>{formatNumber(tick)}</span>
            ))}
          </span>
          <span role="columnheader" className="space-col-agree">基準と</span>
          <span role="columnheader" className="space-col-weight">重み</span>
          <span role="columnheader" className="space-col-act" />
        </div>
        {space.groups.map((group) => (
          <div key={group.key} className="space-group" role="rowgroup">
            <div className="space-group-head" role="row">
              <span role="cell" className="space-group-label">{group.label}</span>
              {group.summary && <span role="cell" className="space-group-summary">{group.summary}</span>}
            </div>
            {group.rows.map((row) => (
              <Row key={row.candidate.id} row={row} x={x} domain={space.domain} zero={lo < 0 && hi > 0 ? x(0) : undefined} active={row.candidate.memberIds.includes(compareId ?? '')} onCompare={onCompare} onDelete={onDelete} />
            ))}
          </div>
        ))}
      </div>
      <p className="space-legend">
        <span className="space-legend-item"><span className="space-sample is-posterior" />事後 90% 区間</span>
        <span className="space-legend-item"><span className="space-sample is-prior" />事前 90% 区間（事後ではない）</span>
        <span className="space-legend-item">重み = stacking weight（なければ elpd_loo）。Evidence がない案は未評価</span>
      </p>
    </section>
  );
}

function Row({ row, x, zero, active, domain, onCompare, onDelete }: {
  row: SpaceRow;
  domain: [number, number];
  x: (value: number) => string;
  zero?: string;
  active: boolean;
  onCompare: (variantId: string) => void;
  onDelete: (candidate: SpaceCandidate) => void;
}) {
  const { candidate, conclusion, agreement, assessment } = row;
  const [lo, hi] = domain;
  const interval = conclusion.interval;
  const posterior = conclusion.source === 'posterior';
  const split = agreement === 'sign_flip' || agreement === 'shifted';
  const members = candidate.isCurrent ? candidate.memberLabels : candidate.memberLabels.slice(1);
  const driver = row.changes[0];
  return (
    <div className={`space-row${split ? ' is-split' : ''}${active ? ' is-on' : ''}${candidate.isCurrent ? ' is-current' : ''}`} role="row">
      <span role="cell" className="space-col-label">
        {candidate.isCurrent ? (
          <span className="space-name">現在</span>
        ) : (
          <button type="button" className="space-name" aria-pressed={active} title="現在のモデルと比較する" onClick={() => onCompare(candidate.memberIds[0]!)}>
            {candidate.label}
          </button>
        )}
        {members.length > 0 && <span className="space-members">= {members.join('、')}</span>}
        {driver && (
          <span className="space-driver" title={row.changes.map((change) => change.sentence).join('\n')}>
            {driver.sentence}{row.changes.length > 1 && <span className="num"> ほか {row.changes.length - 1}</span>}
          </span>
        )}
      </span>
      <span role="cell" className={`space-col-source source-${conclusion.source}`}>{SOURCE_LABEL[conclusion.source]}</span>
      <span role="cell" className="space-plot">
        {zero && <span className="space-zero" style={{ left: zero }} />}
        {interval && (
          <>
            <span className={`space-bar${posterior ? ' is-posterior' : ' is-prior'}${interval.lo < lo ? ' is-clipped-lo' : ''}${interval.hi > hi ? ' is-clipped-hi' : ''}`} style={{ left: x(interval.lo), width: `calc(${x(interval.hi)} - ${x(interval.lo)})` }} />
            <span className="space-mid" style={{ left: x(interval.mid) }} />
            <span className="sr-only">{formatNumber(interval.lo)} から {formatNumber(interval.hi)}、中央 {formatNumber(interval.mid)}</span>
          </>
        )}
      </span>
      <span role="cell" className={`space-col-agree agree-${agreement}`}>{AGREEMENT_LABEL[agreement]}</span>
      <span role="cell" className={`space-col-weight${assessment.evaluated ? '' : ' is-unevaluated'}`}>
        {assessment.stackingWeight !== undefined ? (
          <span className="space-weight">
            <span className="space-weight-bar" style={{ width: `${assessment.stackingWeight * 100}%` }} />
            <span className="num">{assessment.stackingWeight.toFixed(2)}</span>
          </span>
        ) : assessment.elpdLoo !== undefined ? (
          <span className="num">elpd {formatNumber(assessment.elpdLoo)}{assessment.elpdLooSe !== undefined ? ` ± ${formatNumber(assessment.elpdLooSe)}` : ''}</span>
        ) : assessment.evaluated ? <span>診断のみ</span> : <span>未評価</span>}
        {assessment.flags.length > 0 && <span className="space-flags num">{assessment.flags.join(' · ')}</span>}
      </span>
      <span role="cell" className="space-col-act">
        {!candidate.isCurrent && (
          <button type="button" className="quiet" aria-label={`「${candidate.label}」${candidate.memberIds.length > 1 ? `ほか ${candidate.memberIds.length - 1} 案` : ''}を削除`} onClick={() => onDelete(candidate)}>削除</button>
        )}
      </span>
    </div>
  );
}

export function formatNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.001 || magnitude >= 1e4)) return value.toExponential(1);
  return String(Number(value.toFixed(magnitude < 1 ? 2 : magnitude < 100 ? 1 : 0)));
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = Math.ceil(lo / step) * step; value <= hi + 1e-9; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}
