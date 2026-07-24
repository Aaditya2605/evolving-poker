import { describe, expect, it } from "vitest";
import type { DecisionContext, Strategy, TournamentEvent } from "../../shared/types.js";
import { PLAYER_IDS, RAISE_AMOUNT, STARTING_CHIPS } from "../../shared/types.js";
import { coerceLegal, playHand } from "../src/engine/hand.js";
import { decide } from "../src/engine/decide.js";
import { runTournament } from "../src/engine/tournament.js";
import { initialPlayers } from "../src/config.js";
import { MockAdapter } from "../src/evolution/pioneer.js";

const TOTAL = STARTING_CHIPS * PLAYER_IDS.length;
const neutral: Strategy = { aggression: 0.5, bluffRate: 0.2, callThreshold: 0.5 };

const frozenRun = (seed: string) =>
  runTournament({ seed, reflections: false, players: initialPlayers(neutral) });

const mockRun = (seed: string) =>
  runTournament({
    seed,
    players: initialPlayers(neutral),
    adapter: new MockAdapter(0),
    timeoutMs: 5000,
  });

describe("1. chip conservation", () => {
  it("holds at every action and every hand boundary", async () => {
    const { events } = await frozenRun("conserve");

    let chips: Record<string, number> = {};
    let pot = 0;

    for (const e of events as TournamentEvent[]) {
      if (e.type === "hand_start") {
        chips = { ...e.chips };
        pot = e.pot;
        expect(sum(chips) + pot).toBe(TOTAL);
      }
      if (e.type === "action") {
        const spent = e.potAfter - pot;
        chips[e.playerId] -= spent;
        pot = e.potAfter;
        expect(sum(chips) + pot).toBe(TOTAL);
      }
      if (e.type === "hand_end") {
        expect(sum(e.chips)).toBe(TOTAL);
        pot = 0;
      }
    }
  });

  it("never lets a player reach the chip floor in six hands", async () => {
    const { players } = await frozenRun("floor");
    for (const p of players) expect(p.chips).toBeGreaterThan(0);
  });
});

