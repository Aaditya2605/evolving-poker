export function fmtChips(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtDial(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function fmtCost(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0.0000";
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function fmtLatency(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

export function fmtSigned(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  const value = n.toFixed(digits);
  return n > 0 ? `+${value}` : value;
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const scaled = n <= 1 ? n * 100 : n;
  return `${Math.round(scaled)}%`;
}

export function fmtDelta(before: number, after: number): string {
  const delta = after - before;
  if (Math.abs(delta) < 0.005) return "";
  return `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(2)}`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const DIAL_LABELS: Record<string, string> = {
  aggression: "aggression",
  bluffRate: "bluff rate",
  callThreshold: "call threshold",
};

export function dialLabel(dial: string): string {
  return DIAL_LABELS[dial] ?? dial;
}
