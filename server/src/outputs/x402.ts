import type { Hono } from "hono";
import type { AuditPack } from "../../../shared/types.js";
import { config } from "../config.js";

/**
 * Free tier: the spectator UI and cited.md. Paid tier: the full audit pack —
 * every event, every raw model response, the Band trace, and all token/cost data.
 *
 * TODO(event): if real x402 middleware is provided, mount it on this route and
 * delete `acceptsTestHeader`. Nothing else in the codebase touches payment.
 */
export function mountAudit(app: Hono, getPack: () => AuditPack | null): void {
  app.get("/audit", (c) => {
    const proof = c.req.header("X-PAYMENT");

    if (!accepts(proof)) {
      return c.json(
        {
          error: "payment_required",
          message: "The full audit pack is a paid resource.",
          price: { amount: config.x402PriceUsd, currency: "USD" },
          payTo: config.x402PayTo || null,
          accepts: [{ scheme: "x402", network: "base-sepolia", asset: "USDC" }],
          howToPay:
            config.x402Mode === "test"
              ? "Development mode: retry with header `X-PAYMENT: test-ok`."
              : "Retry with a valid x402 payment proof in the `X-PAYMENT` header.",
          freeTier: ["/", "/api/cited", "/api/trace"],
        },
        402,
      );
    }

    const pack = getPack();
    if (!pack) {
      return c.json({ error: "not_ready", message: "No completed tournament yet." }, 409);
    }
    return c.json(pack);
  });
}

function accepts(proof: string | undefined): boolean {
  if (!proof) return false;
  if (config.x402Mode === "test") return proof === "test-ok";
  // Real mode: the middleware validates before this handler runs.
  return true;
}
