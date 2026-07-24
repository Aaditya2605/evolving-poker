import type {
  AgentPerformance,
  DialMovement,
  DialName,
  EvolutionEvent,
  HandAction,
  HandRecord,
  MetricsSnapshot,
  ModelPerformance,
  OpponentBehavior,
  PlayerId,
  PlayerState,
  ReflectionCumulative,
  Strategy,
  StrategyEvolutionMetrics,
} from "../../../shared/types.js";
import {
  DIALS,
  OSCILLATION_DELTA,
  OSCILLATION_WINDOW,
  PLAYER_IDS,
  RAISE_AMOUNT,
  STARTING_CHIPS,
} from "../../../shared/types.js";

/**
 * Reconstructs how much each action had to call. Derivable from the action list
 * alone: a call's amount IS the toCall, and a raise's amount is toCall + RAISE.
 */
export function annotateToCall(actions: HandAction[]): (HandAction & { toCall: number })[] {
  const committed: Record<string, number> = {};
  let currentBet = 0;
  return actions.map((a) => {
    const mine = committed[a.playerId] ?? 0;
    const toCall = currentBet - mine;
    if (a.action === "call" || a.action === "raise") {
      committed[a.playerId] = mine + a.amount;
      if (a.action === "raise") currentBet = Math.max(currentBet, committed[a.playerId]);
    }
    return { ...a, toCall };
  });
}

interface AgentCounters {
  handsPlayed: number;
  handsWon: number;
  folds: number;
  calls: number;
  raises: number;
  checks: number;
  facedBet: number;
  foldsFacingBet: number;
  vpipHands: number;
  bluffsAttempted: number;
  bluffsSuccessful: number;
  showdownsReached: number;
  showdownsWon: number;
  chipDeltas: number[];
}

