import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TournamentEvent } from "../../shared/types.js";
import { loadFixture } from "../src/fixtures.js";
import { generateCited } from "../src/outputs/report.js";

describe("run report", () => {
  it("replays reports recorded before the fourth seat was added", () => {
    const fixture = loadFixture(resolve(import.meta.dirname, "../../fixtures/demo.json"));
    const events = fixture.events.map((entry) => entry.event);
    const ending = events.find(
      (event): event is Extract<TournamentEvent, { type: "tournament_end" }> =>
        event.type === "tournament_end",
    );

    expect(ending).toBeDefined();
    expect(generateCited(events, ending!.standings)).toContain("3 different models");
  });
});
