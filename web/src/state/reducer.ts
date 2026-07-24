import type {
  Action,
  AgentActionMeta,
  EvolutionEvent,
  FinalStandings,
  HandAction,
  HandRecord,
  MetricsSnapshot,
  PlayerId,
  PlayerState,
  Strategy,
  TournamentEvent,
} from "../../../shared/types";
import { NEUTRAL_STRATEGY, TOTAL_HANDS } from "../../../shared/types";

export type Phase = "idle" | "running" | "finished";

export interface ResolvedAction {
  seq: number;
  handId: number;
  playerId: PlayerId;
  action: Action;
  amount: number;
  potAfter: number;
  isBluff: boolean;
  agent?: AgentActionMeta;
}

export interface UiState {
  phase: Phase;
  seed: string | null;
  totalHands: number;
  players: PlayerState[];
  chips: Record<PlayerId, number>;
  strategies: Record<PlayerId, Strategy>;
  handId: number;
  dealer: PlayerId | null;
  communityCards: string[];
  holeCards: Record<PlayerId, string[]>;
  pot: number;
  handActions: HandAction[];
  lastAction: ResolvedAction | null;
  folded: Record<PlayerId, boolean>;
  handRecords: HandRecord[];
  lastRecord: HandRecord | null;
  evolutions: EvolutionEvent[];
  metrics: MetricsSnapshot | null;
  standings: FinalStandings | null;
  agentActionCalls: number;
  agentActionCostUsd: number;
  eventCount: number;
}

export type StoreAction =
  | { kind: "reset" }
  | { kind: "event"; event: TournamentEvent };

function perPlayer<T>(value: T): Record<PlayerId, T> {
  return { playerA: value, playerB: value, playerC: value, playerD: value };
}

export const initialState: UiState = {
  phase: "idle",
  seed: null,
  totalHands: TOTAL_HANDS,
  players: [],
  chips: perPlayer(0),
  strategies: {
    playerA: { ...NEUTRAL_STRATEGY },
    playerB: { ...NEUTRAL_STRATEGY },
    playerC: { ...NEUTRAL_STRATEGY },
    playerD: { ...NEUTRAL_STRATEGY },
  },
  handId: 0,
  dealer: null,
  communityCards: [],
  holeCards: perPlayer<string[]>([]),
  pot: 0,
  handActions: [],
  lastAction: null,
  folded: perPlayer(false),
  handRecords: [],
  lastRecord: null,
  evolutions: [],
  metrics: null,
  standings: null,
  agentActionCalls: 0,
  agentActionCostUsd: 0,
  eventCount: 0,
};

export function reducer(state: UiState, action: StoreAction): UiState {
  if (action.kind === "reset") return initialState;

  const event = action.event;
  const seq = state.eventCount + 1;
  const base: UiState = { ...state, eventCount: seq };

  switch (event.type) {
    case "tournament_start": {
      const chips: Record<PlayerId, number> = perPlayer(0);
      const strategies: Record<PlayerId, Strategy> = {
        playerA: { ...NEUTRAL_STRATEGY },
        playerB: { ...NEUTRAL_STRATEGY },
        playerC: { ...NEUTRAL_STRATEGY },
        playerD: { ...NEUTRAL_STRATEGY },
      };
      for (const p of event.players) {
        chips[p.id] = p.chips;
        strategies[p.id] = { ...p.strategy };
      }
      return {
        ...base,
        phase: "running",
        seed: event.seed,
        totalHands: event.totalHands || TOTAL_HANDS,
        players: event.players,
        agentActionCalls: 0,
        agentActionCostUsd: 0,
        chips,
        strategies,
      };
    }

    case "hand_start": {
      return {
        ...base,
        phase: "running",
        handId: event.handId,
        dealer: event.dealer,
        communityCards: event.communityCards,
        holeCards: { ...base.holeCards, ...event.holeCards },
        chips: { ...base.chips, ...event.chips },
        pot: event.pot,
        handActions: [],
        lastAction: null,
        folded: perPlayer(false),
        lastRecord: null,
      };
    }

    case "action": {
      const handAction: HandAction = {
        playerId: event.playerId,
        action: event.action,
        amount: event.amount,
        potAfter: event.potAfter,
        isBluff: event.isBluff,
      };
      return {
        ...base,
        handId: event.handId || base.handId,
        pot: event.potAfter,
        chips: {
          ...base.chips,
          [event.playerId]: Math.max(
            0,
            base.chips[event.playerId] - event.amount,
          ),
        },
        folded:
          event.action === "fold"
            ? { ...base.folded, [event.playerId]: true }
            : base.folded,
        handActions: [...base.handActions, handAction],
        lastAction: { seq, handId: event.handId, ...handAction },
        agentActionCalls: base.agentActionCalls + (event.agent?.llmCalls ?? 0),
        agentActionCostUsd: base.agentActionCostUsd + (event.agent?.estCostUsd ?? 0),
      };
    }

    case "hand_end": {
      return {
        ...base,
        handId: event.record.handId,
        communityCards: event.record.communityCards.length
          ? event.record.communityCards
          : base.communityCards,
        holeCards: { ...base.holeCards, ...event.record.holeCards },
        chips: { ...base.chips, ...event.chips },
        pot: event.record.potSize,
        handActions: event.record.actions,
        handRecords: [...base.handRecords, event.record],
        lastRecord: event.record,
      };
    }

    case "evolution": {
      const ev = event.event;
      return {
        ...base,
        evolutions: [...base.evolutions, ev],
        strategies:
          ev.status === "applied"
            ? { ...base.strategies, [ev.playerId]: ev.after }
            : base.strategies,
        players: ev.modelChanged
          ? base.players.map((player) =>
              player.id === ev.playerId ? { ...player, model: ev.modelAfter } : player,
            )
          : base.players,
      };
    }

    case "metrics": {
      const snapshot = event.snapshot;
      const chips = { ...base.chips };
      for (const id of Object.keys(snapshot.agents) as PlayerId[]) {
        const agent = snapshot.agents[id];
        if (agent) chips[id] = agent.chips;
      }
      return { ...base, metrics: snapshot, chips };
    }

    case "tournament_end": {
      const chips = { ...base.chips };
      for (const row of event.standings.ranking) chips[row.playerId] = row.chips;
      return {
        ...base,
        phase: "finished",
        standings: event.standings,
        metrics: event.standings.snapshot,
        chips,
      };
    }

    default:
      return base;
  }
}

export function totalLlmCalls(state: UiState): number {
  const fromEvents =
    state.agentActionCalls + state.evolutions.reduce((sum, event) => sum + event.llmCalls, 0);
  return Math.max(fromEvents, state.metrics?.totals.llmCalls ?? 0);
}

export function totalCostUsd(state: UiState): number {
  const fromEvents = state.evolutions.reduce(
    (sum, e) => sum + (Number.isFinite(e.estCostUsd) ? e.estCostUsd : 0),
    0,
  );
  return Math.max(
    state.agentActionCostUsd + fromEvents,
    state.metrics?.totals.estCostUsd ?? 0,
  );
}
