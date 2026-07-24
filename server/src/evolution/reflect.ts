import type {
  EvolutionEvent,
  HandRecord,
  PlayerId,
  PlayerState,
  ReflectionInput,
  ReflectionOutput,
  Strategy,
} from "../../../shared/types.js";
import { PLAYER_IDS } from "../../../shared/types.js";
import type { MetricsTracker } from "../engine/metrics.js";
import { REFLECT_TIMEOUT_MS } from "../config.js";
import { LlmTimeoutError, type LlmAdapter } from "./pioneer.js";
import { buildReflectionPrompt, withRetryHint } from "./prompt.js";
import { parseReflection } from "./schema.js";

export interface CapturedReflection {
  handId: number;
  playerId: PlayerId;
  model: string;
  prompt: string;
  raw: string;
  parsed: ReflectionOutput | null;
  status: EvolutionEvent["status"];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  llmCalls: number;
  repairs: string[];
}

export interface ReflectAllArgs {
  handId: number;
  players: PlayerState[];
  record: HandRecord;
  tracker: MetricsTracker;
  adapter: LlmAdapter;
  /** chips at the end of each hand, for "chips since this update" in history. */
  chipsAtHandEnd: Map<number, Record<PlayerId, number>>;
  timeoutMs?: number;
  onCapture?: (c: CapturedReflection) => void;
}

const sameStrategy = (a: Strategy, b: Strategy) =>
  a.aggression === b.aggression && a.bluffRate === b.bluffRate && a.callThreshold === b.callThreshold;

export function buildReflectionInput(
  player: PlayerState,
  record: HandRecord,
  tracker: MetricsTracker,
  chipsAtHandEnd: Map<number, Record<PlayerId, number>>,
): ReflectionInput {
  const id = player.id;
  const mine = record.actions.filter((a) => a.playerId === id);
  const bluffed = mine.some((a) => a.isBluff);
  const wentToShowdown = record.showdown.length > 0;

  const revealed: ReflectionInput["latestHand"]["revealed"] = {};
  for (const sid of record.showdown) {
    revealed[sid] = {
      cards: record.holeCards[sid],
      handName: record.handNames[sid] ?? "unknown",
    };
  }

  const opponents: ReflectionInput["opponents"] = {};
  for (const other of PLAYER_IDS) {
    if (other !== id) opponents[other] = tracker.opponentBehavior(other);
  }

  return {
    identity: {
      name: player.name,
      model: player.model,
      chips: player.chips,
      strategy: { ...player.strategy },
    },
    latestHand: {
      handId: record.handId,
      communityCards: record.communityCards,
      myCards: record.holeCards[id],
      myHandStrength: Number(record.handStrength[id].toFixed(3)),
      myActions: mine.map((a) => ({ action: a.action, amount: a.amount })),
      // PUBLIC only. Opponent hole cards never leak before showdown.
      opponentActions: record.actions
        .filter((a) => a.playerId !== id)
        .map((a) => ({ playerId: a.playerId, action: a.action, amount: a.amount })),
      bluffOutcome: bluffed
        ? { attempted: true, succeeded: !wentToShowdown && record.winners.includes(id) }
        : null,
      chipDelta: record.chipDeltas[id],
      winner: record.winner,
      wentToShowdown,
      revealed,
    },
    cumulative: tracker.cumulativeFor(id),
    opponents,
    // Failures included, marked. See ReflectionInput.evolutionHistory.
    evolutionHistory: player.strategyHistory.map((e) => ({
      hand: e.handId,
      status: e.status,
      strategy: e.after,
      reason: e.reason,
      chipsChangeSince: player.chips - (chipsAtHandEnd.get(e.handId)?.[id] ?? player.chips),
    })),
  };
}

/** Runs all three reflections concurrently. Never throws, never stalls. */
export async function reflectAll(args: ReflectAllArgs): Promise<EvolutionEvent[]> {
  const { handId, players, record, tracker, adapter, chipsAtHandEnd, onCapture } = args;
  const timeoutMs = args.timeoutMs ?? REFLECT_TIMEOUT_MS;

  const settled = await Promise.allSettled(
    players.map((p) =>
      reflectOne(p, handId, record, tracker, adapter, chipsAtHandEnd, timeoutMs, onCapture),
    ),
  );

  return settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const p = players[i];
    return failureEvent(p, handId, "invalid", `unexpected error: ${String(r.reason)}`, 0, false);
  });
}

