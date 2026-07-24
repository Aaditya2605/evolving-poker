import type { TraceMessage } from "../../../shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function fetchTrace(): Promise<TraceMessage[] | null> {
  try {
    const res = await fetch("/api/trace", { cache: "no-store" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (Array.isArray(body)) return body as TraceMessage[];
    if (isRecord(body) && Array.isArray(body.trace)) {
      return body.trace as TraceMessage[];
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchCited(): Promise<string | null> {
  try {
    const res = await fetch("/api/cited", { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
      try {
        const body: unknown = JSON.parse(trimmed);
        if (isRecord(body)) {
          for (const key of ["markdown", "content", "cited", "text"]) {
            const value = body[key];
            if (typeof value === "string") return value;
          }
        }
      } catch {
        // fall through to raw text
      }
    }
    return text;
  } catch {
    return null;
  }
}
