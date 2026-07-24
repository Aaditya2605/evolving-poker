// ============================================================================
// EVOLVING POKER — single source of truth for every type crossing a boundary.
// Imported by server/ and web/ alike. Keep it dependency-free.
// ============================================================================

export type PlayerId = "playerA" | "playerB" | "playerC" | "playerD";
export type Street = "betting"; // single betting round per spec
export type Action = "fold" | "check" | "call" | "raise";

export const PLAYER_IDS: PlayerId[] = ["playerA", "playerB", "playerC", "playerD"];

/** The strategy dials a model may move. All values ∈ [0,1]. */
export interface Strategy {
  aggression: number;
  bluffRate: number;
  callThreshold: number;
}

export type DialName = keyof Strategy;
export const DIALS: DialName[] = ["aggression", "bluffRate", "callThreshold"];

export interface PlayerState {
  id: PlayerId;
  name: string; // display name
  model: string; // Pioneer model id (label on UI)
  personality: string; // stable behavioral lens; evidence may still change the strategy
  color: string; // UI accent
  chips: number;
  strategy: Strategy;
  strategyHistory: EvolutionEvent[];
}

/** Input to decide() — NOTHING else. See server/src/engine/decide.ts §4. */
export interface DecisionContext {
  handId: number;
  playerId: PlayerId;
  handStrength: number; // [0,1], engine-computed
  potSize: number;
  toCall: number; // 0 if checking is legal
  raiseAmount: number; // fixed raise size
  canRaise: boolean; // max one raise per player per hand
  myChips: number;
  actionIndex: number; // nth decision this hand (for rng)
  seed: string; // tournament seed
}

export interface Decision {
  action: Action;
  amount: number; // chips added by this action
  isBluff: boolean; // hs < BLUFF_HS_CAP && action === "raise"
  agent?: AgentActionMeta;
}

export type AgentActionStatus = "ok" | "invalid" | "timeout";

export interface AgentActionMeta {
  model: string;
  servedModel?: string;
  inferenceId?: string;
  reason: string;
  confidence?: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  llmCalls: number;
  status: AgentActionStatus;
}

export interface HandAction {
  playerId: PlayerId;
  action: Action;
  amount: number;
  potAfter: number;
  isBluff: boolean; // spectator-only
  agent?: AgentActionMeta;
}

/** Broadcast after each hand. */
export interface HandRecord {
  handId: number;
  communityCards: string[]; // e.g. ["Qh","Jc","4h"]
  holeCards: Record<PlayerId, string[]>; // SPECTATOR-ONLY until showdown
  handStrength: Record<PlayerId, number>;
  actions: HandAction[];
  showdown: PlayerId[]; // players who reached showdown
  winner: PlayerId;
  winners: PlayerId[]; // >1 on a split pot; `winner` is winners[0]
  potSize: number;
  chipDeltas: Record<PlayerId, number>;
  handNames: Partial<Record<PlayerId, string>>; // e.g. "Two Pair" — showdown only
}

// --- Reflection ------------------------------------------------------------

export interface ReflectionLatestHand {
  handId: number;
  communityCards: string[];
  myCards: string[];
  myHandStrength: number;
  myActions: { action: Action; amount: number }[];
  /** PUBLIC only: what opponents did. Never their hole cards pre-showdown. */
  opponentActions: { playerId: PlayerId; action: Action; amount: number }[];
  /** Present only when this player attempted a bluff this hand. */
  bluffOutcome: { attempted: boolean; succeeded: boolean } | null;
  chipDelta: number;
  winner: PlayerId;
  wentToShowdown: boolean;
  /** Revealed hands, showdown only. */
  revealed: Partial<Record<PlayerId, { cards: string[]; handName: string }>>;
}

export interface ReflectionCumulative {
  handsPlayed: number;
  handsWon: number;
  netChips: number;
  avgChipsPerHand: number;
  foldRate: number;
  callRate: number;
  raiseRate: number;
  checkRate: number;
  bluffsAttempted: number;
  bluffsSuccessful: number;
  showdownsReached: number;
  showdownsWon: number;
}

