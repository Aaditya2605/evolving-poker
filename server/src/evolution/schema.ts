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
 *
 * The repairs below are the other half of that stance: they fix TRANSPORT
 * defects (a number sent as a string, evidence sent bare instead of wrapped)
 * without touching the model's judgement. Nothing here changes what a model
 * decided — only whether we could read it. Every repair is recorded, because
 * which model needed which repair is itself a finding.
 */
export const ReflectionZ = z
  .object({
    change: z.boolean(),
    strategy: StrategyZ.optional(),
    reason: z.string().min(1).max(300),
    evidence: z.array(z.string()).max(10),
    confidence: z.number().min(0).max(1).optional(),
    nextModel: z.string().min(1).max(160).optional(),
  })
  .refine((o) => !o.change || !!o.strategy, {
    message: "strategy required when change=true",
  });

export interface ParseResult {
  ok: boolean;
  value?: ReflectionOutput;
  error?: string;
  /** Local coercions applied. Each one is a retry we did not have to spend. */
  repairs: string[];
}

const MAX_REASON = 300;

/**
 * First COMPLETE top-level object, tracking string literals and escapes.
 *
 * The naive first-`{`-to-last-`}` slice fails on the two things models actually
 * do: emit a second object after the first, and write prose containing a brace.
 */
export function extractFirstObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth === 0) continue; // stray closer in prose
      depth--;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
    }
  }
  return null;
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim().replace(/%$/, "");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

function repairShape(input: unknown, repairs: string[]): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const o = { ...(input as Record<string, unknown>) };

  if (typeof o.change === "string") {
    const lowered = o.change.trim().toLowerCase();
    if (lowered === "true" || lowered === "false") {
      o.change = lowered === "true";
      repairs.push(`change: string "${lowered}" coerced to boolean`);
    }
  }

  if (o.strategy && typeof o.strategy === "object" && !Array.isArray(o.strategy)) {
    const s = { ...(o.strategy as Record<string, unknown>) };
    for (const dial of ["aggression", "bluffRate", "callThreshold"] as const) {
      if (typeof s[dial] === "string") {
        const n = asNumber(s[dial]);
        if (n !== null) {
          s[dial] = n;
          repairs.push(`strategy.${dial}: string coerced to number`);
        }
      }
    }
    o.strategy = s;
  }

  if (typeof o.confidence === "string") {
    const n = asNumber(o.confidence);
    if (n !== null) {
      o.confidence = n;
      repairs.push("confidence: string coerced to number");
    }
  }

  if (typeof o.evidence === "string") {
    o.evidence = [o.evidence];
    repairs.push("evidence: bare string wrapped in array");
  }

  if (typeof o.reason === "string" && o.reason.length > MAX_REASON) {
    o.reason = `${o.reason.slice(0, MAX_REASON - 1)}…`;
    repairs.push(`reason: truncated to ${MAX_REASON} chars`);
  }

  // Keeping a strategy alongside change:false is the single most common way a
  // model contradicts itself. `change` is the decision; the strategy is dropped.
  if (o.change === false && o.strategy !== undefined) {
    delete o.strategy;
    repairs.push("strategy dropped: change was false");
  }

  return o;
}

/** Strip markdown fences, isolate the JSON object, repair, then validate. */
export function parseReflection(raw: string): ParseResult {
  const repairs: string[] = [];
  let text = (raw ?? "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  const isolated = extractFirstObject(text);
  if (isolated === null) {
    return { ok: false, error: "no JSON object found in response", repairs };
  }
  if (isolated.length !== text.length) {
    repairs.push("isolated first complete JSON object from surrounding text");
  }

  let json: unknown;
  try {
    json = JSON.parse(isolated);
  } catch (e) {
    return { ok: false, error: `JSON.parse failed: ${(e as Error).message}`, repairs };
  }

  const repaired = repairShape(json, repairs);

  const result = ReflectionZ.safeParse(repaired);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${path}${issue.message}`, repairs };
  }
  return { ok: true, value: result.data as ReflectionOutput, repairs };
}