function zeroCounters(): AgentCounters {
  return {
    handsPlayed: 0,
    handsWon: 0,
    folds: 0,
    calls: 0,
    raises: 0,
    checks: 0,
    facedBet: 0,
    foldsFacingBet: 0,
    vpipHands: 0,
    bluffsAttempted: 0,
    bluffsSuccessful: 0,
    showdownsReached: 0,
    showdownsWon: 0,
    chipDeltas: [],
  };
}

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export class MetricsTracker {
  private counters: Record<PlayerId, AgentCounters>;
  private evolutions: Record<PlayerId, EvolutionEvent[]>;
  private initial: Record<PlayerId, Strategy>;
  private handsPlayed = 0;
  readonly coercions: string[] = [];

  constructor(private players: PlayerState[]) {
    this.counters = this.blank(zeroCounters);
    this.evolutions = this.blank<EvolutionEvent[]>(() => []);
    this.initial = this.blank((id) => ({ ...this.byId(id).strategy }));
  }

  private blank<T>(fill: (id: PlayerId) => T): Record<PlayerId, T> {
    return {
      playerA: fill("playerA"),
      playerB: fill("playerB"),
      playerC: fill("playerC"),
    };
  }

  private byId(id: PlayerId): PlayerState {
    return this.players.find((p) => p.id === id)!;
  }

  recordHand(record: HandRecord): void {
    this.handsPlayed++;
    const annotated = annotateToCall(record.actions);
    const noShowdown = record.showdown.length === 0;

    for (const id of PLAYER_IDS) {
      const c = this.counters[id];
      c.handsPlayed++;
      c.chipDeltas.push(record.chipDeltas[id]);
      if (record.winners.includes(id)) c.handsWon++;
      if (record.showdown.includes(id)) {
        c.showdownsReached++;
        if (record.winners.includes(id)) c.showdownsWon++;
      }

      const mine = annotated.filter((a) => a.playerId === id);
      let voluntary = false;
      let bluffed = false;
      for (const a of mine) {
        if (a.action === "fold") c.folds++;
        if (a.action === "call") c.calls++;
        if (a.action === "raise") c.raises++;
        if (a.action === "check") c.checks++;
        if (a.toCall > 0) {
          c.facedBet++;
          if (a.action === "fold") c.foldsFacingBet++;
        }
        if (a.action === "call" || a.action === "raise") voluntary = true;
        if (a.isBluff) bluffed = true;
      }
      if (voluntary) c.vpipHands++;
      if (bluffed) {
        c.bluffsAttempted++;
        // Textbook definition: a bluff worked if it took the pot without a showdown.
        if (noShowdown && record.winners.includes(id)) c.bluffsSuccessful++;
      }
    }
  }

  recordEvolution(ev: EvolutionEvent): void {
    this.evolutions[ev.playerId].push(ev);
  }

  recordCoercion(note: string): void {
    this.coercions.push(note);
  }

  private agentPerformance(id: PlayerId): AgentPerformance {
    const c = this.counters[id];
    const p = this.byId(id);
    const totalActions = c.folds + c.calls + c.raises + c.checks;
    const half = Math.floor(c.chipDeltas.length / 2);
    const first = c.chipDeltas.slice(0, half);
    const second = c.chipDeltas.slice(half);
    const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
    return {
      playerId: id,
      name: p.name,
      model: p.model,
      chips: p.chips,
      netChips: p.chips - STARTING_CHIPS,
      handsPlayed: c.handsPlayed,
      handsWon: c.handsWon,
      avgChipsPerHand: round3(ratio(p.chips - STARTING_CHIPS, c.handsPlayed)),
      adaptationGain: half === 0 ? 0 : round3(avg(second) - avg(first)),
      foldRate: round3(ratio(c.folds, totalActions)),
      callRate: round3(ratio(c.calls, totalActions)),
      raiseRate: round3(ratio(c.raises, totalActions)),
      checkRate: round3(ratio(c.checks, totalActions)),
      vpip: round3(ratio(c.vpipHands, c.handsPlayed)),
      bluffsAttempted: c.bluffsAttempted,
      bluffsSuccessful: c.bluffsSuccessful,
      bluffSuccessRate: round3(ratio(c.bluffsSuccessful, c.bluffsAttempted)),
      showdownsReached: c.showdownsReached,
      showdownsWon: c.showdownsWon,
      showdownWinRate: round3(ratio(c.showdownsWon, c.showdownsReached)),
    };
  }

  opponentBehavior(id: PlayerId): OpponentBehavior {
    const c = this.counters[id];
    const totalActions = c.folds + c.calls + c.raises + c.checks;
    return {
      foldToRaiseRate: round3(ratio(c.foldsFacingBet, c.facedBet)),
      callRate: round3(ratio(c.calls, totalActions)),
      raiseRate: round3(ratio(c.raises, totalActions)),
      showdownsWon: c.showdownsWon,
    };
  }

  /** The cumulative block handed to the model at reflection time. */
  cumulativeFor(id: PlayerId): ReflectionCumulative {
    const c = this.counters[id];
    const p = this.byId(id);
    const totalActions = c.folds + c.calls + c.raises + c.checks;
    return {
      handsPlayed: c.handsPlayed,
      handsWon: c.handsWon,
      netChips: p.chips - STARTING_CHIPS,
      avgChipsPerHand: round3(ratio(p.chips - STARTING_CHIPS, c.handsPlayed)),
      foldRate: round3(ratio(c.folds, totalActions)),
      callRate: round3(ratio(c.calls, totalActions)),
      raiseRate: round3(ratio(c.raises, totalActions)),
      checkRate: round3(ratio(c.checks, totalActions)),
      bluffsAttempted: c.bluffsAttempted,
      bluffsSuccessful: c.bluffsSuccessful,
      showdownsReached: c.showdownsReached,
      showdownsWon: c.showdownsWon,
    };
  }

  private evolutionMetrics(id: PlayerId): StrategyEvolutionMetrics {
    const events = this.evolutions[id];
    const p = this.byId(id);
    const perDial = {} as Record<DialName, DialMovement>;
    let totalAbsMovement = 0;
    let oscillations = 0;

    for (const dial of DIALS) {
      const deltas = events.map((e) => e.after[dial] - e.before[dial]);
      const values = [this.initial[id][dial], ...events.map((e) => e.after[dial])];
      const abs = deltas.reduce((a, d) => a + Math.abs(d), 0);
      const osc = countOscillations(deltas);
      totalAbsMovement += abs;
      oscillations += osc;
      perDial[dial] = {
        totalAbsMovement: round3(abs),
        oscillations: osc,
        changes: deltas.filter((d) => d !== 0).length,
        current: round3(p.strategy[dial]),
        min: round3(Math.min(...values)),
        max: round3(Math.max(...values)),
      };
    }

    return {
      playerId: id,
      model: p.model,
      updatesAttempted: events.length,
      changesApplied: events.filter((e) => e.status === "applied").length,
      noChanges: events.filter((e) => e.status === "no_change").length,
      invalid: events.filter((e) => e.status === "invalid").length,
      timeouts: events.filter((e) => e.status === "timeout").length,
      totalAbsMovement: round3(totalAbsMovement),
      oscillations,
      perDial,
      current: { ...p.strategy },
      initial: { ...this.initial[id] },
    };
  }

  private modelPerformance(id: PlayerId): ModelPerformance {
    const events = this.evolutions[id];
    const p = this.byId(id);
    const latencies = events.map((e) => e.latencyMs);
    return {
      playerId: id,
      model: p.model,
      calls: events.length,
      avgLatencyMs: Math.round(ratio(latencies.reduce((a, b) => a + b, 0), latencies.length)),
      maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
      totalInputTokens: events.reduce((a, e) => a + e.inputTokens, 0),
      totalOutputTokens: events.reduce((a, e) => a + e.outputTokens, 0),
      estCostUsd: Number(events.reduce((a, e) => a + e.estCostUsd, 0).toFixed(6)),
      invalidCount: events.filter((e) => e.status === "invalid").length,
      timeoutCount: events.filter((e) => e.status === "timeout").length,
      retryCount: events.filter((e) => e.retried).length,
    };
  }

  snapshot(handId: number): MetricsSnapshot {
    const models = this.blank((id) => this.modelPerformance(id));
    const allEvents = PLAYER_IDS.flatMap((id) => this.evolutions[id]);
    const latencies = allEvents.map((e) => e.latencyMs);
    return {
      handId,
      handsPlayed: this.handsPlayed,
      agents: this.blank((id) => this.agentPerformance(id)),
      opponents: this.blank((id) => this.opponentBehavior(id)),
      evolution: this.blank((id) => this.evolutionMetrics(id)),
      models,
      totals: {
        llmCalls: allEvents.length,
        estCostUsd: Number(allEvents.reduce((a, e) => a + e.estCostUsd, 0).toFixed(6)),
        avgLatencyMs: Math.round(ratio(latencies.reduce((a, b) => a + b, 0), latencies.length)),
        invalid: allEvents.filter((e) => e.status === "invalid").length,
        timeouts: allEvents.filter((e) => e.status === "timeout").length,
        chipsInPlay: PLAYER_IDS.reduce((a, id) => a + this.byId(id).chips, 0),
      },
    };
  }

  /** Auto-derived claims. Every one carries hand-id evidence — nothing unsourced. */
  findings(): { claim: string; evidence: string[] }[] {
    const out: { claim: string; evidence: string[] }[] = [];
    const name = (id: PlayerId) => `${this.byId(id).name} (${this.byId(id).model})`;
    const evs = (id: PlayerId, pred: (e: EvolutionEvent) => boolean) =>
      this.evolutions[id].filter(pred).map((e) => `hand-${e.handId}`);

    const pick = (score: (id: PlayerId) => number) =>
      PLAYER_IDS.slice().sort((a, b) => score(b) - score(a))[0];

    const mostChanges = pick((id) => this.evolutionMetrics(id).changesApplied);
    out.push({
      claim: `${name(mostChanges)} revised its strategy most often — ${this.evolutionMetrics(mostChanges).changesApplied} of ${this.evolutions[mostChanges].length} reflections produced a change.`,
      evidence: evs(mostChanges, (e) => e.status === "applied"),
    });

    const mostHeld = pick((id) => this.evolutionMetrics(id).noChanges);
    out.push({
      claim: `${name(mostHeld)} held its strategy most often — ${this.evolutionMetrics(mostHeld).noChanges} explicit no-change decisions.`,
      evidence: evs(mostHeld, (e) => e.status === "no_change"),
    });

    const mostOsc = pick((id) => this.evolutionMetrics(id).oscillations);
    const oscCount = this.evolutionMetrics(mostOsc).oscillations;
    if (oscCount > 0) {
      out.push({
        claim: `${name(mostOsc)} showed the most self-reversal — ${oscCount} oscillation${oscCount === 1 ? "" : "s"} (a dial moved ≥${OSCILLATION_DELTA} then reversed by ≥${OSCILLATION_DELTA} within two updates).`,
        evidence: evs(mostOsc, (e) => e.status === "applied"),
      });
    } else {
      out.push({
        claim: "No player oscillated: no dial reversed itself by ≥0.15 within two updates in this run.",
        evidence: [],
      });
    }

    const bestGain = pick((id) => this.agentPerformance(id).adaptationGain);
    const gain = this.agentPerformance(bestGain).adaptationGain;
    out.push({
      claim: `${name(bestGain)} had the largest second-half improvement (${gain > 0 ? "+" : ""}${gain} chips/hand vs. its own first half). Directional only — six hands is not a sample.`,
      evidence: [`hand-${Math.ceil(this.handsPlayed / 2)}`, `hand-${this.handsPlayed}`],
    });

    const volatile = pick((id) => this.evolutionMetrics(id).totalAbsMovement);
    out.push({
      claim: `${name(volatile)} moved its dials the furthest in total (${this.evolutionMetrics(volatile).totalAbsMovement} absolute movement across all three dials).`,
      evidence: evs(volatile, (e) => e.status === "applied"),
    });

    const failures = PLAYER_IDS.flatMap((id) =>
      this.evolutions[id]
        .filter((e) => e.status === "invalid" || e.status === "timeout")
        .map((e) => ({ id, e })),
    );
    if (failures.length > 0) {
      out.push({
        claim: `${failures.length} reflection${failures.length === 1 ? "" : "s"} failed mechanically (malformed JSON or timeout) and the affected strategies were left untouched; the tournament continued.`,
        evidence: failures.map((f) => `hand-${f.e.handId}`),
      });
    }

    return out;
  }
}

/** A dial moving ≥Δ one way, then ≥Δ back within the next OSCILLATION_WINDOW updates. */
export function countOscillations(deltas: number[]): number {
  let count = 0;
  let i = 0;
  while (i < deltas.length) {
    const di = deltas[i];
    if (Math.abs(di) >= OSCILLATION_DELTA) {
      let matched = -1;
      const limit = Math.min(i + OSCILLATION_WINDOW, deltas.length - 1);
      for (let j = i + 1; j <= limit; j++) {
        const dj = deltas[j];
        if (Math.abs(dj) >= OSCILLATION_DELTA && Math.sign(dj) === -Math.sign(di)) {
          matched = j;
          break;
        }
      }
      if (matched !== -1) {
        count++;
        i = matched;
        continue;
      }
    }
    i++;
  }
  return count;
}

export { RAISE_AMOUNT };