describe("2. determinism", () => {
  it("produces an identical event log for the same seed with frozen strategies", async () => {
    const a = await frozenRun("sf2026");
    const b = await frozenRun("sf2026");
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it("is also deterministic end-to-end with the mock adapter reflecting", async () => {
    const a = await mockRun("sf2026");
    const b = await mockRun("sf2026");
    expect(JSON.stringify(stripTiming(a.events))).toBe(JSON.stringify(stripTiming(b.events)));
  });

  it("produces a different log for a different seed", async () => {
    const a = await frozenRun("sf2026");
    const b = await frozenRun("different");
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
  });
});

describe("3. decide() responds monotonically to the dials", () => {
  const base: DecisionContext = {
    handId: 1,
    playerId: "playerA",
    handStrength: 0.75,
    potSize: 100,
    toCall: 0,
    raiseAmount: RAISE_AMOUNT,
    canRaise: true,
    myChips: 900,
    actionIndex: 0,
    seed: "monotonic",
  };

  it("raises a boundary hand only once aggression is high enough", () => {
    const timid = decide(base, { ...neutral, aggression: 0.2, bluffRate: 0 });
    const bold = decide(base, { ...neutral, aggression: 0.9, bluffRate: 0 });
    expect(timid.action).toBe("check");
    expect(bold.action).toBe("raise");
    expect(bold.isBluff).toBe(false);
  });

  it("folds a boundary call once callThreshold is high enough", () => {
    const ctx: DecisionContext = { ...base, handStrength: 0.45, toCall: 50 };
    const loose = decide(ctx, { aggression: 0.5, bluffRate: 0, callThreshold: 0.3 });
    const tight = decide(ctx, { aggression: 0.5, bluffRate: 0, callThreshold: 0.9 });
    expect(loose.action).toBe("call");
    expect(tight.action).toBe("fold");
  });

  it("never bluffs with a strong hand, and marks weak-hand raises as bluffs", () => {
    const weak: DecisionContext = { ...base, handStrength: 0.1 };
    const alwaysBluff = decide(weak, { aggression: 1, bluffRate: 1, callThreshold: 0.5 });
    expect(alwaysBluff.action).toBe("raise");
    expect(alwaysBluff.isBluff).toBe(true);

    const strong = decide(base, { aggression: 1, bluffRate: 1, callThreshold: 0.5 });
    expect(strong.isBluff).toBe(false);
  });

  it("is pure — same input, same output", () => {
    expect(decide(base, neutral)).toEqual(decide(base, neutral));
  });
});

describe("5. betting legality", () => {
  it("allows each player at most one raise per hand", async () => {
    for (const seed of ["a", "b", "c", "sf2026", "raise-cap"]) {
      const { events } = await frozenRun(seed);
      const raises: Record<number, Record<string, number>> = {};
      for (const e of events as TournamentEvent[]) {
        if (e.type !== "action" || e.action !== "raise") continue;
        raises[e.handId] ??= {};
        raises[e.handId][e.playerId] = (raises[e.handId][e.playerId] ?? 0) + 1;
      }
      for (const perHand of Object.values(raises)) {
        for (const count of Object.values(perHand)) expect(count).toBeLessThanOrEqual(1);
      }
    }
  });

  it("coerces an illegal raise to a call and logs it", () => {
    const notes: string[] = [];
    const ctx: DecisionContext = {
      handId: 2,
      playerId: "playerB",
      handStrength: 0.9,
      potSize: 100,
      toCall: 50,
      raiseAmount: RAISE_AMOUNT,
      canRaise: false,
      myChips: 500,
      actionIndex: 1,
      seed: "coerce",
    };
    const out = coerceLegal({ action: "raise", amount: 100, isBluff: false }, ctx, (n) =>
      notes.push(n),
    );
    expect(out.action).toBe("call");
    expect(out.amount).toBe(50);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("illegal raise");
  });

  it("coerces an illegal raise to a check when nothing is owed", () => {
    const ctx: DecisionContext = {
      handId: 2,
      playerId: "playerB",
      handStrength: 0.9,
      potSize: 100,
      toCall: 0,
      raiseAmount: RAISE_AMOUNT,
      canRaise: false,
      myChips: 500,
      actionIndex: 1,
      seed: "coerce",
    };
    expect(coerceLegal({ action: "raise", amount: 50, isBluff: true }, ctx).action).toBe("check");
  });

  it("pays exactly one winner (or splits) and reveals only at showdown", async () => {
    const { events } = await frozenRun("showdown");
    for (const e of events as TournamentEvent[]) {
      if (e.type !== "hand_end") continue;
      const r = e.record;
      expect(r.winners.length).toBeGreaterThanOrEqual(1);
      expect(r.winners).toContain(r.winner);
      if (r.showdown.length === 0) {
        expect(Object.keys(r.handNames)).toHaveLength(0);
      } else {
        expect(Object.keys(r.handNames).sort()).toEqual(r.showdown.slice().sort());
      }
      const paid = PLAYER_IDS.reduce((a, id) => a + r.chipDeltas[id], 0);
      expect(paid).toBe(0);
    }
  });
});

describe("hand strength", () => {
  it("is bounded and deterministic", () => {
    const one = playHand({ handId: 1, seed: "hs", players: initialPlayers(neutral) });
    const two = playHand({ handId: 1, seed: "hs", players: initialPlayers(neutral) });
    for (const id of PLAYER_IDS) {
      const hs = one.record.handStrength[id];
      expect(hs).toBeGreaterThanOrEqual(0);
      expect(hs).toBeLessThanOrEqual(1);
      expect(hs).toBe(two.record.handStrength[id]);
    }
  });
});

function sum(r: Record<string, number>): number {
  return Object.values(r).reduce((a, b) => a + b, 0);
}

/** Mock latency has deterministic jitter but wall-clock fields do not exist in
 *  the event stream, so only the raw log needs normalising for comparison. */
function stripTiming(events: TournamentEvent[]): TournamentEvent[] {
  return JSON.parse(JSON.stringify(events));
}
