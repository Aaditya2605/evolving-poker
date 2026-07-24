import { describe, expect, it } from "vitest";
import type { PlayerId, Strategy } from "../../shared/types.js";
import { PLAYER_IDS } from "../../shared/types.js";
import { parseReflection } from "../src/evolution/schema.js";
import { countOscillations } from "../src/engine/metrics.js";
import { runTournament } from "../src/engine/tournament.js";
import { initialPlayers } from "../src/config.js";
import { MockAdapter, type LlmAdapter } from "../src/evolution/pioneer.js";
import { buildReflectionPrompt } from "../src/evolution/prompt.js";

const neutral: Strategy = { aggression: 0.5, bluffRate: 0.2, callThreshold: 0.5 };

/** Feeds a fixed script of raw responses, in order, per player. */
class ScriptedAdapter implements LlmAdapter {
  readonly mode = "scripted";
  private calls = 0;
  constructor(private responses: string[]) {}
  async reflect() {
    const raw = this.responses[Math.min(this.calls++, this.responses.length - 1)];
    return { raw, latencyMs: 5, inputTokens: 100, outputTokens: 20, estCostUsd: 0.0001 };
  }
}

describe("4. reflection schema", () => {
  it("accepts a well-formed change", () => {
    const r = parseReflection(
      '{"change":true,"strategy":{"aggression":0.7,"bluffRate":0.3,"callThreshold":0.4},"reason":"ok","evidence":["hand-1"],"confidence":0.6}',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.strategy?.aggression).toBe(0.7);
  });

  it("strips markdown fences and surrounding prose", () => {
    const r = parseReflection(
      'Sure:\n```json\n{"change":false,"reason":"holding","evidence":[]}\n```\nHope that helps!',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.change).toBe(false);
  });

  it("rejects malformed JSON", () => {
    expect(parseReflection("not json at all").ok).toBe(false);
    expect(parseReflection('{"change": true, "strategy": {').ok).toBe(false);
  });

  it("rejects out-of-range dials", () => {
    const r = parseReflection(
      '{"change":true,"strategy":{"aggression":1.4,"bluffRate":0.3,"callThreshold":0.4},"reason":"x","evidence":[]}',
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("aggression");
  });

  it("rejects change=true with no strategy", () => {
    const r = parseReflection('{"change":true,"reason":"x","evidence":[]}');
    expect(r.ok).toBe(false);
    expect(r.error).toContain("strategy required");
  });

  it("imposes NO strategic guardrails — a full-range swing is valid", () => {
    const r = parseReflection(
      '{"change":true,"strategy":{"aggression":1,"bluffRate":1,"callThreshold":0},"reason":"all in on chaos","evidence":["hand-1"]}',
    );
    expect(r.ok).toBe(true);
  });

  it("applies a valid update and leaves strategy untouched on change=false", async () => {
    const change =
      '{"change":true,"strategy":{"aggression":0.9,"bluffRate":0.1,"callThreshold":0.2},"reason":"pressure works","evidence":["hand-1"]}';
    const applied = await runTournament({
      seed: "apply",
      totalHands: 1,
      players: initialPlayers(neutral),
      adapter: new ScriptedAdapter([change]),
      timeoutMs: 1000,
    });
    for (const p of applied.players) {
      expect(p.strategy).toEqual({ aggression: 0.9, bluffRate: 0.1, callThreshold: 0.2 });
    }

    const held = await runTournament({
      seed: "apply",
      totalHands: 1,
      players: initialPlayers(neutral),
      adapter: new ScriptedAdapter(['{"change":false,"reason":"noise","evidence":["hand-1"]}']),
      timeoutMs: 1000,
    });
    for (const p of held.players) expect(p.strategy).toEqual(neutral);
    expect(held.standings.snapshot.evolution.playerA.noChanges).toBe(1);
  });

  it("marks a doubly-malformed response invalid, retries once, and continues", async () => {
    const result = await runTournament({
      seed: "invalid",
      totalHands: 1,
      players: initialPlayers(neutral),
      adapter: new ScriptedAdapter(["garbage", "still garbage"]),
      timeoutMs: 1000,
    });
    for (const id of PLAYER_IDS) {
      const evo = result.standings.snapshot.evolution[id];
      expect(evo.invalid).toBe(1);
      expect(result.players.find((p) => p.id === id)!.strategy).toEqual(neutral);
    }
    const ev = result.events.find((e) => e.type === "evolution");
    expect(ev && ev.type === "evolution" && ev.event.retried).toBe(true);
  });

  it("treats a hanging model as a timeout without stalling the tournament", async () => {
    const stalling: LlmAdapter = {
      mode: "stalling",
      reflect: () => new Promise(() => {}),
    };
    const result = await runTournament({
      seed: "timeout",
      totalHands: 1,
      players: initialPlayers(neutral),
      adapter: stalling,
      timeoutMs: 60,
    });
    for (const id of PLAYER_IDS) {
      expect(result.standings.snapshot.evolution[id].timeouts).toBe(1);
      expect(result.players.find((p) => p.id === id)!.strategy).toEqual(neutral);
    }
    expect(result.standings.ranking).toHaveLength(3);
  });
});

describe("6. oscillation counter", () => {
  it("fires on the 0.30 → 0.80 → 0.20 pattern", () => {
    expect(countOscillations([0.5, -0.6])).toBe(1);
  });

  it("ignores movement below the threshold", () => {
    expect(countOscillations([0.1, -0.1])).toBe(0);
    expect(countOscillations([0.5, -0.05])).toBe(0);
  });

  it("ignores a reversal that arrives too late", () => {
    expect(countOscillations([0.5, 0, 0, -0.6])).toBe(0);
  });

  it("counts a chain of reversals", () => {
    expect(countOscillations([0.5, -0.6, 0.5, -0.6])).toBe(3);
  });

  it("counts zero for monotone drift", () => {
    expect(countOscillations([0.2, 0.2, 0.2, 0.2])).toBe(0);
  });
});

describe("mock personas", () => {
  it("produce the scripted failure paths and a visibly different policy per model", async () => {
    const result = await runTournament({
      seed: "sf2026",
      players: initialPlayers(neutral),
      adapter: new MockAdapter(0),
      timeoutMs: 5000,
    });

    const evo = result.standings.snapshot.evolution;
    expect(result.standings.snapshot.totals.llmCalls).toBe(18);
    expect(evo.playerB.timeouts).toBe(1);
    expect(evo.playerC.invalid).toBe(1);

    // Three distinct self-modification policies is the whole demo.
    expect(evo.playerA.changesApplied).toBeGreaterThan(evo.playerB.changesApplied);
    expect(evo.playerB.noChanges).toBeGreaterThan(evo.playerA.noChanges);
    expect(evo.playerC.oscillations).toBeGreaterThan(0);
  });

  it("cites only real hand ids in its reasons", async () => {
    const result = await runTournament({
      seed: "sf2026",
      players: initialPlayers(neutral),
      adapter: new MockAdapter(0),
      timeoutMs: 5000,
    });
    for (const e of result.events) {
      if (e.type !== "evolution") continue;
      for (const cite of e.event.evidence) {
        const n = Number(cite.replace("hand-", ""));
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(e.event.handId);
      }
    }
  });
});

describe("reflection input", () => {
  it("never leaks opponent hole cards before showdown", async () => {
    const result = await runTournament({
      seed: "leak",
      players: initialPlayers(neutral),
      adapter: new MockAdapter(0),
      timeoutMs: 5000,
    });

    for (const r of result.reflections) {
      const self = r.playerId as PlayerId;
      const handEnd = result.events.find(
        (e) => e.type === "hand_end" && e.record.handId === r.handId,
      );
      if (!handEnd || handEnd.type !== "hand_end") continue;
      const record = handEnd.record;

      for (const other of PLAYER_IDS) {
        if (other === self) continue;
        if (record.showdown.includes(other)) continue;
        for (const card of record.holeCards[other]) {
          // A card only counts as leaked if it is not also on the shared board
          // or in this player's own hand.
          if (record.communityCards.includes(card)) continue;
          if (record.holeCards[self].includes(card)) continue;
          expect(r.prompt).not.toContain(card);
        }
      }
    }
  });

  it("builds a prompt under the token budget", async () => {
    const result = await runTournament({
      seed: "budget",
      players: initialPlayers(neutral),
      adapter: new MockAdapter(0),
      timeoutMs: 5000,
    });
    for (const r of result.reflections) {
      expect(Math.ceil(r.prompt.length / 4)).toBeLessThan(1000);
    }
  });
});

describe("prompt builder", () => {
  it("renders a first reflection without history", () => {
    const prompt = buildReflectionPrompt({
      identity: { name: "ATLAS", model: "m", chips: 990, strategy: neutral },
      latestHand: {
        handId: 1,
        communityCards: ["Qh", "Jc", "4h"],
        myCards: ["As", "Kd"],
        myHandStrength: 0.62,
        myActions: [{ action: "raise", amount: 50 }],
        opponentActions: [{ playerId: "playerB", action: "fold", amount: 0 }],
        bluffOutcome: null,
        chipDelta: -10,
        winner: "playerC",
        wentToShowdown: false,
        revealed: {},
      },
      cumulative: {
        handsPlayed: 1,
        handsWon: 0,
        netChips: -10,
        avgChipsPerHand: -10,
        foldRate: 0,
        callRate: 0,
        raiseRate: 1,
        checkRate: 0,
        bluffsAttempted: 0,
        bluffsSuccessful: 0,
        showdownsReached: 0,
        showdownsWon: 0,
      },
      opponents: {
        playerB: { foldToRaiseRate: 1, callRate: 0, raiseRate: 0, showdownsWon: 0 },
      },
      evolutionHistory: [],
    });
    expect(prompt).toContain("this is your first reflection");
    expect(prompt).toContain("hand-1");
    expect(prompt).toContain("ATLAS");
  });
});
