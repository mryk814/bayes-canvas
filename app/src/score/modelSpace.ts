import type { ModelDocument } from '../lib/core/model.js';
import type { EvidenceAssessment, EvidenceQuantity, ModelEvidenceBundle } from '../lib/modelEvidence.js';
import { MEANING_LABEL, meaningDiff, type MeaningChange, type MeaningKind } from './scoreModel.js';

/**
 * Model Space: every model candidate on one map, grouped by which kind of
 * assumption differs from the current model, with the conclusion about one
 * quantity of interest (QoI) lined up per candidate.
 */

export interface SpaceInput {
  id: string;
  label: string;
  document: ModelDocument;
  implementation: string;
  semantic: string;
}

export interface SpaceCandidate {
  /** The first member's id; for the current model, 'current'. */
  id: string;
  label: string;
  document: ModelDocument;
  isCurrent: boolean;
  /** Saved variants that are this same probabilistic model. */
  memberIds: string[];
  memberLabels: string[];
  implementations: string[];
  semantic: string;
}

export interface Interval {
  lo: number;
  mid: number;
  hi: number;
}

export type ConclusionSource = 'posterior' | 'prior_evidence' | 'prior_simulation' | 'none';

export const SOURCE_LABEL: Record<ConclusionSource, string> = {
  posterior: '事後',
  prior_evidence: '事前（Evidence）',
  prior_simulation: '事前（試算）',
  none: '—',
};

export interface Conclusion {
  source: ConclusionSource;
  interval?: Interval;
  bundle?: ModelEvidenceBundle;
}

export type Agreement = 'baseline' | 'agree' | 'width' | 'shifted' | 'sign_flip' | 'incomparable' | 'missing';

export const AGREEMENT_LABEL: Record<Agreement, string> = {
  baseline: '基準',
  agree: '一致',
  width: '幅が違う',
  shifted: 'ずれ',
  sign_flip: '符号反転',
  incomparable: '比較不可',
  missing: '結論なし',
};

export interface Assessment {
  evaluated: boolean;
  stackingWeight?: number;
  elpdLoo?: number;
  elpdLooSe?: number;
  flags: string[];
}

export interface SpaceRow {
  candidate: SpaceCandidate;
  kinds: MeaningKind[];
  /** Changes from the current model that alter the probabilistic model. */
  changes: MeaningChange[];
  conclusion: Conclusion;
  agreement: Agreement;
  assessment: Assessment;
}

export interface SpaceGroup {
  key: string;
  label: string;
  rows: SpaceRow[];
  /** Short statement of how this group's conclusions compare with the baseline. */
  summary: string;
}

export interface ModelSpace {
  qoi: string;
  basis: SpaceBasis;
  groups: SpaceGroup[];
  /** One sentence naming the assumption that splits the conclusion, if any. */
  headline: string;
  /** Shared axis range for the forest plot. */
  domain: [number, number];
}

const KIND_ORDER: MeaningKind[] = ['observation', 'prior', 'hierarchy', 'index', 'structure', 'assumption', 'estimand', 'implementation'];
const DISAGREEMENTS: Agreement[] = ['sign_flip', 'shifted', 'width'];

/* ------------------------------------------------------------------ */

/** Current model first, then saved variants; variants with the same semantic fingerprint become one candidate. */
export function spaceCandidates(current: SpaceInput, variants: readonly SpaceInput[]): SpaceCandidate[] {
  const bySemantic = new Map<string, SpaceCandidate>();
  const make = (input: SpaceInput, isCurrent: boolean): SpaceCandidate => ({
    id: isCurrent ? 'current' : input.id,
    label: isCurrent ? '現在' : input.label,
    document: input.document,
    isCurrent,
    memberIds: isCurrent ? [] : [input.id],
    memberLabels: isCurrent ? [] : [input.label],
    implementations: [input.implementation],
    semantic: input.semantic,
  });
  bySemantic.set(current.semantic, make(current, true));
  for (const variant of variants) {
    const existing = bySemantic.get(variant.semantic);
    if (existing) {
      existing.memberIds.push(variant.id);
      existing.memberLabels.push(variant.label);
      if (!existing.implementations.includes(variant.implementation)) existing.implementations.push(variant.implementation);
    } else {
      bySemantic.set(variant.semantic, make(variant, false));
    }
  }
  return [...bySemantic.values()];
}

/** Evidence counts for a candidate when it was run on one of its implementations or the same probabilistic model. */
export function evidenceFor(
  candidate: SpaceCandidate,
  evidence: readonly ModelEvidenceBundle[],
  semanticOf: Readonly<Record<string, string>>,
): ModelEvidenceBundle[] {
  return evidence.filter((bundle) =>
    candidate.implementations.includes(bundle.specificationFingerprint)
    || semanticOf[bundle.specificationFingerprint] === candidate.semantic);
}

