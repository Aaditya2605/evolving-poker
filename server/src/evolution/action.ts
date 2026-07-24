import { z } from "zod";
import type {
  Action,
  Decision,
  DecisionContext,
  HandAction,
  PlayerState,
} from "../../../shared/types.js";
import { BLUFF_HS_CAP, decide as deterministicFallback } from "../engine/decide.js";
import { LlmRequestError, type LlmAdapter, type LlmResult } from "./pioneer.js";

const responseSchema = z.object({
  action: z.enum(["fold", "check", "call", "raise"]),
  reason: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1).optional(),
});

function legalActions(ctx: DecisionContext): Action[] {
  const actions: Action[] = ctx.toCall > 0 ? ["fold", "call"] : ["check"];
  if (ctx.canRaise) actions.push("raise");
  return actions;
}

function extractObject(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start === -1) throw new Error("no JSON object");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(raw.slice(start, i + 1));
  }
  throw new Error("incomplete JSON object");
}

export function buildActionPrompt(args: {
  player: PlayerState;
  ctx: DecisionContext;
  holeCards: string[];
  communityCards: string[];
  actions: HandAction[];
}): string {
  const { player, ctx, holeCards, communityCards, actions } = args;
  const legal = legalActions(ctx);
  const history =
    actions
      .map((a) => `${a.playerId} ${a.action}${a.amount ? ` ${a.amount}` : ""}`)
      .join(", ") || "(no actions yet)";

  return `You are ${player.name}, a persistent AI poker agent.
PERSONALITY: ${player.personality}

GAME: 4 players, 2 private cards, 3 shared cards, one betting round, fixed-size raises.
OBJECTIVE: maximize your chips across six hands. Outcomes are noisy.
HAND STRENGTH: 0.00 is weakest, 1.00 is strongest. Treat the supplied score as authoritative.

YOUR EVOLVING STRATEGY:
- aggression ${player.strategy.aggression.toFixed(2)}: preference for raising and pressure
- bluffRate ${player.strategy.bluffRate.toFixed(2)}: willingness to raise weak hands
- callThreshold ${player.strategy.callThreshold.toFixed(2)}: required strength to call

CURRENT TURN:
- hand: ${ctx.handId}
- your cards: ${holeCards.join(" ")}
- community: ${communityCards.join(" ")}
- hand strength: ${ctx.handStrength.toFixed(3)}
- chips: ${ctx.myChips}
- pot: ${ctx.potSize}
- cost to call: ${ctx.toCall}
- fixed raise increment: ${ctx.raiseAmount}
- public action history: ${history}
- legal actions: ${legal.join(", ")}

Choose the action yourself. Stay in character, but use the actual evidence.
Return ONLY JSON:
{"action":"${legal.join("|")}","reason":"one concise public sentence","confidence":0.0}`;
}

export async function decideWithAgent(args: {
  adapter: LlmAdapter;
  player: PlayerState;
  ctx: DecisionContext;
  holeCards: string[];
  communityCards: string[];
  actions: HandAction[];
  timeoutMs: number;
}): Promise<Decision> {
  const { adapter, player, ctx } = args;
  if (!adapter.act) return deterministicFallback(ctx, player.strategy);

  const prompt = buildActionPrompt(args);
  let result: LlmResult | null = null;
  try {
    result = await withTimeout(
      adapter.act(player.id, prompt, { handId: ctx.handId, model: player.model }),
      args.timeoutMs,
    );
    const parsed = responseSchema.parse(extractObject(result.raw));
    if (!legalActions(ctx).includes(parsed.action)) {
      throw new Error(`${parsed.action} is not legal in this state`);
    }
    return {
      action: parsed.action,
      amount: amountFor(parsed.action, ctx),
      isBluff: parsed.action === "raise" && ctx.handStrength < BLUFF_HS_CAP,
      agent: {
        model: player.model,
        servedModel: result.servedModel,
        inferenceId: result.inferenceId,
        reason: parsed.reason,
        confidence: parsed.confidence,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estCostUsd: result.estCostUsd,
        llmCalls: 1,
        status: "ok",
      },
    };
  } catch (error) {
    const timedOut = (error as Error).name === "TimeoutError";
    const action: Action = ctx.toCall === 0 ? "check" : "fold";
    return {
      action,
      amount: 0,
      isBluff: false,
      agent: {
        model: player.model,
        servedModel: result?.servedModel,
        inferenceId: result?.inferenceId,
        reason: `${timedOut ? "Timed out" : "Invalid agent output"}; mechanical fallback to ${action}.`,
        latencyMs:
          result?.latencyMs ??
          (error instanceof LlmRequestError ? error.latencyMs : timedOut ? args.timeoutMs : 0),
        inputTokens: result?.inputTokens ?? 0,
        outputTokens: result?.outputTokens ?? 0,
        estCostUsd: result?.estCostUsd ?? 0,
        llmCalls: 1,
        status: timedOut ? "timeout" : "invalid",
      },
    };
  }
}

function amountFor(action: Action, ctx: DecisionContext): number {
  if (action === "call") return Math.min(ctx.toCall, ctx.myChips);
  if (action === "raise") return Math.min(ctx.toCall + ctx.raiseAmount, ctx.myChips);
  return 0;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`timed out after ${ms}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
