import type { ReflectionInput } from "../../../shared/types.js";

const n2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function strategyJson(s: { aggression: number; bluffRate: number; callThreshold: number }): string {
  return `{"aggression": ${n2(s.aggression)}, "bluffRate": ${n2(s.bluffRate)}, "callThreshold": ${n2(s.callThreshold)}}`;
}

function handSummary(input: ReflectionInput): string {
  const h = input.latestHand;
  const board = h.communityCards.join(" ");
  const opp = h.opponentActions
    .map((a) => `${a.playerId} ${a.action}${a.amount ? ` ${a.amount}` : ""}`)
    .join(", ");
  return `board ${board}; your cards ${h.myCards.join(" ")}; opponents: ${opp || "no action"}`;
}

function bluffLine(input: ReflectionInput): string {
  const b = input.latestHand.bluffOutcome;
  if (!b || !b.attempted) return "you did not bluff";
  return b.succeeded
    ? "you bluffed and took the pot uncontested"
    : "you bluffed and it did not take the pot";
}

function cumulativeLine(c: ReflectionInput["cumulative"]): string {
  return [
    `${c.handsWon}/${c.handsPlayed} hands won`,
    `net ${c.netChips >= 0 ? "+" : ""}${c.netChips}`,
    `fold ${pct(c.foldRate)}`,
    `call ${pct(c.callRate)}`,
    `raise ${pct(c.raiseRate)}`,
    `bluffs ${c.bluffsSuccessful}/${c.bluffsAttempted}`,
    `showdowns won ${c.showdownsWon}/${c.showdownsReached}`,
  ].join(", ");
}

export function buildReflectionPrompt(input: ReflectionInput): string {
  const { identity, latestHand, cumulative } = input;

  const opponentLines =
    Object.entries(input.opponents)
      .map(
        ([id, o]) =>
          `  ${id}: foldToRaise ${pct(o.foldToRaiseRate)}, call ${pct(o.callRate)}, raise ${pct(o.raiseRate)}, showdowns won ${o.showdownsWon}`,
      )
      .join("\n") || "  (none yet)";

  const historyLines =
    input.evolutionHistory
      .map(
        (h) =>
          `  hand ${h.hand}: ${strategyJson(h.strategy)} — "${h.reason}" (chips since: ${h.chipsChangeSince >= 0 ? "+" : ""}${h.chipsChangeSince})`,
      )
      .join("\n") || "  (this is your first reflection)";

  const yourActions =
    latestHand.myActions.map((a) => `${a.action}${a.amount ? ` ${a.amount}` : ""}`).join(", ") ||
    "took no action";

  const revealed = Object.entries(latestHand.revealed)
    .map(([id, r]) => `${id} showed ${r!.cards.join(" ")} (${r!.handName})`)
    .join("; ");

  return `You are the strategy coach for ${identity.name}, an AI poker player in a live 6-hand
tournament. Your model: ${identity.model}. You control three dials, all 0.00-1.00:
aggression (raise frequency/thinness), bluffRate (weak-hand aggression),
callThreshold (min strength to call).

CURRENT STRATEGY: ${strategyJson(identity.strategy)}
CHIPS: ${identity.chips} (net ${cumulative.netChips >= 0 ? "+" : ""}${cumulative.netChips} over ${cumulative.handsPlayed} hands)

LATEST HAND (hand-${latestHand.handId}): ${handSummary(input)}
  - your hand strength was ${n2(latestHand.myHandStrength)}; you ${yourActions}; ${bluffLine(input)}
  - result: ${latestHand.chipDelta >= 0 ? "+" : ""}${latestHand.chipDelta} chips; winner: ${latestHand.winner}${
    latestHand.wentToShowdown ? `; showdown — ${revealed}` : "; no showdown"
  }

CUMULATIVE: ${cumulativeLine(cumulative)}
OPPONENTS (public behavior only):
${opponentLines}

YOUR PREVIOUS UPDATES:
${historyLines}

Decide whether to change your strategy. One noisy hand may be luck; you may
answer no-change. If you change, choose the new values yourself.
Respond with ONLY this JSON (no markdown, no extra text):
{"change": <bool>, "strategy": {"aggression": <n>, "bluffRate": <n>,
"callThreshold": <n>}, "reason": "<=200 chars, public>", "evidence":
["hand-N", ...], "confidence": <n>}`;
}

/** One retry only: the same prompt with the parser's complaint appended. */
export function withRetryHint(prompt: string, error: string): string {
  return `${prompt}

YOUR PREVIOUS RESPONSE WAS REJECTED: ${error}
Return ONLY the raw JSON object. No prose, no markdown fences.`;
}
