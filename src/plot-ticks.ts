/** 11px monospace labels, estimated conservatively at 7px per character. */
export function plotTicks(xValues: readonly number[], yValues: readonly number[]) {
  const label = (value: number) => {
    const text = String(value);
    if (text.length <= 7) return text;
    const [mantissa, exponent] = value.toExponential(2).split("e");
    return `${Number(mantissa)}e${Number(exponent)}`;
  };
  const labels = (values: readonly number[]) => {
    const formatted = values.map(label);
    return new Set(formatted).size < new Set(values).size ? values.map(String) : formatted;
  };
  const x = labels(xValues), y = labels(yValues);
  const xHalfWidth = Math.max(0, ...x.map(text => text.length * 7 / 2));
  const yWidth = Math.max(0, ...y.map(text => text.length * 7));
  return { x, y, left: Math.max(56, yWidth + 10, xHalfWidth + 4), right: Math.max(16, xHalfWidth + 4) };
}

/** Select labels with a 6px gap; the scale and every plotted point stay unchanged. */
export function spacedTickIndices(labels: readonly string[], positions: readonly number[]) {
  const visible: number[] = [];
  let previousRight = -Infinity;
  labels.forEach((label, i) => {
    const halfWidth = label.length * 7 / 2;
    if (positions[i] - halfWidth >= previousRight + 6) {
      visible.push(i);
      previousRight = positions[i] + halfWidth;
    }
  });
  return visible;
}
