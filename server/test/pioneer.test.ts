import { afterEach, describe, expect, it, vi } from "vitest";
import { PioneerAdapter } from "../src/evolution/pioneer.js";

afterEach(() => vi.unstubAllGlobals());

describe("Pioneer adapter", () => {
  it("uses the supported completion payload and Pioneer inference metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "chat-id",
        model: "requested-model",
        choices: [{ message: { content: '{"action":"check"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
        x_pioneer: { inference_id: "inference-id", routed_model: "served-model" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new PioneerAdapter().act("playerA", "prompt", {
      handId: 1,
      model: "requested-model",
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));

    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({
      inferenceId: "inference-id",
      servedModel: "served-model",
      inputTokens: 10,
      outputTokens: 4,
    });
  });
});
