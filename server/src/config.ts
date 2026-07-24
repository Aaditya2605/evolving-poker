import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PlayerId, PlayerState, Strategy } from "../../shared/types.js";
import { STARTING_CHIPS } from "../../shared/types.js";

const envFile = resolve(import.meta.dirname, "..", "..", ".env");
if (process.env.NODE_ENV !== "test" && existsSync(envFile)) process.loadEnvFile(envFile);

const env = (k: string, fallback = "") => process.env[k]?.trim() || fallback;
const pioneerApiKey = env("PIONEER_API_KEY");
const bandAgentKeys = {
  playerA: env("BAND_AGENT_A_API_KEY"),
  playerB: env("BAND_AGENT_B_API_KEY"),
  playerC: env("BAND_AGENT_C_API_KEY"),
} as Record<PlayerId, string>;
const bandRoomId = env("BAND_ROOM_ID");
const bandConfigured = !!bandRoomId && Object.values(bandAgentKeys).every(Boolean);

export const config = {
  pioneerMode: pioneerApiKey ? ("real" as const) : ("mock" as const),
  pioneerApiKey,
  bandMode: bandConfigured ? "unwired" : "local",
  bandConfigured,
  bandAgentKeys,
  bandRoomId,
  x402Mode: env("X402_MODE", "test") as "test" | "real",
  x402PriceUsd: Number(env("X402_PRICE_USD", "0.05")),
  x402PayTo: env("X402_PAY_TO"),
  port: Number(env("PORT", "8787")),
  models: {
    playerA: env("MODEL_A", "Qwen/Qwen3-4B-Instruct-2507"),
    playerB: env("MODEL_B", "openai/gpt-oss-20b"),
    playerC: env("MODEL_C", "deepseek-ai/DeepSeek-V3"),
  } as Record<PlayerId, string>,
};

export const REFLECT_TIMEOUT_MS = 20_000;

const PERSONAS: Record<PlayerId, { name: string; color: string; strategy: Strategy }> = {
  playerA: {
    name: "ATLAS",
    color: "#e0a33e",
    strategy: { aggression: 0.5, bluffRate: 0.2, callThreshold: 0.5 },
  },
  playerB: {
    name: "BOREAS",
    color: "#4fa3d1",
    strategy: { aggression: 0.5, bluffRate: 0.2, callThreshold: 0.5 },
  },
  playerC: {
    name: "CIPHER",
    color: "#c2568f",
    strategy: { aggression: 0.5, bluffRate: 0.2, callThreshold: 0.5 },
  },
};

export function initialPlayers(overrideStrategy?: Strategy): PlayerState[] {
  return (Object.keys(PERSONAS) as PlayerId[]).map((id) => ({
    id,
    name: PERSONAS[id].name,
    model: config.models[id],
    color: PERSONAS[id].color,
    chips: STARTING_CHIPS,
    strategy: { ...(overrideStrategy ?? PERSONAS[id].strategy) },
    strategyHistory: [],
  }));
}
