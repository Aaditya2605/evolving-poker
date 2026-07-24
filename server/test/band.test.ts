import { afterEach, describe, expect, it, vi } from "vitest";
import { RealBandRouter } from "../src/comm/band.js";
import { Trace } from "../src/comm/trace.js";
import { config } from "../src/config.js";

const originalRoom = config.bandRoomId;
const originalAgents = structuredClone(config.bandAgents);

afterEach(() => {
  config.bandRoomId = originalRoom;
  Object.assign(config.bandAgents, originalAgents);
  vi.unstubAllGlobals();
});

describe("Band routing", () => {
  it("publishes as the acting agent with the other three agents mentioned", async () => {
    config.bandRoomId = "room-1";
    for (const [index, id] of Object.keys(config.bandAgents).entries()) {
      config.bandAgents[id as keyof typeof config.bandAgents] = {
        id: `id-${index}`,
        handle: `agent-${index}`,
        key: `key-${index}`,
      };
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const trace = new Trace();
    const router = new RealBandRouter(trace);
    router.send("playerA", "all", "turn_action", { action: "raise" });
    await router.close();

    expect(trace.all()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/chats/room-1/messages");
    expect(init.headers).toMatchObject({ "X-API-Key": "key-0" });
    const body = JSON.parse(String(init.body));
    expect(body.message.mentions).toHaveLength(3);
    expect(body.message.mentions.map((mention: { id: string }) => mention.id)).not.toContain("id-0");
  });
});
