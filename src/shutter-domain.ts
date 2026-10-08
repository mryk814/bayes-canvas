/** Keep every value visible; null means the display cannot represent this span. */
export function shutterDomain(values: readonly number[]): [number, number] | null {
  if (!values.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    lo = Math.min(lo, value); hi = Math.max(hi, value);
  }
  const span = hi - lo;
  if (!Number.isFinite(span)) return null;
  const pad = span === 0 ? Math.max(1, Math.abs(lo) * 0.05) : span * 0.06;
  const lower = Number.isFinite(lo - pad) ? lo - pad : lo;
  const upper = Number.isFinite(hi + pad) ? hi + pad : hi;
  if (upper > lower && Number.isFinite(upper - lower)) return [lower, upper];
  return span > 0 ? [lo, hi] : null;
}
