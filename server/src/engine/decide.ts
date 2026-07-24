import type { Decision, DecisionContext, Strategy } from "../../../shared/types.js";
import { seededRand } from "./deck.js";

// Tunable constants. Never change these mid-tournament — determinism depends on it.
const RAISE_BAR_BASE = 0.85;
const RAISE_BAR_AGGRO = 0.35; // valueRaiseBar = 0.85 - 0.35 * aggression
export const BLUFF_HS_CAP = 0.35; // "weak hand" ceiling
const CALL_BLEND_STRAT = 0.7;
const CALL_BLEND_ODDS = 0.5;

function raise(ctx: DecisionContext, isBluff: boolean): Decision {
  const amount = Math.min(ctx.toCall + ctx.raiseAmount, ctx.myChips);
  return { action: "raise", amount, isBluff };
}

/**
 * The entire poker brain. PURE: same context + same strategy ⇒ same decision.
 *
 * Deliberately does NOT see opponent statistics. If stats fed decisions,
 * behavior would drift with no strategy change and the core auditability claim
 * — a changed action traces back to a changed strategy — would be false.
 * Opponent stats reach the MODELS during reflection; models act by moving dials.
 */
export function decide(ctx: DecisionContext, s: Strategy): Decision {
  const r = seededRand(`${ctx.seed}:${ctx.handId}:${ctx.playerId}:${ctx.actionIndex}`);
  const valueRaiseBar = RAISE_BAR_BASE - RAISE_BAR_AGGRO * s.aggression;

  if (ctx.handStrength >= valueRaiseBar && ctx.canRaise) {
    return raise(ctx, false);
  }

  if (ctx.toCall === 0) {
    const bluffChance = s.bluffRate * (0.3 + 0.7 * s.aggression);
    if (ctx.handStrength < BLUFF_HS_CAP && ctx.canRaise && r() < bluffChance) {
      return raise(ctx, true);
    }
    return { action: "check", amount: 0, isBluff: false };
  }

  const potOdds = ctx.toCall / (ctx.potSize + ctx.toCall);
  const callBar = s.callThreshold * CALL_BLEND_STRAT + potOdds * CALL_BLEND_ODDS;
  if (ctx.handStrength >= callBar) {
    return { action: "call", amount: Math.min(ctx.toCall, ctx.myChips), isBluff: false };
  }

  if (
    ctx.canRaise &&
    ctx.handStrength < BLUFF_HS_CAP &&
    r() < s.bluffRate * s.aggression * 0.5
  ) {
    return raise(ctx, true); // rare bluff-raise over a bet
  }

  return { action: "fold", amount: 0, isBluff: false };
}
