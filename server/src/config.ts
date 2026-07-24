import type { PlayerId, PlayerState, Strategy } from "../../shared/types.js";
import { STARTING_CHIPS } from "../../shared/types.js";

const env = (k: string, fallback = "") => process.env[k]?.trim() || fallback;

export const config = {
  pioneerMode: env("PIONEER_MODE", "mock") as "mock" | "real",
  pioneerBaseUrl: env("PIONEER_BASE_URL"),
  pioneerApiKey: env("PIONEER_API_KEY"),
  bandMode: env("BAND_MODE", "local") as "local" | "real",
  bandApiKey: env("BAND_API_KEY"),
  bandRoom: env("BAND_ROOM", "evolving-poker"),
  x402Mode: env("X402_MODE", "test") as "test" | "real",
  x402PriceUsd: Number(env("X402_PRICE_USD", "0.05")),
  x402PayTo: env("X402_PAY_TO"),
  port: Number(env("PORT", "8787")),
  pricingRaw: env("PIONEER_PRICING"),
  models: {
    playerA: env("MODEL_A", "qwen2.5-7b-instruct"),
    playerB: env("MODEL_B", "gpt-oss-20b"),
    playerC: env("MODEL_C", "deepseek-v3"),
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