async function reflectOne(
  player: PlayerState,
  handId: number,
  record: HandRecord,
  tracker: MetricsTracker,
  adapter: LlmAdapter,
  chipsAtHandEnd: Map<number, Record<PlayerId, number>>,
  timeoutMs: number,
  onCapture?: (c: CapturedReflection) => void,
): Promise<EvolutionEvent> {
  const before: Strategy = { ...player.strategy };
  const input = buildReflectionInput(player, record, tracker, chipsAtHandEnd);
  let prompt = buildReflectionPrompt(input);

  let retried = false;
  let lastRaw = "";
  let usage = { latencyMs: 0, inputTokens: 0, outputTokens: 0, estCostUsd: 0, llmCalls: 0 };
  const repairs: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    // Counted before the await: a call that times out still cost us a call.
    usage.llmCalls += 1;
    try {
      result = await withTimeout(
        adapter.reflect(player.id, prompt, { handId, input }),
        timeoutMs,
      );
    } catch (e) {
      const latencyMs = e instanceof LlmTimeoutError ? e.latencyMs : timeoutMs;
      const isTimeout = e instanceof LlmTimeoutError || (e as Error).name === "TimeoutError";
      const ev = failureEvent(
        player,
        handId,
        isTimeout ? "timeout" : "invalid",
        isTimeout
          ? `no response within ${Math.round(timeoutMs / 1000)}s — strategy left untouched`
          : `adapter error: ${(e as Error).message}`,
        latencyMs,
        retried,
        usage.llmCalls,
        repairs,
      );
      onCapture?.(capture(player, handId, prompt, lastRaw, null, ev));
      return ev;
    }

    lastRaw = result.raw;
    usage = {
      latencyMs: usage.latencyMs + result.latencyMs,
      inputTokens: usage.inputTokens + result.inputTokens,
      outputTokens: usage.outputTokens + result.outputTokens,
      estCostUsd: Number((usage.estCostUsd + result.estCostUsd).toFixed(6)),
      llmCalls: usage.llmCalls,
    };

    const parsed = parseReflection(result.raw);
    repairs.push(...parsed.repairs);
    if (parsed.ok && parsed.value) {
      const ev = applyReflection(
        player,
        handId,
        before,
        parsed.value,
        usage,
        retried,
        result.raw,
        repairs,
      );
      onCapture?.(capture(player, handId, prompt, result.raw, parsed.value, ev));
      return ev;
    }

    if (attempt === 0) {
      retried = true;
      prompt = withRetryHint(prompt, parsed.error ?? "unparseable");
      continue;
    }

    const ev: EvolutionEvent = {
      handId,
      playerId: player.id,
      model: player.model,
      before,
      after: before,
      changed: false,
      reason: `invalid response after retry — ${parsed.error}`,
      evidence: [],
      ...usage,
      repairs,
      status: "invalid",
      retried,
      rawResponse: result.raw.slice(0, 500),
    };
    player.strategyHistory.push(ev);
    onCapture?.(capture(player, handId, prompt, result.raw, null, ev));
    return ev;
  }

  return failureEvent(
    player,
    handId,
    "invalid",
    "exhausted attempts",
    usage.latencyMs,
    retried,
    usage.llmCalls,
    repairs,
  );
}

function applyReflection(
  player: PlayerState,
  handId: number,
  before: Strategy,
  out: ReflectionOutput,
  usage: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    estCostUsd: number;
    llmCalls: number;
  },
  retried: boolean,
  raw: string,
  repairs: string[],
): EvolutionEvent {
  const wantsChange = out.change && !!out.strategy;
  const after: Strategy = wantsChange ? { ...out.strategy! } : before;
  const changed = wantsChange && !sameStrategy(before, after);

  if (changed) player.strategy = { ...after };

  const ev: EvolutionEvent = {
    handId,
    playerId: player.id,
    model: player.model,
    before,
    after: changed ? after : before,
    changed,
    reason: out.reason,
    evidence: out.evidence,
    confidence: out.confidence,
    ...usage,
    repairs,
    status: changed ? "applied" : "no_change",
    retried,
    rawResponse: raw.slice(0, 500),
  };
  player.strategyHistory.push(ev);
  return ev;
}

function failureEvent(
  player: PlayerState,
  handId: number,
  status: "invalid" | "timeout",
  reason: string,
  latencyMs: number,
  retried: boolean,
  llmCalls = 1,
  repairs: string[] = [],
): EvolutionEvent {
  const before: Strategy = { ...player.strategy };
  const ev: EvolutionEvent = {
    handId,
    playerId: player.id,
    model: player.model,
    before,
    after: before,
    changed: false,
    reason,
    evidence: [],
    latencyMs,
    inputTokens: 0,
    outputTokens: 0,
    estCostUsd: 0,
    llmCalls,
    repairs,
    status,
    retried,
  };
  player.strategyHistory.push(ev);
  return ev;
}

function capture(
  player: PlayerState,
  handId: number,
  prompt: string,
  raw: string,
  parsed: ReflectionOutput | null,
  ev: EvolutionEvent,
): CapturedReflection {
  return {
    handId,
    playerId: player.id,
    model: player.model,
    prompt,
    raw,
    parsed,
    status: ev.status,
    latencyMs: ev.latencyMs,
    inputTokens: ev.inputTokens,
    outputTokens: ev.outputTokens,
    estCostUsd: ev.estCostUsd,
    llmCalls: ev.llmCalls,
    repairs: ev.repairs,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`timed out after ${ms}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
