import type { TournamentEvent } from "../../shared/types.js";
import { BLUFF_HS_CAP } from "./engine/decide.js";
import { annotateToCall } from "./engine/metrics.js";
import { runTournament } from "./engine/tournament.js";
import { initialPlayers } from "./config.js";
import { NEUTRAL_STRATEGY } from "../../shared/types.js";

export interface SeedScore {
  seed: string;
  score: number;
  earlyBluffOpportunities: number;
  bluffsThrown: number;
  similarSpots: number;
  earlyShowdowns: number;
  distinctWinners: number;
  minChips: number;
  meetsAllCriteria: boolean;
  notes: string[];
}

/**
 * Demo quality is otherwise left to luck. With strategies frozen at neutral we
 * can score a seed for the three beats the demo needs:
 *   1. an early bluff opportunity (so "it bluffed" lands in the first minute),
 *   2. two similar strength+pot spots far apart (so "same spot, different
 *      action, because the dial moved" is actually visible),
 *   3. a showdown inside the first three hands (so cards get revealed early).
 */
export async function scoreSeed(seed: string, samples?: number): Promise<SeedScore> {
  const result = await runTournament({
    seed,
    reflections: false,
    players: initialPlayers(NEUTRAL_STRATEGY),
    strengthOptions: samples !== undefined ? { samples } : undefined,
  });

  const hands = result.events.filter(
    (e): e is Extract<TournamentEvent, { type: "hand_end" }> => e.type === "hand_end",
  );

  let earlyBluffOpportunities = 0;
  let bluffsThrown = 0;
  let earlyShowdowns = 0;
  const spots: { handId: number; playerId: string; hs: number; pot: number }[] = [];

  for (const h of hands) {
    const r = h.record;
    const early = r.handId <= 3;
    if (early && r.showdown.length > 0) earlyShowdowns++;

    for (const a of annotateToCall(r.actions)) {
      const hs = r.handStrength[a.playerId];
      if (a.toCall === 0 && hs < BLUFF_HS_CAP && early) earlyBluffOpportunities++;
      if (a.isBluff) bluffsThrown++;
      spots.push({ handId: r.handId, playerId: a.playerId, hs, pot: a.potAfter });
    }
  }

  let similarSpots = 0;
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i];
      const b = spots[j];
      if (a.playerId !== b.playerId) continue;
      if (b.handId - a.handId < 2) continue;
      if (Math.abs(a.hs - b.hs) < 0.08 && Math.abs(a.pot - b.pot) <= 30) similarSpots++;
    }
  }

  const winners = new Set(hands.map((h) => h.record.winner));
  const minChips = Math.min(...result.players.map((p) => p.chips));

  const notes: string[] = [];
  if (earlyBluffOpportunities === 0) notes.push("no early bluff opportunity");
  if (similarSpots < 2) notes.push("fewer than 2 comparable spots");
  if (earlyShowdowns === 0) notes.push("no showdown in first 3 hands");

  const meetsAllCriteria =
    earlyBluffOpportunities >= 1 && similarSpots >= 2 && earlyShowdowns >= 1;

  const score =
    Math.min(earlyBluffOpportunities, 4) * 2 +
    Math.min(similarSpots, 6) * 3 +
    earlyShowdowns * 4 +
    (winners.size - 1) * 5 +
    Math.min(bluffsThrown, 3) * 2 +
    (minChips > 700 ? 4 : 0) +
    (meetsAllCriteria ? 15 : 0);

  return {
    seed,
    score,
    earlyBluffOpportunities,
    bluffsThrown,
    similarSpots,
    earlyShowdowns,
    distinctWinners: winners.size,
    minChips,
    meetsAllCriteria,
    notes,
  };
}

export async function findSeeds(limit = 500, samples?: number): Promise<SeedScore[]> {
  const scores: SeedScore[] = [];
  for (let i = 1; i <= limit; i++) {
    scores.push(await scoreSeed(String(i), samples));
    if (i % 25 === 0) process.stderr.write(`  scanned ${i}/${limit}\n`);
  }
  return scores.sort((a, b) => b.score - a.score);
}
