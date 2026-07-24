import { z } from "zod";
import type { ReflectionOutput } from "../../../shared/types.js";

const StrategyZ = z.object({
  aggression: z.number().min(0).max(1),
  bluffRate: z.number().min(0).max(1),
  callThreshold: z.number().min(0).max(1),
});

/**
 * MECHANICAL VALIDATION ONLY.
 *
 * There is deliberately no cap on step size, no one-dial-at-a-time rule, no
 * approval simulation and no anti-reversal rule. A model is allowed to swing
 * from 0.1 to 0.9 and back again. Chaos is the finding, not a bug — the metrics
 * layer measures oscillation instead of preventing it.
 */
export const ReflectionZ = z
  .object({
    change: z.boolean(),
    strategy: StrategyZ.optional(),
    reason: z.string().min(1).max(300),
    evidence: z.array(z.string()).max(10),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((o) => !o.change || !!o.strategy, {
    message: "strategy required when change=true",
  });

export interface ParseResult {
  ok: boolean;
  value?: ReflectionOutput;
  error?: string;
}

/** Strip markdown fences, isolate the JSON object, parse, then validate. */
export function parseReflection(raw: string): ParseResult {
  let text = (raw ?? "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return { ok: false, error: "no JSON object found in response" };
  }
  text = text.slice(start, end + 1);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `JSON.parse failed: ${(e as Error).message}` };
  }

  const result = ReflectionZ.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${path}${issue.message}` };
  }
  return { ok: true, value: result.data as ReflectionOutput };
}
