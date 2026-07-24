import type {
  FinalStandings,
  PlayerId,
  PlayerState,
  TournamentEvent,
} from "../../../shared/types.js";
import { PLAYER_IDS, STARTING_CHIPS, TOTAL_HANDS } from "../../../shared/types.js";
import { createRouter, type BandRouter } from "../comm/band.js";
import { Trace } from "../comm/trace.js";
import { initialPlayers } from "../config.js";
import { createAdapter, type LlmAdapter } from "../evolution/pioneer.js";
import { decideWithAgent } from "../evolution/action.js";
import { reflectAll, type CapturedReflection } from "../evolution/reflect.js";
import { playHand } from "./hand.js";
import { MetricsTracker } from "./metrics.js";
import type { StrengthOptions } from "./strength.js";

export interface TournamentOptions {
  seed: string;
  totalHands?: number;
  players?: PlayerState[];
  adapter?: LlmAdapter;
  /** false ⇒ strategies frozen. Used by the determinism test and find-seed. */
  reflections?: boolean;
  strengthOptions?: StrengthOptions;
  trace?: Trace;
  router?: BandRouter;
  emit?: (event: TournamentEvent) => void;
  timeoutMs?: number;
  /** Awaited between hands — the live pause control hangs off this. */
  gate?: () => Promise<void>;
}

export interface TournamentResult {
  seed: string;
  events: TournamentEvent[];
  standings: FinalStandings;
  players: PlayerState[];
  trace: Trace;
  reflections: CapturedReflection[];
  coercions: string[];
}

export async function runTournament(opts: TournamentOptions): Promise<TournamentResult> {
  const totalHands = opts.totalHands ?? TOTAL_HANDS;
  const players = opts.players ?? initialPlayers();
  const trace = opts.trace ?? new Trace();
  const router = opts.router ?? createRouter(trace);
  const useReflections = opts.reflections !== false;
  const adapter = opts.adapter ?? (useReflections ? createAdapter() : null);

  const tracker = new MetricsTracker(players);
  const events: TournamentEvent[] = [];
  const reflections: CapturedReflection[] = [];
  const chipsAtHandEnd = new Map<number, Record<PlayerId, number>>();

  const emit = (e: TournamentEvent) => {
    events.push(e);
    opts.emit?.(e);
  };

  emit({
    type: "tournament_start",
    seed: opts.seed,
    players: players.map((p) => ({ ...p, strategy: { ...p.strategy }, strategyHistory: [] })),
    totalHands,
  });

  for (let handId = 1; handId <= totalHands; handId++) {
    if (opts.gate) await opts.gate();

    const { record, chipsAfter } = await playHand({
      handId,
      seed: opts.seed,
      players,
      strengthOptions: opts.strengthOptions,
      deps: {
        emit,
        onCoercion: (note) => tracker.recordCoercion(note),
        decideAction:
          adapter?.act
            ? ({ player, ctx, holeCards, communityCards, actions }) =>
                decideWithAgent({
                  adapter,
                  player,
                  ctx,
                  holeCards,
                  communityCards,
                  actions,
                  timeoutMs: opts.timeoutMs ?? 20_000,
                })
            : undefined,
        traceTurnRequest: (playerId, ctx) =>
          router.send("dealer", playerId, "turn_request", {
            handId: ctx.handId,
            potSize: ctx.potSize,
            toCall: ctx.toCall,
            canRaise: ctx.canRaise,
            raiseAmount: ctx.raiseAmount,
            myChips: ctx.myChips,
          }),
        traceTurnAction: (playerId, decision, potAfter) =>
          router.send(playerId, "all", "turn_action", {
            handId,
            action: decision.action,
            amount: decision.amount,
            potAfter,
            model: decision.agent?.model,
            reason: decision.agent?.reason,
            status: decision.agent?.status,
          }),
      },
    });

    for (const p of players) p.chips = chipsAfter[p.id];
    chipsAtHandEnd.set(handId, { ...chipsAfter });

    tracker.recordHand(record);
    emit({ type: "hand_end", record, chips: { ...chipsAfter } });
    router.send(record.winner, "all", "hand_summary", {
      handId,
      winner: record.winner,
      potSize: record.potSize,
      showdown: record.showdown,
      chipDeltas: record.chipDeltas,
    });

    if (useReflections && adapter) {
      const evolutionEvents = await reflectAll({
        handId,
        players,
        record,
        tracker,
        adapter,
        chipsAtHandEnd,
        timeoutMs: opts.timeoutMs,
        onCapture: (c) => reflections.push(c),
      });
      for (const ev of evolutionEvents) {
        tracker.recordEvolution(ev);
        emit({ type: "evolution", event: ev });
        router.send(ev.playerId, "all", "evolution_event", {
          handId: ev.handId,
          status: ev.status,
          before: ev.before,
          after: ev.after,
          reason: ev.reason,
          evidence: ev.evidence,
        });
      }
    }

    emit({ type: "metrics", snapshot: tracker.snapshot(handId) });
  }

  const snapshot = tracker.snapshot(totalHands);
  const ranking = players
    .slice()
    .sort((a, b) => b.chips - a.chips || PLAYER_IDS.indexOf(a.id) - PLAYER_IDS.indexOf(b.id))
    .map((p, i) => ({
      rank: i + 1,
      playerId: p.id,
      name: p.name,
      model: p.model,
      chips: p.chips,
      netChips: p.chips - STARTING_CHIPS,
    }));

  const standings: FinalStandings = {
    seed: opts.seed,
    handsPlayed: totalHands,
    winner: ranking[0].playerId,
    ranking,
    snapshot,
    findings: useReflections ? tracker.findings() : [],
  };

  emit({ type: "tournament_end", standings });
  await router.close();

  return {
    seed: opts.seed,
    events,
    standings,
    players,
    trace,
    reflections,
    coercions: tracker.coercions,
  };
}
