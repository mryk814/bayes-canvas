import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonPatchOperation } from '../lib/core/diagnostics';
import { buildHandoffBundle } from '../lib/core/handoff';
import type { LayoutDocument, ModelDocument } from '../lib/core/model';
import { buildPortablePackage } from '../lib/core/portable';
import { compareReceiptFingerprint, validateImplementationReceipt, type ImplementationReceipt } from '../lib/core/receipt';
import { previewPortablePackageImport } from '../lib/canvasProjector';
import { parseImportJsonText } from '../lib/importText';
import {
  buildModelScorecard,
  buildSensitivityScenarios,
  generateCriticismPrompt,
  generateModelCardMarkdown,
  loadModelEvidence,
  persistModelEvidence,
  validateModelEvidence,
  type ModelEvidenceBundle,
} from '../lib/modelEvidence';
import { createModelVariant, loadModelVariants, persistModelVariants, type ModelVariant } from '../lib/modelWorkbench';
import { Dossier } from './Dossier';
import { findFunnels, funnelGeometry } from './geometry';
import { intervalShifts, simulatePrior } from './priorSim';
import {
  MEANING_LABEL,
  SUPPORT_LABEL,
  findDuplicateAxes,
  meaningDiff,
  projectScore,
  queryOperations,
  questionsFor,
  statementTex,
  supportFor,
  type MeaningChange,
  type RowSupport,
  type SupportGrade,
} from './scoreModel';
import { READING_MODES, Sheet, type ReadingMode } from './Sheet';
import { Tex } from './Tex';
import { compile, fingerprintOf, patchDocument, useScoreDocument } from './useScoreDocument';
import './score.css';

interface Draft {
  entityId: string;
  label: string;
  operations: JsonPatchOperation[];
}

interface Toast {
  message: string;
  tone?: 'danger';
  undo?: boolean;
}

const IMPORT_LIMITS = { maxBytes: 4 * 1024 * 1024, maxDepth: 64 };

