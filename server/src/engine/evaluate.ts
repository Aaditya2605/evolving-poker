import pokersolver from "pokersolver";
import type { Hand } from "pokersolver";

// pokersolver ships CommonJS; this is the one place that unwraps it.
const { Hand: Solver } = pokersolver;

export type { Hand };

export interface Evaluated {
  hand: Hand;
  name: string;
  descr: string;
}

export function solve(cards: string[]): Hand {
  return Solver.solve(cards);
}

/** Best 5-card hand from 2 hole + 3 community. With exactly five cards there is
 *  only one combination, but the signature stays general. */
export function evaluate(hole: string[], community: string[]): Evaluated {
  const hand = solve([...hole, ...community]);
  return { hand, name: hand.name, descr: hand.descr };
}

/** Indices of the winning hand(s). More than one index means a tie. */
export function winnerIndices(hands: Hand[]): number[] {
  const winners = Solver.winners(hands);
  const out: number[] = [];
  for (let i = 0; i < hands.length; i++) {
    if (winners.indexOf(hands[i]) !== -1) out.push(i);
  }
  return out;
}

/** -1 / 0 / 1 comparison of two made hands. */
export function compareHands(a: Hand, b: Hand): number {
  const winners = Solver.winners([a, b]);
  const aWins = winners.indexOf(a) !== -1;
  const bWins = winners.indexOf(b) !== -1;
  if (aWins && bWins) return 0;
  return aWins ? 1 : -1;
}
