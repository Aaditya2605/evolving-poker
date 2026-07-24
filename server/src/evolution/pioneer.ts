import type { PlayerId, ReflectionInput, Strategy } from "../../../shared/types.js";
import { seededRand } from "../engine/deck.js";
import { config, REFLECT_TIMEOUT_MS } from "../config.js";

export interface LlmResult {
  raw: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  servedModel?: string;
  inferenceId?: string;
}

export interface ReflectMeta {
  handId: number;
  input: ReflectionInput;
}

export interface LlmAdapter {
  readonly mode: string;
  reflect(playerId: PlayerId, prompt: string, meta: ReflectMeta): Promise<LlmResult>;
  act?(
    playerId: PlayerId,
    prompt: string,
    meta: { handId: number; model: string },
  ): Promise<LlmResult>;
}

export class LlmTimeoutError extends Error {
  constructor(public latencyMs: number) {
    super("reflection timed out");
    this.name = "LlmTimeoutError";
  }
}

export class LlmRequestError extends Error {
  constructor(
    message: string,
    public latencyMs: number,
  ) {
    super(message);
    this.name = "LlmRequestError";
  }
}

// --- pricing ---------------------------------------------------------------

const DEFAULT_PRICING: Record<string, { in: number; out: number }> = {
  "Qwen/Qwen3-4B-Instruct-2507": { in: 0.0002, out: 0.0006 },
  "openai/gpt-oss-20b": { in: 0.0005, out: 0.0015 },
  "deepseek-ai/DeepSeek-V3": { in: 0.0009, out: 0.0018 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = DEFAULT_PRICING[model] ?? { in: 0.0005, out: 0.0015 };
  return Number(((inputTokens / 1000) * p.in + (outputTokens / 1000) * p.out).toFixed(6));
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

// --- mock ------------------------------------------------------------------

const clamp = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
const RETRY_MARKER = "YOUR PREVIOUS RESPONSE WAS REJECTED";

const BASE_LATENCY: Record<PlayerId, number> = {
  playerA: 620,
  playerB: 1150,
  playerC: 1780,
};

/**
 * Deterministic scripted personas. Zero network, zero keys.
 *
 * playerA — eager updater: revises nearly every hand.
 * playerB — conservative: mostly holds, one timeout at hand 5.
 * playerC — oscillator: swings a dial hard and reverses it, malformed at hand 3.
 *
 * The one malformed response and one timeout are deliberate: the failure paths
 * must be visible on the UI during the demo, not hypothetical.
 */
export class MockAdapter implements LlmAdapter {
  readonly mode = "mock";

  /** 1 = real-time pacing (good for demos/fixtures), 0 = instant (tests). */
  constructor(private latencyScale = 1) {}

  async reflect(playerId: PlayerId, prompt: string, meta: ReflectMeta): Promise<LlmResult> {
    const { handId, input } = meta;
    const isRetry = prompt.includes(RETRY_MARKER);
    const jitter = seededRand(`mock:${playerId}:${handId}`)();
    const latencyMs = Math.round(BASE_LATENCY[playerId] * (0.75 + 0.5 * jitter));

    if (playerId === "playerB" && handId === 5) {
      await this.sleep(400);
      throw new LlmTimeoutError(REFLECT_TIMEOUT_MS);
    }

    await this.sleep(latencyMs);

    const raw =
      playerId === "playerC" && handId === 3
        ? // Malformed on both attempts — the retry path must be exercised too.
          isRetry
          ? 'Sure! Here is the strategy update:\n{"change": true, "strategy": {"aggression": 0.9, "bluffRate": }}'
          : "I think I should play more aggressively because the board was dry and BOREAS folded a lot."
        : JSON.stringify(this.script(playerId, handId, input));

    const inputTokens = approxTokens(prompt);
    const outputTokens = approxTokens(raw);
    return {
      raw,
      latencyMs,
      inputTokens,
      outputTokens,
      estCostUsd: estimateCost(config.models[playerId], inputTokens, outputTokens),
    };
  }

  private sleep(ms: number): Promise<void> {
    const scaled = Math.round(ms * this.latencyScale);
    if (scaled <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, scaled));
  }

  private script(playerId: PlayerId, handId: number, input: ReflectionInput) {
    const s = input.identity.strategy;
    const lost = input.latestHand.chipDelta < 0;
    const evidence = handId > 1 ? [`hand-${handId - 1}`, `hand-${handId}`] : [`hand-${handId}`];
    const opponents = Object.entries(input.opponents);
    const foldiest = opponents.slice().sort((a, b) => b[1].foldToRaiseRate - a[1].foldToRaiseRate)[0];

    if (playerId === "playerA") {
      if (handId === 4) {
        return {
          change: false,
          reason: `One losing hand on hand-${handId} is noise, not signal. Holding the dials I set after hand-3.`,
          evidence,
          confidence: 0.55,
        };
      }
      const next: Strategy = lost
        ? {
            aggression: clamp(s.aggression - 0.12),
            bluffRate: clamp(s.bluffRate - 0.05),
            callThreshold: clamp(s.callThreshold + 0.1),
          }
        : {
            aggression: clamp(s.aggression + 0.1),
            bluffRate: clamp(s.bluffRate + 0.06),
            callThreshold: clamp(s.callThreshold - 0.05),
          };
      return {
        change: true,
        strategy: next,
        reason: lost
          ? `Dropped ${Math.abs(input.latestHand.chipDelta)} on hand-${handId} paying off a bet. Tightening: less aggression, higher call bar.`
          : `Hand-${handId} rewarded pressure. Nudging aggression and bluffRate up, call bar down.`,
        evidence,
        confidence: 0.68,
      };
    }

    if (playerId === "playerB") {
      if (handId === 3) {
        return {
          change: true,
          strategy: {
            aggression: clamp(s.aggression + 0.08),
            bluffRate: s.bluffRate,
            callThreshold: clamp(s.callThreshold - 0.07),
          },
          reason: `Three hands of evidence now: ${foldiest?.[0] ?? "the table"} folds often. Small, single-direction adjustment only.`,
          evidence: ["hand-1", "hand-2", "hand-3"],
          confidence: 0.61,
        };
      }
      return {
        change: false,
        reason: `Hand-${handId} outcome is within variance for a ${input.cumulative.handsPlayed}-hand sample. Holding.`,
        evidence,
        confidence: 0.72,
      };
    }

    // playerC — oscillator
    const swingUp = handId % 2 === 1;
    const next: Strategy = swingUp
      ? { aggression: 0.85, bluffRate: clamp(s.bluffRate + 0.25), callThreshold: 0.25 }
      : { aggression: 0.25, bluffRate: clamp(s.bluffRate - 0.25), callThreshold: 0.7 };
    return {
      change: true,
      strategy: next,
      reason: swingUp
        ? `Hand-${handId} showed the table folding to pressure. Going maximally aggressive.`
        : `Hand-${handId} punished the aggression I added. Reversing hard to a tight, high-call-bar profile.`,
      evidence,
      confidence: swingUp ? 0.8 : 0.45,
    };
  }
}

// --- real Pioneer ----------------------------------------------------------

/**
 * OpenAI-compatible chat-completions. If Pioneer's real API shape differs at the
 * event, THIS FILE is the only one that changes.
 */
export class PioneerAdapter implements LlmAdapter {
  readonly mode = "real";

  async reflect(_playerId: PlayerId, prompt: string, meta: ReflectMeta): Promise<LlmResult> {
    return this.complete(meta.input.identity.model, prompt, 220, 0.3);
  }

  async act(
    _playerId: PlayerId,
    prompt: string,
    meta: { handId: number; model: string },
  ): Promise<LlmResult> {
    return this.complete(meta.model, prompt, 120, 0.2);
  }

  private async complete(
    model: string,
    prompt: string,
    maxTokens: number,
    temperature: number,
  ): Promise<LlmResult> {
    const started = Date.now();

    const res = await fetch("https://api.pioneer.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.pioneerApiKey,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        // Stored inference traffic is the input to Pioneer's evaluation,
        // clustering, and Adaptive Inference pipeline.
        store: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const latencyMs = Date.now() - started;
    if (!res.ok) {
      throw new LlmRequestError(
        `Pioneer ${res.status}: ${(await res.text()).slice(0, 240)}`,
        latencyMs,
      );
    }

    const body = (await res.json()) as {
      id?: string;
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const inputTokens = body.usage?.prompt_tokens ?? approxTokens(prompt);
    const outputTokens = body.usage?.completion_tokens ?? approxTokens(raw);

    return {
      raw,
      latencyMs,
      inputTokens,
      outputTokens,
      estCostUsd: estimateCost(model, inputTokens, outputTokens),
      servedModel: body.model,
      inferenceId: body.id,
    };
  }
}

export function createAdapter(latencyScale = 1): LlmAdapter {
  if (config.pioneerMode === "real") {
    if (!config.pioneerApiKey) {
      throw new Error(
        "PIONEER_MODE=real requires PIONEER_API_KEY. Use fixture replay for an offline demo.",
      );
    }
    return new PioneerAdapter();
  }
  return new MockAdapter(latencyScale);
}
