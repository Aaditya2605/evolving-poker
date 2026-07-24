import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TournamentEvent } from "../../shared/types.js";
import { buildEvaluationDashboard } from "../src/evaluation.js";
import { loadFixture } from "../src/fixtures.js";

describe("evaluation dashboard", () => {
  it("derives bounded, explicitly non-causal analytics from a recorded run", () => {
    const fixture = loadFixture(resolve(import.meta.dirname, "../../fixtures/demo.json"));
    const events = fixture.events.map((entry) => entry.event);
    const ending = events.find(
      (event): event is Extract<TournamentEvent, { type: "tournament_end" }> =>
        event.type === "tournament_end",
    );

    const dashboard = buildEvaluationDashboard(events, ending!.standings, fixture.trace);

    expect(dashboard.players).toHaveLength(3);
    expect(dashboard.pioneer.decisionsLinkedToOutcomes).toBeGreaterThan(0);
    expect(dashboard.pioneer.feedbackSubmitted).toBe(false);
    expect(dashboard.coverage.counterfactualAvailable).toBe(false);
    for (const player of dashboard.players) {
      expect(player.stabilityScore).toBeGreaterThanOrEqual(0);
      expect(player.stabilityScore).toBeLessThanOrEqual(100);
      expect(player.reliability).toBeGreaterThanOrEqual(0);
      expect(player.reliability).toBeLessThanOrEqual(100);
    }
  });
});
