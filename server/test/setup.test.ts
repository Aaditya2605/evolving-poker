import { describe, expect, it } from "vitest";
import { config, initialPlayers, parseTournamentSetup } from "../src/config.js";

describe("tournament setup", () => {
  const models = { ...config.models };

  it("accepts run-scoped models and rejects unsafe hand counts", () => {
    expect(parseTournamentSetup({ hands: 9, models })).toEqual({
      ok: true,
      value: { hands: 9, models },
    });
    expect(parseTournamentSetup({ hands: 31, models })).toMatchObject({ ok: false });
    expect(initialPlayers(undefined, models).map((player) => player.model)).toEqual(
      Object.values(models),
    );
  });
});
