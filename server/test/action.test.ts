import { describe, expect, it } from "vitest";
import type { DecisionContext } from "../../shared/types.js";
import { initialPlayers } from "../src/config.js";
import { decideWithAgent } from "../src/evolution/action.js";
import type { LlmAdapter } from "../src/evolution/pioneer.js";

const ctx: DecisionContext = {
  handId: 1,
  playerId: "playerA",
  handStrength: 0.72,
  potSize: 80,
  toCall: 50,
  raiseAmount: 50,
  canRaise: true,
  myChips: 940,
  actionIndex: 1,
  seed: "agent-test",
};

function adapter(raw: string): LlmAdapter {
  return {
    mode: "test",
    reflect: async () => ({
      raw: "{}",
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      estCostUsd: 0,
    }),
    act: async () => ({
      raw,
      latencyMs: 12,
      inputTokens: 80,
      outputTokens: 20,
      estCostUsd: 0.001,
      inferenceId: "inf_test",
    }),
  };
}

describe("Pioneer action agent", () => {
  it("accepts a legal model-selected action and derives its amount mechanically", async () => {
    const decision = await decideWithAgent({
      adapter: adapter('{"action":"raise","reason":"Strong hand; apply pressure.","confidence":0.8}'),
      player: initialPlayers()[0],
      ctx,
      holeCards: ["As", "Kd"],
      communityCards: ["Qh", "Jc", "4h"],
      actions: [],
      timeoutMs: 100,
    });

    expect(decision.action).toBe("raise");
    expect(decision.amount).toBe(100);
    expect(decision.agent?.inferenceId).toBe("inf_test");
  });

  it("uses only a mechanical fold fallback when the model chooses an illegal action", async () => {
    const decision = await decideWithAgent({
      adapter: adapter('{"action":"check","reason":"trying to check"}'),
      player: initialPlayers()[0],
      ctx,
      holeCards: ["2s", "3d"],
      communityCards: ["Qh", "Jc", "4h"],
      actions: [],
      timeoutMs: 100,
    });

    expect(decision.action).toBe("fold");
    expect(decision.agent?.status).toBe("invalid");
  });
});