/** The symbol a QoI is about: a query whose expression is a bare symbol refers to that symbol. */
export function qoiSymbolOf(document: ModelDocument, entityId: string): string | undefined {
  const entity = document.entities[entityId];
  if (!entity) return undefined;
  if (entity.kind === 'query') {
    const source = entity.expression.source.trim();
    return /^[A-Za-z_]\w*$/.test(source) ? source : entity.symbol;
  }
  return entity.symbol;
}

/** QoI choices: declared queries first, then parameters, as symbols. */
export function qoiOptions(document: ModelDocument): string[] {
  const entities = document.entityOrder.map((id) => document.entities[id]).filter((entity) => entity !== undefined);
  const queries = entities.filter((entity) => entity.kind === 'query').map((entity) => qoiSymbolOf(document, entity.id)!);
  const parameters = entities
    .filter((entity) => entity.kind === 'random_variable' && entity.role === 'parameter')
    .map((entity) => entity.symbol);
  return [...new Set([...queries, ...parameters])];
}

function intervalOf(quantity: EvidenceQuantity): Interval {
  return { lo: quantity.q05, mid: quantity.q50, hi: quantity.q95 };
}

/** Latest posterior summary first, then a prior summary from Evidence, then the in-browser prior simulation. */
export function conclusionFor(
  candidate: SpaceCandidate,
  qoi: string,
  bundles: readonly ModelEvidenceBundle[],
  priorInterval: (document: ModelDocument, symbol: string) => Interval | undefined,
): Conclusion {
  const latest = [...bundles].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const distribution of ['posterior', 'prior'] as const) {
    for (const bundle of latest) {
      const quantity = bundle.quantities?.find((item) =>
        item.distribution === distribution && qoiSymbolOf(candidate.document, item.entityId) === qoi);
      if (quantity) return { source: distribution === 'posterior' ? 'posterior' : 'prior_evidence', interval: intervalOf(quantity), bundle };
    }
  }
  const simulated = priorInterval(candidate.document, qoi);
  return simulated ? { source: 'prior_simulation', interval: simulated } : { source: 'none' };
}

/**
 * Compare a candidate's interval with the baseline's, only like with like:
 * posterior with posterior, prior with prior.
 */
export function compareConclusions(baseline: Conclusion, other: Conclusion): Agreement {
  if (!other.interval) return 'missing';
  if (!baseline.interval) return 'incomparable';
  const posterior = (conclusion: Conclusion) => conclusion.source === 'posterior';
  if (posterior(baseline) !== posterior(other)) return 'incomparable';
  const a = baseline.interval;
  const b = other.interval;
  const side = (interval: Interval) => (interval.lo > 0 ? 1 : interval.hi < 0 ? -1 : 0);
  if (side(a) !== 0 && side(b) !== 0 && side(a) !== side(b)) return 'sign_flip';
  if (b.lo > a.hi || b.hi < a.lo) return 'shifted';
  const widthA = a.hi - a.lo;
  const widthB = b.hi - b.lo;
  if (widthA > 0 && (widthB / widthA > 2 || widthB / widthA < 0.5)) return 'width';
  return 'agree';
}

export function assessmentFor(bundles: readonly ModelEvidenceBundle[]): Assessment {
  const latest = [...bundles]
    .filter((bundle) => bundle.assessment && Object.keys(bundle.assessment).length)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!latest) return { evaluated: false, flags: [] };
  const value: EvidenceAssessment = latest.assessment!;
  const flags: string[] = [];
  if (value.divergences !== undefined && value.divergences > 0) flags.push(`divergence ${value.divergences}`);
  if (value.maxRhat !== undefined && value.maxRhat > 1.01) flags.push(`R-hat ${value.maxRhat.toFixed(3)}`);
  if (value.minEssBulk !== undefined && value.minEssBulk < 400) flags.push(`ESS ${Math.round(value.minEssBulk)}`);
  return { evaluated: true, stackingWeight: value.stackingWeight, elpdLoo: value.elpdLoo, elpdLooSe: value.elpdLooSe, flags };
}

/**
 * Kinds of assumption that differ from the current model. Estimand changes
 * alone form their own group; next to other changes they do not split groups,
 * because declaring a QoI does not change the joint distribution.
 */
export function groupKinds(changes: readonly MeaningChange[]): MeaningKind[] {
  const kinds = [...new Set(changes.filter((change) => !change.soft).map((change) => change.kind))];
  const withoutEstimand = kinds.filter((kind) => kind !== 'estimand');
  return (withoutEstimand.length ? withoutEstimand : kinds).sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
}

