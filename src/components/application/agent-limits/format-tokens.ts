/** 482_800 → "482.8k", 96_000 → "96k", 1_000_000 → "1M", 314 → "314". */
export function formatTokens(n: number) {
  const short = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (n >= 1_000_000) return `${short(n / 1_000_000)}M`;
  if (n >= 1_000) return `${short(n / 1_000)}k`;
  return String(n);
}
