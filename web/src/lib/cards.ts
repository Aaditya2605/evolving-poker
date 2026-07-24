export interface ParsedCard {
  rank: string;
  suit: string;
  red: boolean;
}

const SUITS: Record<string, { glyph: string; red: boolean }> = {
  s: { glyph: "\u2660", red: false },
  h: { glyph: "\u2665", red: true },
  d: { glyph: "\u2666", red: true },
  c: { glyph: "\u2663", red: false },
};

export function parseCard(code: string): ParsedCard {
  const raw = (code ?? "").trim();
  if (raw.length < 2) return { rank: "?", suit: "", red: false };
  const suit = SUITS[raw.slice(-1).toLowerCase()] ?? { glyph: "?", red: false };
  const rankRaw = raw.slice(0, -1).toUpperCase();
  const rank = rankRaw === "T" ? "10" : rankRaw;
  return { rank, suit: suit.glyph, red: suit.red };
}
