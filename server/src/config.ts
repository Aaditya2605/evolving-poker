import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PlayerId, PlayerState, Strategy } from "../../shared/types.js";
import { STARTING_CHIPS } from "../../shared/types.js";

const envFile = resolve(import.meta.dirname, "..", "..", ".env");
if (process.env.NODE_ENV !== "test" && existsSync(envFile)) process.loadEnvFile(envFile);

const env = (k: string, fallback = "") => process.env[k]?.trim() || fallback;
const pioneerApiKey = env("PIONEER_API_KEY");
const pioneerMode = env(
  "PIONEER_MODE",
  process.env.NODE_ENV === "test" ? "mock" : "real",
) as "mock" | "real";
/**
 * A registered Band agent. All three fields are needed to publish: the key
 * authenticates the sender, and the id + handle identify a recipient inside the
 * mandatory `mentions` array. Empty strings when Band is not configured.
 */
export interface BandAgent {
  id: string;
  handle: string;
  key: string;
}

/** Handles are stored bare; the API returns them without the leading `@`. */
const bandAgent = (slot: string): BandAgent => ({
  id: env(`BAND_AGENT_${slot}_ID`),
  handle: env(`BAND_AGENT_${slot}_HANDLE`).replace(/^@/, ""),
  key: env(`BAND_AGENT_${slot}_API_KEY`),
});

const bandAgents = {
  playerA: bandAgent("A"),
  playerB: bandAgent("B"),
  playerC: bandAgent("C"),
} as Record<PlayerId, BandAgent>;
/**
 * A fourth player, provisioned ahead of the engine — PLAYER_IDS seats three.
 * Deliberately outside `bandAgents` so a Record<PlayerId, _> stays exhaustive
 * and nothing iterates it into a seat that does not exist.
 */
const bandFourthSeat = bandAgent("D");
const bandRoomId = env("BAND_ROOM_ID");
const bandConfigured =
  !!bandRoomId && Object.values(bandAgents).every((a) => a.id && a.handle && a.key);
const configuredModels = {
  playerA: env("MODEL_A", "Qwen/Qwen3-4B-Instruct-2507"),
  playerB: env("MODEL_B", "openai/gpt-oss-20b"),
  playerC: env("MODEL_C", "deepseek-ai/DeepSeek-V3"),
} as Record<PlayerId, string>;

export const config = {
  pioneerMode,
  pioneerApiKey,
  bandMode: bandConfigured ? "unwired" : "local",
  bandConfigured,
  bandAgents,
  bandFourthSeat,
  bandRoomId,
  /** Verified live. Auth is `X-API-Key`, not a bearer token. */
  bandBaseUrl: env("BAND_BASE_URL", "https://app.band.ai/api/v1/agent"),
  bandWsUrl: env("BAND_WS_URL", "wss://app.band.ai/api/v1/socket/websocket"),
  x402Mode: env("X402_MODE", "test") as "test" | "real",
  x402PriceUsd: Number(env("X402_PRICE_USD", "0.05")),
  x402PayTo: env("X402_PAY_TO"),
  port: Number(env("PORT", "8787")),
  models: configuredModels,
  modelPool: env("MODEL_POOL", Object.values(configuredModels).join(","))
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
};

export const REFLECT_TIMEOUT_MS = 20_000;

const PERSONAS: Record<
  PlayerId,
  { name: string; color: string; personality: string; strategy: Strategy }
> = {
  playerA: {
    name: "ATLAS",
    color: "#e0a33e",
    personality:
      "The Aggressor: apply pressure, prefer initiative, and make opponents pay to continue.",
    strategy: { aggression: 0.85, bluffRate: 0.25, callThreshold: 0.4 },
  },
  playerB: {
    name: "BOREAS",
    color: "#4fa3d1",
    personality:
      "The Bluffer: create uncertainty, represent strength selectively, and exploit opponents who fold.",
    strategy: { aggression: 0.6, bluffRate: 0.8, callThreshold: 0.5 },
  },
  playerC: {
    name: "CIPHER",
    color: "#c2568f",
    personality:
      "The Mathematician: prioritize hand strength, pot odds, and evidence over emotion or table theatrics.",
    strategy: { aggression: 0.35, bluffRate: 0.05, callThreshold: 0.6 },
  },
};

export function initialPlayers(overrideStrategy?: Strategy): PlayerState[] {
  return (Object.keys(PERSONAS) as PlayerId[]).map((id) => ({
    id,
    name: PERSONAS[id].name,
    model: config.models[id],
    personality: PERSONAS[id].personality,
    color: PERSONAS[id].color,
    chips: STARTING_CHIPS,
    strategy: { ...(overrideStrategy ?? PERSONAS[id].strategy) },
    strategyHistory: [],
  }));
}
