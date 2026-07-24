# Sponsor integration research

Verified against official documentation on 2026-07-24.

## Recommended environment surface

Keep service URLs in code because all three vendors publish fixed production
URLs. The smallest honest runtime configuration is:

```env
PIONEER_API_KEY=

# Only needed when Band is enabled:
BAND_ROOM_ID=
BAND_AGENT_A_API_KEY=
BAND_AGENT_B_API_KEY=
BAND_AGENT_C_API_KEY=
```

Key presence can select real versus local behavior without separate mode
switches. The base URLs are not user-specific configuration. Replay QA requires
no application runtime variable for its stand-alone or GitHub workflows.

## Pioneer

- REST API base: `https://api.pioneer.ai`
- OpenAI-compatible base: `https://api.pioneer.ai/v1`
- This repo's completion endpoint:
  `POST https://api.pioneer.ai/v1/chat/completions`
- Authentication: `X-API-Key: $PIONEER_API_KEY`, including on the
  OpenAI-compatible endpoint. Pioneer explicitly documents `PIONEER_API_KEY`
  as the environment-variable name.
- Package: none is required here. Pioneer supports OpenAI-compatible clients,
  but the repo already uses Node's native `fetch`, which is sufficient.
- Model IDs should not be guessed or frozen from examples. Query
  `GET https://api.pioneer.ai/base-models?supports_inference=true` with the same
  header and select decoder models supported by the account.

Minimal request matching this repo:

```ts
await fetch("https://api.pioneer.ai/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.PIONEER_API_KEY!,
  },
  body: JSON.stringify({ model, messages }),
});
```

Repo implication: `PIONEER_BASE_URL` can be removed from user configuration and
the existing `Authorization: Bearer ...` header must become `X-API-Key`.

Sources:

- [Pioneer API overview](https://docs.pioneer.ai/api-reference/overview)
- [Pioneer quickstart, including OpenAI-compatible request](https://docs.pioneer.ai/quickstart)
- [Pioneer authentication](https://docs.pioneer.ai/authentication)

## Band

### Official surfaces

- Request API base: `https://app.band.ai/api/v1`
- Agent REST base: `https://app.band.ai/api/v1/agent`
- WebSocket base:
  `wss://app.band.ai/api/v1/socket/websocket`
- Authentication for a remote agent:
  `X-API-Key: <agent-specific-api-key>`. The key identifies the agent; it is
  returned once when a human registers that remote agent.
- Official SDK package: the documented SDK is the **Python** package
  `band-sdk`, imported as `band`. Its minimal lifecycle is
  `Agent.create(adapter=..., agent_id=..., api_key=...)` followed by
  `await agent.run()`.
- The official docs do not document a JavaScript/npm SDK. The repo's dynamic
  `import("band-sdk")` is therefore not a valid Node integration. For this
  TypeScript repo, native `fetch` plus a WebSocket client is the minimum
  documented path and adds no dependency beyond the already-installed `ws`.

### What real player-to-player routing requires

Band messages are identity-scoped and require at least one `@mention`.
`BAND_ROOM` cannot be a friendly room name; API paths require the room UUID.
A shared room must contain the three registered remote agents. Each player must
send using its own agent API key:

```http
POST https://app.band.ai/api/v1/agent/chats/{room_uuid}/messages
X-API-Key: <sending-player-agent-key>
Content-Type: application/json

{
  "message": {
    "content": "@PlayerB ...",
    "mentions": [
      { "id": "<player-b-uuid>", "name": "PlayerB", "handle": "playerb" }
    ]
  }
}
```

Participant IDs, names, and handles can be loaded from
`GET /agent/chats/{room_uuid}/participants`; they do not need separate
environment variables. For live inbound routing, agents must subscribe over
the WebSocket at
`wss://app.band.ai/api/v1/socket/websocket?api_key={agent_key}&vsn=2.0.0`,
join `chat_room:{room_uuid}` using the Phoenix Channels wire format, and send a
heartbeat every 30 seconds. `GET /messages/next` is only for startup/crash
recovery, not polling.

One `BAND_API_KEY` can only publish as one Band identity. Posting the local
trace through one key would be an audit mirror, not communication among three
players. Likewise, send-only REST calls do not make Band the transport while
the tournament continues to make every decision in-process.

Sources:

- [Band Request API overview](https://docs.band.ai/api/request-api-overview)
- [Band Agent API](https://docs.band.ai/api/agent-api)
- [Band agent messages](https://docs.band.ai/api/agent-api/agent-api-messages)
- [Band Subscriptions API](https://docs.band.ai/websocket/overview)
- [Band SDK reference](https://docs.band.ai/integrations/sdks/reference)
- [Band SDK setup](https://docs.band.ai/integrations/sdks/tutorials/setup)

## Replay QA

Replay QA is external QA, not an in-app publishing or recording SDK.

The minimum workflow for this React spectator app is:

1. Run or deploy the web app at a URL Replay can reach.
2. Submit that URL at `https://qa.replay.io/`.
3. Prefer a build with source maps so reports point to original source.

That stand-alone flow needs no API key, package, test suite, application
environment variable, or repository configuration. For continuous checks,
connect the GitHub repository from the Replay QA project and authorize the
GitHub App; Replay says no CI workflow file is required.

There is an optional automation API at
`https://loop-qa.replay.io/api/v1`, authenticated with
`Authorization: Bearer lqa_...`. It is unnecessary unless this repo later
automates project creation and report ingestion. A localhost-only app can use
the API's documented reverse-proxy setup.

Source:

- [Replay QA overview](https://docs.replay.io/basics/replay-qa/overview)