function groupLabel(key: string, kinds: readonly MeaningKind[]): string {
  if (key === 'baseline') return '基準（現在のモデル）';
  return kinds.length ? kinds.map((kind) => MEANING_LABEL[kind]).join('＋') : 'その他の違い';
}

/** Baseline first, then fewer kinds of change, then by kind order. */
function compareGroupKeys(a: string, b: string): number {
  if (a === 'baseline' || b === 'baseline') return a === 'baseline' ? -1 : b === 'baseline' ? 1 : 0;
  const ranks = (key: string) => (key === 'same' ? [KIND_ORDER.length] : key.split('+').map((kind) => KIND_ORDER.indexOf(kind as MeaningKind)));
  const ra = ranks(a);
  const rb = ranks(b);
  if (ra.length !== rb.length) return ra.length - rb.length;
  const index = ra.findIndex((rank, position) => rank !== rb[position]);
  return index < 0 ? 0 : ra[index]! - rb[index]!;
}

/** Whether the map compares posteriors or, before any posterior is back, priors. */
export type SpaceBasis = 'posterior' | 'prior';

/** "beta の" or "beta の事前分布の", so a prior comparison is never read as a conclusion. */
function subjectOf(qoi: string, basis: SpaceBasis): string {
  return basis === 'posterior' ? `${qoi} の` : `${qoi} の事前分布の`;
}

function groupSummary(rows: readonly SpaceRow[], qoi: string, basis: SpaceBasis): string {
  if (rows.some((row) => row.agreement === 'baseline')) return '';
  const count = (agreement: Agreement) => rows.filter((row) => row.agreement === agreement).length;
  const of = subjectOf(qoi, basis);
  if (count('sign_flip')) return `${of}符号が反転`;
  if (count('shifted')) return `${of}区間が重ならない`;
  if (count('width')) return `${of}幅が違う`;
  if (count('agree')) return basis === 'posterior' ? `${qoi} の結論は揃っている` : `${qoi} の事前分布は揃っている`;
  return '比較できる結論がない';
}

/** Name the assumption kind that alone splits the conclusion. */
export function spaceHeadline(groups: readonly SpaceGroup[], qoi: string, basis: SpaceBasis = 'posterior'): string {
  const compared = groups.filter((group) => group.rows.some((row) => row.agreement !== 'baseline' && row.agreement !== 'incomparable' && row.agreement !== 'missing'));
  if (!compared.length) return '';
  const splitting = compared.filter((group) => group.rows.some((row) => DISAGREEMENTS.includes(row.agreement)));
  if (!splitting.length) {
    return basis === 'posterior'
      ? `どの仮定を変えても ${qoi} の結論は揃っている。`
      : `どの仮定を変えても ${qoi} の事前分布は揃っている。事後分布はまだ戻っていない。`;
  }
  const worst = (group: SpaceGroup) => Math.min(...group.rows.map((row) => {
    const index = DISAGREEMENTS.indexOf(row.agreement);
    return index < 0 ? DISAGREEMENTS.length : index;
  }));
  const effect = ['符号が反転する', '区間が基準と重ならない', '幅が基準と大きく違う'];
  const sorted = [...splitting].sort((a, b) => worst(a) - worst(b));
  const top = sorted[0]!;
  const labels = sorted.filter((group) => worst(group) === worst(top)).map((group) => group.label);
  // "だけ" only when other compared groups agree; otherwise just say where it happens.
  const only = splitting.length < compared.length ? 'だけ' : 'で';
  return `${labels.join('、')}を変えた案${only} ${subjectOf(qoi, basis)}${effect[worst(top)]}。`;
}

