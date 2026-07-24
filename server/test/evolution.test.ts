import { describe, expect, it } from "vitest";
import type { PlayerId, ReflectionInput, Strategy } from "../../shared/types.js";
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

function inputWithHistory(history: ReflectionInput["evolutionHistory"]): ReflectionInput {
  return {
    identity: { name: "ATLAS", model: "test-model", chips: 1000, strategy: neutral },
    latestHand: {
      handId: 1,
      communityCards: ["Qh", "Jc", "4h"],
      myCards: ["As", "Kd"],
      myHandStrength: 0.6,
      myActions: [{ action: "call", amount: 50 }],
      opponentActions: [],
      bluffOutcome: null,
      chipDelta: 0,
      winner: "playerB",
      wentToShowdown: false,
      revealed: {},
    },
    cumulative: {
      handsPlayed: 1,
      handsWon: 0,
      netChips: 0,
      avgChipsPerHand: 0,
      foldRate: 0,
      callRate: 1,
      raiseRate: 0,
      checkRate: 0,
      bluffsAttempted: 0,
      bluffsSuccessful: 0,
      showdownsReached: 0,
      showdownsWon: 0,
    },
    opponents: {},
    evolutionHistory: history,
  };
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

describe("3. parser isolation and local repairs", () => {
  it("takes the FIRST complete object when a model emits two", () => {
    const r = parseReflection(
      '{"change":false,"reason":"first","evidence":[]}\n{"change":true,"reason":"second","evidence":[]}',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.reason).toBe("first");
  });

  it("survives a brace inside prose after the object", () => {
    const r = parseReflection(
      '{"change":false,"reason":"holding","evidence":[]}\nNote: the set {A, B} folded.',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.change).toBe(false);
  });

  it("survives a brace inside a string literal", () => {
    const r = parseReflection('{"change":false,"reason":"pot odds {2:1} were wrong","evidence":[]}');
    expect(r.ok).toBe(true);
    expect(r.value?.reason).toBe("pot odds {2:1} were wrong");
  });

  it("survives an escaped quote inside a string literal", () => {
    const r = parseReflection('{"change":false,"reason":"he said \\"raise\\" first","evidence":[]}');
    expect(r.ok).toBe(true);
    expect(r.value?.reason).toBe('he said "raise" first');
  });

  it("coerces numeric strings on the dials", () => {
    const r = parseReflection(
      '{"change":true,"strategy":{"aggression":"0.45","bluffRate":"0.3","callThreshold":0.4},"reason":"x","evidence":["hand-1"]}',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.strategy?.aggression).toBe(0.45);
    expect(r.repairs).toContain("strategy.aggression: string coerced to number");
    expect(r.repairs).toContain("strategy.bluffRate: string coerced to number");
  });

  it("coerces a stringified boolean on change", () => {
    const r = parseReflection('{"change":"false","reason":"holding","evidence":[]}');
    expect(r.ok).toBe(true);
    expect(r.value?.change).toBe(false);
    expect(r.repairs).toContain('change: string "false" coerced to boolean');
  });

  it("wraps a bare evidence string in an array", () => {
    const r = parseReflection('{"change":false,"reason":"x","evidence":"hand-2"}');
    expect(r.ok).toBe(true);
    expect(r.value?.evidence).toEqual(["hand-2"]);
    expect(r.repairs).toContain("evidence: bare string wrapped in array");
  });

  it("truncates an over-long reason rather than rejecting it", () => {
    const r = parseReflection(
      `{"change":false,"reason":"${"z".repeat(400)}","evidence":[]}`,
    );
    expect(r.ok).toBe(true);
    expect(r.value!.reason.length).toBe(300);
    expect(r.repairs).toContain("reason: truncated to 300 chars");
  });

  it("drops a strategy sent alongside change=false", () => {
    const r = parseReflection(
      '{"change":false,"strategy":{"aggression":0.9,"bluffRate":0.9,"callThreshold":0.1},"reason":"x","evidence":[]}',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.strategy).toBeUndefined();
    expect(r.repairs).toContain("strategy dropped: change was false");
  });

  it("still reports no repairs for a clean response", () => {
    const r = parseReflection('{"change":false,"reason":"clean","evidence":["hand-1"]}');
    expect(r.ok).toBe(true);
    expect(r.repairs).toEqual([]);
  });

  it("repairs transport, never judgement — an out-of-range dial is still rejected", () => {
    const r = parseReflection(
      '{"change":true,"strategy":{"aggression":"1.4","bluffRate":0.3,"callThreshold":0.4},"reason":"x","evidence":[]}',
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("aggression");
  });
});

describe("1. failed reflections feed back into the next prompt", () => {
  /** Garbage on hand 1, valid thereafter — keyed on handId, not call order. */
  class FailFirstHand implements LlmAdapter {
    readonly mode = "fail-first";
    async reflect(_id: PlayerId, _prompt: string, meta: { handId: number }) {
      const raw =
        meta.handId === 1
          ? "I reckon we should play looser."
          : '{"change":false,"reason":"holding","evidence":["hand-2"]}';
      return { raw, latencyMs: 5, inputTokens: 100, outputTokens: 20, estCostUsd: 0.0001 };
    }
  }

  it("tells the model its previous response was rejected", async () => {
    const result = await runTournament({
      seed: "feedback",
      totalHands: 2,
      players: initialPlayers(neutral),
      adapter: new FailFirstHand(),
      timeoutMs: 1000,
    });

    const hand2 = result.reflections.filter((r) => r.handId === 2 && r.playerId === "playerA");
    expect(hand2.length).toBeGreaterThan(0);
    expect(hand2[0].prompt).toContain("hand 1: RESPONSE REJECTED");
    expect(hand2[0].prompt).toContain("No change was made.");
  });

  it("shows explicit no-change decisions too, not just applied ones", async () => {
    const result = await runTournament({
      seed: "held",
      totalHands: 2,
      players: initialPlayers(neutral),
      adapter: new ScriptedAdapter(['{"change":false,"reason":"variance","evidence":["hand-1"]}']),
      timeoutMs: 1000,
    });
    const hand2 = result.reflections.find((r) => r.handId === 2)!;
    expect(hand2.prompt).toContain("HELD");
    expect(hand2.prompt).toContain("variance");
  });

  it("caps the history block so the prompt cannot grow unbounded", () => {
    const long = Array.from({ length: 20 }, (_, i) => ({
      hand: i + 1,
      status: "applied" as const,
      strategy: neutral,
      reason: `reason-${i + 1}`,
      chipsChangeSince: 0,
    }));
    const prompt = buildReflectionPrompt(inputWithHistory(long));
    expect(prompt).not.toContain("reason-14");
    expect(prompt).toContain("reason-15");
    expect(prompt).toContain("reason-20");
  });
});

describe("2. no-change is offered as a real option", () => {
  it("asks for a hand citation and biases toward holding", () => {
    const prompt = buildReflectionPrompt(inputWithHistory([]));
    expect(prompt).toContain("Answer no-change unless you");
    expect(prompt).toContain("cite the hand in");
  });

  it("still imposes no strategic guardrails in the wording", () => {
    const prompt = buildReflectionPrompt(inputWithHistory([]));
    for (const banned of ["at most", "one dial", "step size", "do not reverse"]) {
      expect(prompt.toLowerCase()).not.toContain(banned);
    }
  });

  it("reports a per-model no-change rate", async () => {
    const result = await runTournament({
      seed: "rate",
      totalHands: 2,
      players: initialPlayers(neutral),
      adapter: new ScriptedAdapter(['{"change":false,"reason":"variance","evidence":["hand-1"]}']),
      timeoutMs: 1000,
    });
    expect(result.standings.snapshot.evolution.playerA.noChangeRate).toBe(1);
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
    const totals = result.standings.snapshot.totals;
    // Exactly one reflection per player per hand — that part is fixed.
    expect(totals.reflections).toBe(18);
    // Calls are NOT 18: playerC's hand-3 response is malformed twice, so its
    // retry spends a second call. Claiming 18 calls would be a lie on a slide.
    expect(totals.llmCalls).toBe(19);
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
