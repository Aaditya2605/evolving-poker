// Seeded RNG + deck. Every random draw in the tournament routes through here so
// that a seed fully determines a run.

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS = ["s", "h", "d", "c"];

/** xfnv1a string hash → 32-bit seed for mulberry32. */
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh, independent random stream keyed by an arbitrary string. */
export function seededRand(key: string): () => number {
  return mulberry32(hashSeed(key));
}

export function freshDeck(): string[] {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

/** Fisher-Yates driven by the given stream. Does not mutate the input. */
export function shuffle<T>(cards: T[], rand: () => number): T[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function shuffledDeck(seed: string, handId: number): string[] {
  return shuffle(freshDeck(), seededRand(`${seed}:deck:${handId}`));
}