export interface OpponentBehavior {
  foldToRaiseRate: number;
  callRate: number;
  raiseRate: number;
  showdownsWon: number;
}

/** What each model receives. Public information + own private information only. */
export interface ReflectionInput {
  identity: {
    name: string;
    model: string;
    personality: string;
    chips: number;
    strategy: Strategy;
  };
  latestHand: ReflectionLatestHand;
  cumulative: ReflectionCumulative;
  opponents: Record<string, OpponentBehavior>;
  /**
   * Includes FAILED reflections, not just applied ones. A model that cannot see
   * that its hand-3 response was rejected will produce the same malformed
   * response on hand 4.
   */
  evolutionHistory: {
    hand: number;
    status: EvolutionStatus;
    /** For non-applied entries this equals the strategy that stayed in force. */
    strategy: Strategy;
    reason: string;
    chipsChangeSince: number;
  }[];
}

/** The model's JSON — validated by zod, mechanically only. */
export interface ReflectionOutput {
  change: boolean;
  strategy?: Strategy; // required iff change === true
  reason: string; // ≤200 chars, public-facing
  evidence: string[]; // hand ids, e.g. ["hand-2","hand-3"]
  confidence?: number; // [0,1] optional
  /** Optional agent-selected model for the next hand. Must be in MODEL_POOL. */
  nextModel?: string;
}

export type EvolutionStatus = "applied" | "no_change" | "invalid" | "timeout";

/** Streamed to UI + audit log. One per player per hand — always, even on failure. */
export interface EvolutionEvent {
  handId: number;
  playerId: PlayerId;
  model: string;
  modelAfter: string;
  modelChanged: boolean;
  before: Strategy;
  after: Strategy; // === before when no change / invalid / timeout
  changed: boolean;
  reason: string; // or failure reason
  evidence: string[];
  confidence?: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  /** Actual adapter calls spent on THIS reflection: 1, or 2 when a retry fired. */
  llmCalls: number;
  /** Local coercions applied to the raw response before validation. */
  repairs: string[];
  status: EvolutionStatus;
  retried: boolean;
  rawResponse?: string; // audit pack only
}

// --- Metrics (product spec §10–11) ----------------------------------------

export interface AgentPerformance {
  playerId: PlayerId;
  name: string;
  model: string;
  chips: number;
  netChips: number;
  handsPlayed: number;
  handsWon: number;
  avgChipsPerHand: number;
  /** 2nd-half avg chips/hand − 1st-half. Directional only — tiny sample. */
  adaptationGain: number;
  foldRate: number;
  callRate: number;
  raiseRate: number;
  checkRate: number;
  vpip: number; // voluntarily put chips in pot (call or raise) per hand
  bluffsAttempted: number;
  bluffsSuccessful: number;
  bluffSuccessRate: number;
  showdownsReached: number;
  showdownsWon: number;
  showdownWinRate: number;
}

export interface DialMovement {
  totalAbsMovement: number;
  oscillations: number;
  changes: number;
  current: number;
  min: number;
  max: number;
}

export interface StrategyEvolutionMetrics {
  playerId: PlayerId;
  model: string;
  updatesAttempted: number;
  changesApplied: number;
  noChanges: number;
  /**
   * noChanges / updatesAttempted. A model that never declines to change is not
   * reasoning about evidence, and this is the number that shows it.
   */
  noChangeRate: number;
  invalid: number;
  timeouts: number;
  /** Σ |Δdial| across all dials and all applied updates. "volatility". */
  totalAbsMovement: number;
  /** A dial moving ≥0.15 one way then ≥0.15 back within the next two updates. */
  oscillations: number;
  perDial: Record<DialName, DialMovement>;
  current: Strategy;
  initial: Strategy;
}

export interface ModelPerformance {
  playerId: PlayerId;
  model: string;
  calls: number;
  actionCalls: number;
  reflectionCalls: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estCostUsd: number;
  invalidCount: number;
  timeoutCount: number;
  retryCount: number;
}

