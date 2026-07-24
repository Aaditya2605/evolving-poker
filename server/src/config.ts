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
export interface BandAgentConfig {
  id: string;
  handle: string;
  key: string;
}

const bandAgent = (letter: string): BandAgentConfig => ({
  id: env(`BAND_AGENT_${letter}_ID`),
  handle: env(`BAND_AGENT_${letter}_HANDLE`).replace(/^@/, ""),
  key: env(`BAND_AGENT_${letter}_API_KEY`),
});
const bandAgents = {
  playerA: bandAgent("A"),
  playerB: bandAgent("B"),
  playerC: bandAgent("C"),
  playerD: bandAgent("D"),
} as Record<PlayerId, BandAgentConfig>;
const bandRoomId = env("BAND_ROOM_ID");
const bandConfigured =
  !!bandRoomId &&
  Object.values(bandAgents).every((agent) => !!agent.id && !!agent.handle && !!agent.key);
const configuredModels = {
  playerA: env("MODEL_A", "Qwen/Qwen3-8B"),
  playerB: env("MODEL_B", "claude-haiku-4-5"),
  playerC: env("MODEL_C", "meta-llama/Llama-3.1-8B-Instruct"),
  playerD: env("MODEL_D", "deepseek-ai/DeepSeek-V3"),
} as Record<PlayerId, string>;

export const config = {
  pioneerMode,
  pioneerApiKey,
  bandMode: bandConfigured ? "real" : "local",
  bandConfigured,
  bandAgents,
  bandRoomId,
  bandBaseUrl: env("BAND_BASE_URL", "https://app.band.ai/api/v1/agent"),
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
  playerD: {
    name: "DELTA",
    color: "#7f72d8",
    personality:
      "The Reader: observe opponent tendencies, wait for repeated evidence, then exploit predictable behavior.",
    strategy: { aggression: 0.5, bluffRate: 0.25, callThreshold: 0.5 },
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