export function ScoreApp() {
  const model = useScoreDocument();
  const { document, layout, semantic, fingerprint } = model;
  const [mode, setMode] = useState<ReadingMode>('math');
  const [focus, setFocus] = useState<string | null>(null);
  const [brushed, setBrushed] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [variants, setVariants] = useState<ModelVariant[]>(() => loadModelVariants());
  const [compareId, setCompareId] = useState<string | null>(null);
  const [t, setT] = useState(1);
  const [evidence, setEvidence] = useState<ModelEvidenceBundle[]>(() => loadModelEvidence());
  const [receipt, setReceipt] = useState<ImplementationReceipt | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(model.restored ? { message: '前回の作業を復元しました。' } : null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());

  /* ---------- projections (all derived from the ModelDocument) ---------- */
  const shown = useMemo(() => {
    if (!draft) return { document, semantic };
    try {
      const next = patchDocument(document, draft.operations);
      return { document: next, semantic: compile(next) };
    } catch {
      return { document, semantic };
    }
  }, [document, semantic, draft]);
  const projection = useMemo(() => projectScore(shown.document, shown.semantic), [shown]);
  const sim = useMemo(() => simulatePrior(shown.document, projection), [shown.document, projection]);

  const compareVariant = variants.find((variant) => variant.id === compareId) ?? null;
  const compare = useMemo(() => {
    if (!compareVariant) return null;
    const other = compareVariant.document;
    const otherProjection = projectScore(other, compile(other));
    const changes = meaningDiff(other, document);
    const byEntity: Record<string, MeaningChange[]> = {};
    for (const change of changes) if (change.entityId) (byEntity[change.entityId] ??= []).push(change);
    return { document: other, projection: otherProjection, changes: byEntity, list: changes, sim: simulatePrior(other, otherProjection) };
  }, [compareVariant, document]);
  const draftBaseline = useMemo(() => (draft ? simulatePrior(document, projectScore(document, semantic)) : null), [draft, document, semantic]);
  const shifts = useMemo(() => {
    const before = draft ? draftBaseline : compare?.sim;
    if (!before) return {};
    return intervalShifts(before, sim);
  }, [draft, draftBaseline, compare, sim]);
  const draftMeaning = useMemo(() => (draft ? meaningDiff(document, shown.document) : []), [draft, document, shown.document]);

  const funnels = useMemo(() => findFunnels(shown.document, projection), [shown.document, projection]);
  const geoFlags = useMemo(() => {
    const flags: Record<string, string> = {};
    for (const spec of funnels) {
      if (spec.nonCentered) continue;
      const geometry = funnelGeometry(spec, sim, shown.document);
      if (!geometry || geometry.neck <= 8) continue;
      const label = `漏斗 ×${Number.isFinite(geometry.neck) ? geometry.neck.toFixed(0) : '∞'}`;
      flags[spec.childId] = label;
      flags[spec.scaleId] ??= label;
    }
    return flags;
  }, [funnels, sim, shown.document]);
  const findings = useMemo(() => findDuplicateAxes(shown.document), [shown.document]);
  const receiptMatch = useMemo(() => (receipt ? compareReceiptFingerprint(receipt, fingerprint) : null), [receipt, fingerprint]);
  const supports = useMemo(() => {
    const out: Record<string, RowSupport> = {};
    for (const row of [...projection.rows, ...projection.queries]) {
      out[row.id] = supportFor(row, shown.semantic.diagnostics, evidence, fingerprint, receipt, Boolean(receiptMatch?.matches), findings);
    }
    return out;
  }, [projection, shown.semantic.diagnostics, evidence, fingerprint, receipt, receiptMatch, findings]);

  const gradeCounts = useMemo(() => {
    const counts: Partial<Record<SupportGrade, number>> = {};
    let assumptions = 0;
    let grounded = 0;
    for (const row of projection.rows) {
      const grade = supports[row.id]!.grade;
      counts[grade] = (counts[grade] ?? 0) + 1;
      if (row.entity.kind === 'random_variable') {
        assumptions += 1;
        if (grade === 'reasoned' || grade === 'checked') grounded += 1;
      }
    }
    return { counts, assumptions, grounded };
  }, [projection, supports]);

  /* ---------- actions ---------- */
  const notify = useCallback((message: string, extra?: Partial<Toast>) => setToast({ message, ...extra }), []);

  const edit = useCallback((label: string, operations: JsonPatchOperation[]) => {
    try {
      model.apply(label, operations);
      setDraft(null);
      notify(`${label}。`, { undo: true });
    } catch (error) {
      notify(`変更できませんでした: ${(error as Error).message}。モデルは変更していません。`, { tone: 'danger' });
    }
  }, [model, notify]);

  const saveVariants = useCallback((next: ModelVariant[]) => {
    try {
      setVariants(persistModelVariants(next));
      return true;
    } catch {
      notify('モデル案をブラウザへ保存できません。古い案を整理するか、書き出しで保存してください。', { tone: 'danger' });
      return false;
    }
  }, [notify]);

  const baselineVariant = useCallback((current: ModelDocument, currentLayout: LayoutDocument, before: string) => {
    const existing = variants.find((variant) => fingerprintOf(variant.document) === fingerprintOf(current));
    return existing ?? createModelVariant(`「${before}」の前`, current, currentLayout);
  }, [variants]);

  const fork = useCallback((label: string, variantLabel: string, operations: JsonPatchOperation[]) => {
    try {
      const baseline = baselineVariant(document, layout, variantLabel);
      const next = model.apply(label, operations);
      const alternative = createModelVariant(variantLabel, next, layout);
      const others = variants.filter((variant) => variant.id !== baseline.id);
      if (!saveVariants([alternative, baseline, ...others])) return;
      setDraft(null);
      setCompareId(baseline.id);
      setT(0);
      notify(`「${variantLabel}」案を作りました。基準との意味の差を表示しています。`, { undo: true });
    } catch (error) {
      notify(`案を作れませんでした: ${(error as Error).message}`, { tone: 'danger' });
    }
  }, [baselineVariant, document, layout, model, notify, saveVariants, variants]);

  const scrub = useCallback((entityId: string, arg: string, value: string) => {
    const entity = document.entities[entityId];
    if (!entity) return;
    const original = entity.kind === 'random_variable' ? entity.distribution.args[arg]?.source : undefined;
    if (original === value) {
      setDraft(null);
      return;
    }
    setDraft({
      entityId,
      label: `${entity.symbol} の ${arg} を ${original} → ${value}`,
      operations: [{ op: 'replace', path: `/entities/${entityId}/distribution/args/${arg}/source`, value }],
    });
  }, [document]);

  const undo = useCallback(() => {
    const label = model.undo();
    if (label) notify(`「${label}」を取り消しました。`);
  }, [model, notify]);
  const redo = useCallback(() => {
    const label = model.redo();
    if (label) notify(`「${label}」をやり直しました。`);
  }, [model, notify]);

  // Morph playback when a comparison opens.
  const raf = useRef(0);
  const play = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / 1400);
      setT(progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2);
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => {
    if (compareId) play();
    return () => cancelAnimationFrame(raf.current);
  }, [compareId, play]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.undo ? 7000 : 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === 'Escape') {
        if (draft) setDraft(null);
        else if (focus) setFocus(null);
        else if (compareId) setCompareId(null);
        return;
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.altKey && target.closest('.row-line, body') === target) {
        const ids = projection.rows.map((row) => row.id);
        const index = focus ? ids.indexOf(focus) : -1;
        const next = ids[Math.max(0, Math.min(ids.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        if (next) {
          event.preventDefault();
          setFocus(next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compareId, draft, focus, projection, redo, undo]);

  useEffect(() => {
    if (!focus) return;
    window.requestAnimationFrame(() => {
      window.document.querySelector(`.row.rel-focus`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [focus]);

  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what}をコピーしました。`);
    } catch {
      notify(`${what}をコピーできませんでした。ブラウザのクリップボード許可を確認してください。`, { tone: 'danger' });
    }
  }, [notify]);

  const known = useMemo(() => new Set(Object.values(shown.document.entities).map((entity) => entity.symbol)), [shown.document]);
  const blocking = shown.semantic.diagnostics.filter((item) => item.blocksHandoff).length;
  const docLevelDiagnostics = shown.semantic.diagnostics.filter((item) => !item.path.startsWith('/entities/'));

  return (
    <div className="score-app">
      <header className="topline">
        <div className="brand">
          <span className="brand-name">Bayes Canvas</span>
          <span className="brand-mode">Score</span>
          <span className="model-name">{document.model.name}</span>
          <span className="revision num">rev {document.revision}</span>
        </div>
        <nav className="modes" aria-label="読み方">
          {READING_MODES.map((item) => (
            <button key={item.id} type="button" className={mode === item.id ? 'is-on' : ''} aria-pressed={mode === item.id} title={item.hint} onClick={() => setMode(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button type="button" className="quiet" disabled={!model.canUndo} title={model.undoLabel ? `取り消す: ${model.undoLabel}` : undefined} onClick={undo}>取り消す</button>
          <button type="button" className="quiet" disabled={!model.canRedo} title={model.redoLabel ? `やり直す: ${model.redoLabel}` : undefined} onClick={redo}>やり直す</button>
          <button type="button" className="quiet" onClick={() => setImportOpen(true)}>読み込む</button>
          <a className="quiet" href="#/">旧UIで開く</a>
        </div>
      </header>

      <main className="score-main">
        <section className="question" aria-label="推定目標">
          <span className="eyebrow">問い</span>
          {projection.queries.length ? (
            <div className="question-list">
              {projection.queries.map((query) => (
                <span key={query.id} className="question-item"><Tex tex={statementTex(query, known)} /><span className="question-label">{query.entity.label}</span></span>
              ))}
            </div>
          ) : (
            <div className="question-empty">
              <span>このモデルで何を知りたいかが宣言されていません。</span>
              {projection.rows.filter((row) => row.role === 'belief').slice(0, 3).map((row) => (
                <button key={row.id} type="button" className="act" onClick={() => edit(`${row.entity.symbol} を推定目標にする`, queryOperations(document, row.entity.symbol))}>
                  {row.entity.symbol} を知りたい
                </button>
              ))}
            </div>
          )}
          <Certainty {...gradeCounts} total={projection.rows.length} />
        </section>

        <Alternatives
          variants={variants}
          currentFingerprint={fingerprint}
          compareId={compareId}
          onCompare={(id) => { setCompareId(id === compareId ? null : id); }}
          onSave={(label) => {
            if (saveVariants([createModelVariant(label, document, layout), ...variants])) notify(`「${label}」を保存しました。`);
          }}
        />

        {compare && compareVariant && (
          <section className="compare" aria-label="意味の比較">
            <div className="compare-head">
              <span className="compare-ab"><span className="ab ab-a">A</span>{compareVariant.label}</span>
              <input
                className="scrubber"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={t}
                aria-label="AからBへの変形"
                onChange={(event) => { cancelAnimationFrame(raf.current); setT(Number(event.target.value)); }}
              />
              <span className="compare-ab"><span className="ab ab-b">B</span>現在</span>
              <button type="button" className="quiet" onClick={play}>変形を再生</button>
              <button type="button" className="quiet" onClick={() => {
                model.commit(`「${compareVariant.label}」に戻す`, structuredClone(compareVariant.document));
                setCompareId(null);
                notify(`「${compareVariant.label}」に戻しました。`, { undo: true });
              }}>A に戻す</button>
              <button type="button" className="quiet" onClick={() => setCompareId(null)}>比較を閉じる</button>
            </div>
            {compare.list.length ? (
              <ol className="meaning">
                {compare.list.map((change, index) => (
                  <li key={index} className={`meaning-item meaning-${change.kind}`}>
                    <span className="meaning-kind">{MEANING_LABEL[change.kind]}</span>
                    <button type="button" className="meaning-text" disabled={!change.entityId} onClick={() => change.entityId && setFocus(change.entityId)}>{change.sentence}</button>
                  </li>
                ))}
              </ol>
            ) : <p className="missing">A と現在のモデルは意味の上で同じです。</p>}
            <ShiftList shifts={shifts} document={shown.document} onFocus={setFocus} />
            <EvidenceDelta evidence={evidence} a={fingerprintOf(compare.document)} b={fingerprint} />
          </section>
        )}

        {draft && (
          <div className="draft-bar" role="status">
            <span className="draft-label">試している変更</span>
            <span className="draft-text">
              {draftMeaning.map((change) => change.sentence).join(' ') || draft.label}
              <ShiftList shifts={shifts} document={shown.document} exclude={draft.entityId} onFocus={setFocus} />
            </span>
            <button type="button" className="primary" onClick={() => edit(draft.label, draft.operations)}>確定</button>
            <button type="button" className="quiet" onClick={() => fork(draft.label, `${document.entities[draft.entityId]?.symbol} 変更案`, draft.operations)}>別案として分岐</button>
            <button type="button" className="quiet" onClick={() => setDraft(null)}>戻す</button>
          </div>
        )}

        {docLevelDiagnostics.length > 0 && (
          <ul className="doc-diags">
            {docLevelDiagnostics.map((item) => <li key={`${item.code}${item.path}`} className={`doubt-${item.severity}`}>{item.message} <span className="num">{item.code}</span></li>)}
          </ul>
        )}

        <Sheet
          projection={projection}
          document={shown.document}
          mode={mode}
          focus={focus}
          onFocus={setFocus}
          brushed={brushed}
          onBrush={setBrushed}
          supports={supports}
          compare={compare ? { document: compare.document, projection: compare.projection, changes: compare.changes, t } : undefined}
          receipt={receiptMatch?.matches ? receipt : null}
          highlight={highlight}
          sparks={sim.marginals}
          ghostSparks={draft ? draftBaseline?.marginals : compare?.sim.marginals}
          sparkT={draft ? 1 : t}
          shifts={shifts}
          geoFlags={geoFlags}
          renderDossier={(row) => (
            <Dossier
              row={row}
              document={shown.document}
              projection={projection}
              support={supports[row.id]!}
              questions={questionsFor(row, shown.document)}
              findings={findings.filter((finding) => finding.entityIds.includes(row.id))}
              sim={sim}
              ghost={draft ? draftBaseline ?? undefined : compare?.sim}
              t={draft ? 1 : t}
              drafting={Boolean(draft && draft.entityId === row.id)}
              onScrub={scrub}
              onEdit={edit}
              onFork={fork}
              onFocus={setFocus}
              funnels={funnels}
            />
          )}
        />

        <Ledger
          evidence={evidence}
          fingerprint={fingerprint}
          onHover={(ids) => setHighlight(new Set(ids))}
          blocking={blocking}
          receipt={receipt}
          receiptMessage={receiptMatch?.message}
          onCopyProtocol={() => copy(generateCriticismPrompt(document, fingerprint, buildSensitivityScenarios(document)), '検証protocol')}
          onCopyCard={() => copy(generateModelCardMarkdown(document, semantic.diagnostics, buildModelScorecard(document, semantic.diagnostics), evidence.filter((item) => item.specificationFingerprint === fingerprint)), 'Model Card')}
          onCopyPackage={() => copy(JSON.stringify(buildPortablePackage(document, layout, semantic, 'review'), null, 2), 'portable package')}
          onCopyHandoff={() => copy(JSON.stringify(buildHandoffBundle(document, semantic, 'numpyro'), null, 2), 'handoff bundle')}
          onImport={() => setImportOpen(true)}
        />
      </main>

      {importOpen && (
        <ImportSheet
          current={document}
          onClose={() => setImportOpen(false)}
          onModel={(next, nextLayout, label) => {
            const baseline = baselineVariant(document, layout, '読み込み');
            saveVariants([baseline, ...variants.filter((variant) => variant.id !== baseline.id)]);
            model.commit(label, next, nextLayout);
            setFocus(null);
            setCompareId(baseline.id);
            setImportOpen(false);
            notify('読み込みました。読み込み前の版をモデル案として残しています。', { undo: true });
          }}
          onEvidence={(bundle) => {
            try {
              const next = persistModelEvidence([bundle, ...evidence]);
              setEvidence(next);
              setImportOpen(false);
              notify(bundle.specificationFingerprint === fingerprint ? 'Evidence を取り込み、該当する文へ結び付けました。' : 'Evidence を取り込みました。fingerprint が現在の仕様と異なるため、支持には数えません。');
            } catch (error) {
              notify((error as Error).message, { tone: 'danger' });
            }
          }}
          onReceipt={(next) => {
            setReceipt(next);
            setImportOpen(false);
            setMode('impl');
            notify(compareReceiptFingerprint(next, fingerprint).message);
          }}
        />
      )}

      {model.saveError && <div className="save-error" role="alert">{model.saveError}</div>}
      {toast && (
        <div className={`toast${toast.tone === 'danger' ? ' is-danger' : ''}`} role="status">
          <span>{toast.message}</span>
          {toast.undo && model.canUndo && <button type="button" className="quiet" onClick={() => { undo(); setToast(null); }}>取り消す</button>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const GRADE_ORDER: SupportGrade[] = ['contested', 'stated', 'reasoned', 'checked', 'derived', 'given'];

function Certainty({ counts, total, assumptions, grounded }: { counts: Partial<Record<SupportGrade, number>>; total: number; assumptions: number; grounded: number }) {
  return (
    <div className="certainty" aria-label="主張の確からしさの内訳">
      <span className="certainty-hero">
        <span className="certainty-num num">{grounded}<small>/{assumptions}</small></span>
        <span className="certainty-caption">根拠のある仮定</span>
      </span>
      <span className="certainty-bar">
        {GRADE_ORDER.filter((grade) => counts[grade]).map((grade) => (
          <span key={grade} className={`certainty-seg rail-${grade}`} style={{ flexGrow: counts[grade] }} title={`${SUPPORT_LABEL[grade]} ${counts[grade]}`} />
        ))}
      </span>
      <span className="certainty-legend">
        {GRADE_ORDER.filter((grade) => counts[grade]).map((grade) => (
          <span key={grade} className="certainty-item"><span className={`rail-sample rail-${grade}`} />{SUPPORT_LABEL[grade]} <span className="num">{counts[grade]}</span></span>
        ))}
        <span className="certainty-total num">/ {total} 文</span>
      </span>
    </div>
  );
}

function Alternatives({ variants, currentFingerprint, compareId, onCompare, onSave }: {
  variants: ModelVariant[];
  currentFingerprint: string;
  compareId: string | null;
  onCompare: (id: string) => void;
  onSave: (label: string) => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const entries = useMemo(() => variants.slice(0, 8).map((variant) => ({ variant, same: fingerprintOf(variant.document) === currentFingerprint })), [variants, currentFingerprint]);
  return (
    <section className="alternatives" aria-label="モデル案">
      <span className="eyebrow">案</span>
      <span className="alt alt-current"><span className="alt-dot" />現在</span>
      {entries.map(({ variant, same }) => (
        <button
          key={variant.id}
          type="button"
          className={`alt${compareId === variant.id ? ' is-on' : ''}${same ? ' is-same' : ''}`}
          aria-pressed={compareId === variant.id}
          aria-label={`${variant.label}${same ? '（現在と同じ仕様）' : 'と現在を比較する'}`}
          onClick={() => onCompare(variant.id)}
        >
          <span className="alt-dot" />{variant.label}{same && <span className="alt-same">= 現在</span>}
        </button>
      ))}
      {naming === null ? (
        <button type="button" className="quiet" onClick={() => setNaming(`案 ${variants.length + 1}`)}>この版を案として保存</button>
      ) : (
        <form
          className="alt-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!naming.trim()) return;
            onSave(naming.trim());
            setNaming(null);
          }}
        >
          <input autoFocus value={naming} aria-label="案の名前" onChange={(event) => setNaming(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setNaming(null); }} />
          <button type="submit" className="act" disabled={!naming.trim()}>保存</button>
          <button type="button" className="quiet" onClick={() => setNaming(null)}>やめる</button>
        </form>
      )}
    </section>
  );
}

function ShiftList({ shifts, document, exclude, onFocus }: { shifts: Record<string, number>; document: ModelDocument; exclude?: string; onFocus: (id: string) => void }) {
  const entries = Object.entries(shifts).filter(([id]) => id !== exclude && document.entities[id]);
  if (!entries.length) return null;
  return (
    <span className="shift-list">
      <span className="shift-head">形が変わる文</span>
      {entries.map(([id, ratio]) => (
        <button key={id} type="button" className="shift" onClick={() => onFocus(id)}>
          {document.entities[id]!.symbol}
          <span className="num">90%幅 ×{ratio.toFixed(2)}</span>
        </button>
      ))}
    </span>
  );
}

function EvidenceDelta({ evidence, a, b }: { evidence: ModelEvidenceBundle[]; a: string; b: string }) {
  const countA = evidence.filter((item) => item.specificationFingerprint === a).length;
  const countB = evidence.filter((item) => item.specificationFingerprint === b).length;
  return (
    <p className="evidence-delta">
      Evidence: A <span className="num">{countA}</span> 件 → 現在 <span className="num">{countB}</span> 件
      {countB < countA && <span className="missing">。仕様が変わったため、A の検証結果は現在の案を支持しません。</span>}
    </p>
  );
}

function Ledger(props: {
  evidence: ModelEvidenceBundle[];
  fingerprint: string;
  onHover: (ids: string[]) => void;
  blocking: number;
  receipt: ImplementationReceipt | null;
  receiptMessage?: string;
  onCopyProtocol: () => void;
  onCopyCard: () => void;
  onCopyPackage: () => void;
  onCopyHandoff: () => void;
  onImport: () => void;
}) {
  const current = props.evidence.filter((item) => item.specificationFingerprint === props.fingerprint);
  const stale = props.evidence.length - current.length;
  return (
    <section className="ledger" aria-label="検証と受け渡し">
      <div className="ledger-col">
        <h2>試したこと</h2>
        {current.length ? (
          <ol className="runs">
            {current.map((run, index) => {
              const ids = [...run.metrics.flatMap((metric) => metric.entityIds), ...run.findings.flatMap((finding) => finding.entityIds)];
              return (
                <li key={index} className={`run run-${run.status}`} onMouseEnter={() => props.onHover(ids)} onMouseLeave={() => props.onHover([])}>
                  <span className="run-status">{run.status === 'passed' ? '支持' : run.status === 'review' ? '要確認' : '反証'}</span>
                  <span className="run-type">{run.runType}</span>
                  <span className="run-meta num">{run.backend} · {new Date(run.createdAt).toLocaleDateString('ja-JP')}</span>
                  <span className="run-links num">{new Set(ids).size} 文に関係</span>
                </li>
              );
            })}
          </ol>
        ) : <p className="missing">現在の仕様（fingerprint <span className="num">{props.fingerprint.slice(0, 10)}</span>）ではまだ何も検証していません。</p>}
        {stale > 0 && <p className="note">別の仕様に対する Evidence が {stale} 件あります。</p>}
        <div className="ledger-acts">
          <button type="button" className="act" onClick={props.onCopyProtocol}>検証protocolをコピー</button>
          <button type="button" className="act" onClick={props.onImport}>結果を読み込む</button>
        </div>
      </div>
      <div className="ledger-col">
        <h2>渡す</h2>
        <p className={props.blocking ? 'handoff-blocked' : 'handoff-ready'}>
          {props.blocking ? `${props.blocking} 件の診断が受け渡しを止めています。` : '受け渡しできます。'}
          <span className="num"> sha256:{props.fingerprint.slice(0, 12)}</span>
        </p>
        <div className="ledger-acts">
          <button type="button" className="act" onClick={props.onCopyHandoff}>handoff bundle をコピー</button>
          <button type="button" className="act" onClick={props.onCopyPackage}>portable package をコピー</button>
          <button type="button" className="act" onClick={props.onCopyCard}>Model Card をコピー</button>
        </div>
        {props.receipt ? (
          <div className="receipt">
            <span className="receipt-head">実装 receipt · {props.receipt.backend}</span>
            <span>{props.receiptMessage}</span>
            <span className="num">{props.receipt.mappings.length} 対応 · 逸脱 {props.receipt.deviations.length} · 追加仮定 {props.receipt.addedAssumptions.length}</span>
            {props.receipt.addedAssumptions.map((item) => <span key={item} className="receipt-assumption">追加仮定: {item}</span>)}
          </div>
        ) : <p className="missing">実装 receipt はまだ戻っていません。</p>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

type ImportResult =
  | { kind: 'model'; document: ModelDocument; layout: LayoutDocument; summary: string; changes: MeaningChange[]; warnings: string[] }
  | { kind: 'evidence'; bundle: ModelEvidenceBundle }
  | { kind: 'receipt'; receipt: ImplementationReceipt };

function ImportSheet({ current, onClose, onModel, onEvidence, onReceipt }: {
  current: ModelDocument;
  onClose: () => void;
  onModel: (document: ModelDocument, layout: LayoutDocument, label: string) => void;
  onEvidence: (bundle: ModelEvidenceBundle) => void;
  onReceipt: (receipt: ImplementationReceipt) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const inspect = (input: string) => {
    setError(null);
    setResult(null);
    if (!input.trim()) return;
    try {
      const value = parseImportJsonText(input, IMPORT_LIMITS) as Record<string, unknown>;
      if (value && typeof value === 'object' && 'evidenceVersion' in value) {
        setResult({ kind: 'evidence', bundle: validateModelEvidence(value) });
      } else if (value && typeof value === 'object' && 'receiptVersion' in value) {
        setResult({ kind: 'receipt', receipt: validateImplementationReceipt(value) });
      } else {
        const preview = previewPortablePackageImport(value);
        setResult({ kind: 'model', document: preview.document, layout: preview.layout, summary: preview.summary, warnings: preview.importWarnings, changes: meaningDiff(current, preview.document) });
      }
    } catch (caught) {
      setError(`読み込めません: ${(caught as Error).message}。JSON全体（portable package / ModelDocument / Evidence / Receipt）を貼り付けてください。`);
    }
  };

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="読み込み" onClick={onClose}>
      <div className="import" onClick={(event) => event.stopPropagation()}>
        <h2>読み込む</h2>
        <textarea
          value={text}
          autoFocus
          placeholder="portable package・ModelDocument・Evidence・Implementation Receipt の JSON（AIの返答そのままでも可）"
          onChange={(event) => { setText(event.target.value); inspect(event.target.value); }}
        />
        <label className="file">
          ファイルを選ぶ
          <input type="file" accept=".json,application/json" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const content = await file.text();
            setText(content);
            inspect(content);
          }} />
        </label>
        {error && <p className="error">{error}</p>}
        {result?.kind === 'model' && (
          <div className="import-preview">
            <p>{result.summary}</p>
            {result.warnings.map((warning) => <p key={warning} className="note">{warning}</p>)}
            <ol className="meaning">
              {result.changes.slice(0, 12).map((change, index) => (
                <li key={index} className="meaning-item"><span className="meaning-kind">{MEANING_LABEL[change.kind]}</span><span className="meaning-text">{change.sentence}</span></li>
              ))}
            </ol>
            {result.changes.length > 12 && <p className="note">ほか {result.changes.length - 12} 件</p>}
          </div>
        )}
        {result?.kind === 'evidence' && <p>{result.bundle.runType} · {result.bundle.backend} · metric {result.bundle.metrics.length} / finding {result.bundle.findings.length}</p>}
        {result?.kind === 'receipt' && <p>{result.receipt.backend} · 対応 {result.receipt.mappings.length} 件</p>}
        <div className="import-acts">
          <button type="button" className="quiet" onClick={onClose}>閉じる</button>
          <button
            type="button"
            className="primary"
            disabled={!result}
            onClick={() => {
              if (result?.kind === 'model') onModel(result.document, result.layout, 'モデルを読み込む');
              else if (result?.kind === 'evidence') onEvidence(result.bundle);
              else if (result?.kind === 'receipt') onReceipt(result.receipt);
            }}
          >
            {result?.kind === 'model' ? 'このモデルに置き換える' : result?.kind === 'evidence' ? 'Evidence を取り込む' : result?.kind === 'receipt' ? 'receipt を照合する' : '取り込む'}
          </button>
        </div>
      </div>
    </div>
  );
}