export function buildModelSpace(input: {
  current: SpaceInput;
  variants: readonly SpaceInput[];
  evidence: readonly ModelEvidenceBundle[];
  semanticOf: Readonly<Record<string, string>>;
  qoi: string;
  priorInterval: (document: ModelDocument, symbol: string) => Interval | undefined;
}): ModelSpace {
  const candidates = spaceCandidates(input.current, input.variants);
  const rows: SpaceRow[] = candidates.map((candidate) => {
    const bundles = evidenceFor(candidate, input.evidence, input.semanticOf);
    const changes = candidate.isCurrent ? [] : meaningDiff(input.current.document, candidate.document).filter((change) => !change.soft);
    return {
      candidate,
      kinds: groupKinds(changes),
      changes,
      conclusion: conclusionFor(candidate, input.qoi, bundles, input.priorInterval),
      agreement: 'baseline',
      assessment: assessmentFor(bundles),
    };
  });
  const baseline = rows[0]!;
  for (const row of rows.slice(1)) row.agreement = compareConclusions(baseline.conclusion, row.conclusion);
  const basis: SpaceBasis = baseline.conclusion.source === 'posterior' ? 'posterior' : 'prior';

  const byKey = new Map<string, SpaceRow[]>();
  for (const row of rows) {
    const key = row.candidate.isCurrent ? 'baseline' : row.kinds.join('+') || 'same';
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const keys = [...byKey.keys()].sort(compareGroupKeys);
  const groups = keys.map((key) => {
    const groupRows = byKey.get(key)!;
    return { key, label: groupLabel(key, groupRows[0]!.kinds), rows: groupRows, summary: groupSummary(groupRows, input.qoi, basis) };
  });

  // Posteriors set the axis when the map compares posteriors; wider prior bands are clipped at the edge.
  const bounds = (list: readonly SpaceRow[]) => list.flatMap((row) => (row.conclusion.interval ? [row.conclusion.interval.lo, row.conclusion.interval.hi] : []));
  const comparable = bounds(rows.filter((row) => (basis === 'posterior' ? row.conclusion.source === 'posterior' : true)));
  const values = comparable.length ? comparable : bounds(rows);
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (!values.length || hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.06;
  return { qoi: input.qoi, basis, groups, headline: spaceHeadline(groups, input.qoi, basis), domain: [lo - pad, hi + pad] };
}

/* ------------------------------------------------------------------ */
/* Asking an AI for alternative models                                */
/* ------------------------------------------------------------------ */

export const VARIANTS_VERSION = 'bayes-canvas-variants@1' as const;

export interface VariantProposal {
  label: string;
  rationale?: string;
  /** A ModelDocument or a portable package. */
  model: unknown;
}

export interface VariantsEnvelope {
  variantsVersion: typeof VARIANTS_VERSION;
  baseFingerprint?: string;
  variants: VariantProposal[];
}

export function isVariantsEnvelope(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'variantsVersion' in value);
}

/** Checks the envelope only; each model goes through the regular import preview. */
export function validateVariantsEnvelope(value: unknown): VariantsEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('案の一覧はJSON objectで指定してください。');
  const candidate = value as Partial<VariantsEnvelope>;
  if (candidate.variantsVersion !== VARIANTS_VERSION) throw new Error(`variantsVersionは${VARIANTS_VERSION}を指定してください。`);
  if (!Array.isArray(candidate.variants) || !candidate.variants.length) throw new Error('variantsに1つ以上の案を入れてください。');
  if (candidate.variants.length > 12) throw new Error('一度に取り込める案は12件までです。');
  return {
    variantsVersion: VARIANTS_VERSION,
    baseFingerprint: typeof candidate.baseFingerprint === 'string' ? candidate.baseFingerprint : undefined,
    variants: candidate.variants.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`案 ${index + 1} がobjectではありません。`);
      const proposal = item as Partial<VariantProposal>;
      if (!proposal.label || typeof proposal.label !== 'string') throw new Error(`案 ${index + 1} にlabelがありません。`);
      if (!proposal.model || typeof proposal.model !== 'object') throw new Error(`案「${proposal.label}」にmodelがありません。`);
      return { label: proposal.label.slice(0, 60), rationale: typeof proposal.rationale === 'string' ? proposal.rationale : undefined, model: proposal.model };
    }),
  };
}

export function generateVariantsPrompt(document: ModelDocument, fingerprint: string, qois: readonly string[], count = 4): string {
  return [
    `Propose ${count} alternative Bayesian models for the same data and question as this Bayes Canvas ModelDocument.`,
    `Question (quantities of interest): ${qois.length ? qois.join(', ') : 'not declared; keep the parameters comparable'}.`,
    'Each alternative should change one kind of assumption that could change the conclusion about the quantities of interest:',
    '- observation model (likelihood family, robustness to outliers, censoring or measurement error)',
    '- prior beliefs (scale, tails) on the parameters that drive the question',
    '- hierarchy (pooling: none, partial, complete)',
    '- structure (an omitted predictor or interaction)',
    'Do not propose rewrites that only change parameterization (centered vs non-centered); that is the same model.',
    'Keep entity IDs and symbols of unchanged parts identical, and keep the quantities of interest with the same symbols.',
    'Each model must be a complete ModelDocument (schemaVersion 1.0.0) that compiles on its own.',
    '',
    'Return exactly one JSON object:',
    '```json',
    JSON.stringify({
      variantsVersion: VARIANTS_VERSION,
      baseFingerprint: fingerprint,
      variants: [{ label: 'Student-t likelihood', rationale: 'One sentence: which assumption changes and why it could matter.', model: { schemaVersion: '1.0.0', '...': 'complete ModelDocument' } }],
    }, null, 2),
    '```',
    '',
    'Current ModelDocument:',
    '```json',
    JSON.stringify(document, null, 2),
    '```',
  ].join('\n');
}