export interface MetricsSnapshot {
  handId: number; // 0 = pre-tournament
  handsPlayed: number;
  agents: Record<PlayerId, AgentPerformance>;
  /** Public behavior of each player, as observed by everyone. */
  opponents: Record<PlayerId, OpponentBehavior>;
  evolution: Record<PlayerId, StrategyEvolutionMetrics>;
  models: Record<PlayerId, ModelPerformance>;
  totals: {
    /** Reflections run: hands × players. Exactly one per player per hand. */
    reflections: number;
    actionCalls: number;
    /** Adapter calls actually spent. ≥ reflections, because retries cost a call. */
    llmCalls: number;
    estCostUsd: number;
    avgLatencyMs: number;
    invalid: number;
    timeouts: number;
    chipsInPlay: number;
  };
}

export interface FinalStandings {
  seed: string;
  handsPlayed: number;
  winner: PlayerId;
  ranking: {
    rank: number;
    playerId: PlayerId;
    name: string;
    model: string;
    chips: number;
    netChips: number;
  }[];
  snapshot: MetricsSnapshot;
  /** Auto-derived, every claim carries hand-id evidence. Used by cited.md. */
  findings: { claim: string; evidence: string[] }[];
}

// --- Band trace ------------------------------------------------------------

export type TraceKind =
  | "turn_request"
  | "turn_action"
  | "hand_summary"
  | "evolution_event";

export interface TraceMessage {
  ts: number;
  seq: number;
  from: "dealer" | PlayerId;
  to: "dealer" | PlayerId | "all";
  kind: TraceKind;
  payload: unknown;
}

// --- The single event stream ----------------------------------------------

export type TournamentEvent =
  | { type: "tournament_start"; seed: string; players: PlayerState[]; totalHands: number }
  | { type: "trace"; message: TraceMessage }
  | {
      type: "hand_start";
      handId: number;
      communityCards: string[];
      holeCards: Record<PlayerId, string[]>;
      dealer: PlayerId;
      chips: Record<PlayerId, number>;
      pot: number;
    }
  | {
      type: "action";
      handId: number;
      playerId: PlayerId;
      action: Action;
      amount: number;
      potAfter: number;
      isBluff: boolean;
      agent?: AgentActionMeta;
    }
  | { type: "hand_end"; record: HandRecord; chips: Record<PlayerId, number> }
  | { type: "evolution"; event: EvolutionEvent }
  | { type: "metrics"; snapshot: MetricsSnapshot }
  | { type: "tournament_end"; standings: FinalStandings };

export interface TimedEvent {
  /** ms offset from tournament_start — replay uses this for original pacing. */
  offsetMs: number;
  event: TournamentEvent;
}

export interface Fixture {
  version: 1;
  seed: string;
  recordedAt: string;
  pioneerMode: string;
  events: TimedEvent[];
  trace: TraceMessage[];
}

/** Everything behind the x402 paywall. */
export interface AuditPack {
  seed: string;
  generatedAt: string;
  events: TournamentEvent[];
  reflections: {
    handId: number;
    playerId: PlayerId;
    model: string;
    prompt: string;
    raw: string;
    parsed: ReflectionOutput | null;
    status: EvolutionStatus;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    estCostUsd: number;
    llmCalls: number;
    repairs: string[];
  }[];
  trace: TraceMessage[];
  standings: FinalStandings | null;
}

// --- Constants shared with the UI -----------------------------------------

export const STARTING_CHIPS = 1000;
export const ANTE = 10;
export const RAISE_AMOUNT = 50;
export const TOTAL_HANDS = 6;
export const COMMUNITY_CARD_COUNT = 3;
export const HOLE_CARD_COUNT = 2;
/** Oscillation = a dial moving ≥ this one way then ≥ this back within 2 updates. */
export const OSCILLATION_DELTA = 0.15;
export const OSCILLATION_WINDOW = 2;

export const NEUTRAL_STRATEGY: Strategy = {
  aggression: 0.5,
  bluffRate: 0.2,
  callThreshold: 0.5,
};
