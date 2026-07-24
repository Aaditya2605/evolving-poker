import type { ReflectionInput } from "../../../shared/types.js";
import { config } from "../config.js";

const n2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function strategyJson(s: { aggression: number; bluffRate: number; callThreshold: number }): string {
  return `{"aggression": ${n2(s.aggression)}, "bluffRate": ${n2(s.bluffRate)}, "callThreshold": ${n2(s.callThreshold)}}`;
}

/** Keeps the prompt bounded as the tournament runs long. */
const HISTORY_LIMIT = 6;

/**
 * Failed reflections are rendered, not hidden. Telling a model only about its
 * successes means it never learns that hand 3 came back unparseable — so it
 * emits the same shape again on hand 4 with nothing to correct against.
 */
function historyLine(h: ReflectionInput["evolutionHistory"][number]): string {
  const chips = `${h.chipsChangeSince >= 0 ? "+" : ""}${h.chipsChangeSince}`;
  switch (h.status) {
    case "applied":
      return `  hand ${h.hand}: ${strategyJson(h.strategy)} — "${h.reason}" (chips since: ${chips})`;
    case "no_change":
      return `  hand ${h.hand}: HELD — "${h.reason}". No change was made. (chips since: ${chips})`;
    case "timeout":
      return `  hand ${h.hand}: TIMED OUT. No change was made.`;
    default: {
      // The status word already says it was rejected; keep only the parser's
      // complaint, which is the part the model can actually act on.
      const detail = h.reason.replace(/^invalid response after retry\s*—\s*/, "");
      return `  hand ${h.hand}: RESPONSE REJECTED — ${detail}. No change was made.`;
    }
  }
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
      .slice(-HISTORY_LIMIT)
      .map(historyLine)
      .join("\n") || "  (this is your first reflection)";

  const yourActions =
    latestHand.myActions.map((a) => `${a.action}${a.amount ? ` ${a.amount}` : ""}`).join(", ") ||
    "took no action";

  const revealed = Object.entries(latestHand.revealed)
    .map(([id, r]) => `${id} showed ${r!.cards.join(" ")} (${r!.handName})`)
    .join("; ");

  return `You are the strategy coach for ${identity.name}, an AI poker player in a live 6-hand
tournament. Your current model: ${identity.model}. You control three dials, all 0.00-1.00:
aggression (raise frequency/thinness), bluffRate (weak-hand aggression),
callThreshold (min strength to call).
Your stable personality: ${identity.personality}

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

YOUR REFLECTION HISTORY (including responses that were rejected):
${historyLines}

You may also migrate your agent to a different Pioneer model for the next hand.
Allowed models: ${config.modelPool.join(", ")}.
Only switch when the observed reliability, latency, cost, or reasoning quality justifies it.
Set "nextModel" to one exact allowed ID, or omit it to keep ${identity.model}.

${closingBlock()}`;
}

/**
 * The ask, not the enforcement. `schema.ts` still validates shape and range
 * only — no step cap, no one-dial rule, no anti-reversal rule. This block
 * makes no-change a real option rather than a footnote, because a blank
 * three-dial object invites the model to fill in all three every hand.
 */
export const DEFAULT_CLOSING_BLOCK = `Decide whether to change your strategy.

One hand is a small sample. Most hands do not justify a change, and holding
steady on noise is a better answer than drifting. Answer no-change unless you
can point at something specific that happened.

If you do change, cite the hand in \`evidence\` — "hand-4", not a general poker
principle. If you cannot cite a hand, you do not have a reason.

Respond with ONLY this JSON (no markdown, no extra text):
{"change": <bool>, "strategy": {"aggression": <n>, "bluffRate": <n>,
"callThreshold": <n>}, "reason": "<=200 chars, public>",
 "evidence": ["hand-N", ...], "confidence": <n>, "nextModel": "<optional allowed model ID>"}`;

let override: string | null = null;

/** Only `npm run tune` calls this — it A/Bs wording without editing source. */
export function setClosingBlock(text: string | null): void {
  override = text;
}

function closingBlock(): string {
  return override ?? DEFAULT_CLOSING_BLOCK;
}

/** One retry only: the same prompt with the parser's complaint appended. */
export function withRetryHint(prompt: string, error: string): string {
  return `${prompt}

YOUR PREVIOUS RESPONSE WAS REJECTED: ${error}
Return ONLY the raw JSON object. No prose, no markdown fences.`;
}
