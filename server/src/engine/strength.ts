import type { Hand } from "pokersolver";
import { freshDeck, seededRand, shuffle } from "./deck.js";
import { compareHands, solve } from "./evaluate.js";

export interface StrengthOptions {
  /** Omit for exact enumeration of all C(47,2)=1081 opponent holdings.
   *  Supply a number to Monte-Carlo instead (used by find-seed for speed). */
  samples?: number;
  /** Required when `samples` is set — keeps sampling deterministic. */
  rngKey?: string;
}

const cache = new Map<string, number>();

/**
 * handStrength ∈ [0,1]: the fraction of possible opponent holdings this player
 * beats, given the visible board. Ties count as half. Exact by default — the
 * search space is only 1081 hands, so there is no reason to approximate.
 */
export function handStrength(
  hole: string[],
  community: string[],
  opts: StrengthOptions = {},
): number {
  const key = `${hole.slice().sort().join("")}|${community.slice().sort().join("")}|${opts.samples ?? "exact"}|${opts.rngKey ?? ""}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const known = new Set([...hole, ...community]);
  const remaining = freshDeck().filter((c) => !known.has(c));
  const mine: Hand = solve([...hole, ...community]);

  let score = 0;
  let total = 0;

  const consider = (a: string, b: string) => {
    const theirs = solve([a, b, ...community]);
    const cmp = compareHands(mine, theirs);
    score += cmp > 0 ? 1 : cmp === 0 ? 0.5 : 0;
    total += 1;
  };

  if (opts.samples === undefined) {
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        consider(remaining[i], remaining[j]);
      }
    }
  } else {
    const rand = seededRand(opts.rngKey ?? "strength");
    for (let s = 0; s < opts.samples; s++) {
      const pick = shuffle(remaining, rand);
      consider(pick[0], pick[1]);
    }
  }

  const result = total === 0 ? 0 : score / total;
  cache.set(key, result);
  return result;
}

export function clearStrengthCache(): void {
  cache.clear();
}
