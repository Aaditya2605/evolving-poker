# Pioneer Adaptive Inference and model switching

Verified against Pioneer's official documentation on 2026-07-24.

## Bottom line

Yes, Pioneer can switch models, but Pioneer documents two different mechanisms:

1. **Adaptive Inference** improves a fine-tuned model by mining stored production traces and corrections, training and evaluating a new checkpoint, then serving the improved checkpoint behind the same model/project identity.
2. **Model Router (`pioneer/auto`)** chooses a potentially different underlying model for every request. It is currently documented for coding tasks and the Anthropic-compatible API.

For the demo, these should be presented as complementary layers, not as one feature:

> The poker agent changes its strategy from reflection traffic; Pioneer stores those traces for Adaptive Inference underneath it, while `pioneer/auto` can route each eligible inference to the model most likely to meet the quality bar.

Do not claim that Adaptive Inference itself autonomously changes between unrelated base-model families. The documentation supports checkpoint replacement within a trained model lineage; cross-family, per-request switching is the separate Model Router.

## Claim verification

| Claim | Finding | Official evidence |
| --- | --- | --- |
| Adaptive Inference exists | **Verified.** Pioneer calls it its continuous-improvement loop. | [Adaptive Inference guide](https://docs.pioneer.ai/guides/adaptive-inference), [Pioneer introduction](https://docs.pioneer.ai/introduction) |
| Mines failures/high-signal examples from live traffic | **Verified.** Pioneer says it monitors live inference traffic, identifies ambiguous/low-confidence/high-signal traces, and combines those with explicit feedback. | [Adaptive Inference guide](https://docs.pioneer.ai/guides/adaptive-inference) |
| Continuously retrains | **Verified with an important qualification.** Traces and corrections feed a later training cycle; a new checkpoint is trained and evaluated. The public docs do not publish a retraining cadence or a public API for starting/configuring an Adaptive Inference cycle. Custom schedules are Enterprise-only via the Pioneer team. | [Adaptive Inference guide](https://docs.pioneer.ai/guides/adaptive-inference) |
| Same endpoint while the model improves | **Verified.** Pioneer says the `model_id` continues to point to the same endpoint as the underlying checkpoint improves. A project endpoint also abstracts the training-job ID and can replace its active deployment without changing the application endpoint. | [Adaptive Inference guide](https://docs.pioneer.ai/guides/adaptive-inference), [Projects API](https://docs.pioneer.ai/api-reference/projects) |
| Automatically promotes the better checkpoint | **Official docs are internally inconsistent.** The page summary says promotion is automatic when performance improves, but the detailed workflow says the user controls promotion and reviews/deploys the best checkpoint. For the demo, say **"Pioneer evaluates and surfaces the improved checkpoint behind the same endpoint; promotion is gated"** unless the dashboard visibly confirms auto-promotion for this account. | [Adaptive Inference guide](https://docs.pioneer.ai/guides/adaptive-inference) |
| PDF report per run | **Verified as a product claim.** Pioneer says every Adaptive Inference run generates a PDF containing training data, eval deltas, rollout stages, and checkpoint history. The public API docs do not identify an endpoint or response field for downloading that PDF. | [Pioneer introduction](https://docs.pioneer.ai/introduction) |
| Evaluation before rollout | **Verified.** Pioneer documents held-out evaluation and F1, precision, and recall before promotion. | [Adaptive Inference guide](https://docs.pioneer.ai/guides/adaptive-inference), [Evaluations API](https://docs.pioneer.ai/api-reference/evaluations) |
| Pioneer can automatically switch model families | **Verified for Model Router, not Adaptive Inference.** With `model: "pioneer/auto"`, the router scores candidate models for each coding request and selects the cheapest model meeting the configured quality threshold. | [Model Router](https://docs.pioneer.ai/concepts/router) |

## Minimum documented integration

### A. Feed Adaptive Inference

Pioneer does not document a separate `enable_adaptive_inference` API flag. The public workflow is:

1. Start from a fine-tuned model; the guide explicitly lists training an initial NER or decoder model as the prerequisite.
2. Send inference through Pioneer (`POST /inference` or its compatible endpoint).
3. Keep persistence enabled. Pioneer stores inference input, output, and metadata by default for evaluation, clustering, and adapter training. **Do not send `store: false`** for production/reflection traffic intended to train the loop.
4. Submit explicit feedback using the returned `inference_id`.

Pioneer's two first-party pages currently disagree on the feedback body:

- the dedicated API reference requires `{"correction": {...}}`;
- the Adaptive Inference guide shows `{"verdict":"incorrect","corrected_output":{...}}`.

Use the dedicated API-reference shape first, but test it against the live API before the demo:

```bash
curl -X POST "https://api.pioneer.ai/inferences/$INFERENCE_ID/feedback" \
  -H "X-API-Key: $PIONEER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "correction": {
      "action": "fold",
      "reason": "Over-aggressive bluff into a polarized river range"
    }
  }'
```

Retrieve captured traffic with:

```bash
curl "https://api.pioneer.ai/inferences?model_id=$MODEL_ID&limit=50" \
  -H "X-API-Key: $PIONEER_API_KEY"
```

The guide says submitted corrections enter the next training cycle. It also says Adaptive Inference availability depends on plan and directs users to **Settings → Plan**; it does not show a dashboard toggle or activation API. Confirm entitlement/activation in the current Pioneer dashboard before claiming it is enabled.

Sources: [Adaptive Inference guide](https://docs.pioneer.ai/guides/adaptive-inference), [Inference persistence](https://docs.pioneer.ai/concepts/inference), [History and feedback API](https://docs.pioneer.ai/api-reference/inference/history).

### B. Keep a stable application endpoint while checkpoints change

Pioneer's Projects API is the explicit stable-indirection mechanism:

```bash
# Create once
curl -X POST https://api.pioneer.ai/projects \
  -H "X-API-Key: $PIONEER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"evolving-poker"}'

# Deploy/replace the active completed training job
curl -X POST "https://api.pioneer.ai/projects/$PROJECT_ID/deployments" \
  -H "X-API-Key: $PIONEER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"training_job_id\":\"$TRAINING_JOB_ID\"}"

# Application continues calling:
# POST https://api.pioneer.ai/projects/$PROJECT_ID/inference
```

Creating a new project deployment replaces the active model, and `GET /projects/:project_id/deployments` returns deployment history. The published Projects reference explicitly requires `text` and documents an encoder example, while only briefly saying decoder models use `task: "generate"`. It does not publish a complete decoder request example for this project endpoint, so do not invent one; validate the live decoder request shape first.

Source: [Projects API](https://docs.pioneer.ai/api-reference/projects).

### C. Let Pioneer switch model families per request

On the Anthropic-compatible API, send the router alias instead of pinning a concrete model:

```bash
curl -X POST https://api.pioneer.ai/v1/messages \
  -H "X-API-Key: $PIONEER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pioneer/auto",
    "max_tokens": 1024,
    "messages": [{"role":"user","content":"..."}]
  }'
```

The router:

- scores candidate models for every request;
- selects the cheapest candidate above the configured quality threshold;
- observes `max_regret`, `fallback`, and optional `allowed_models` controls;
- falls back without error if nothing qualifies or the router is unavailable.

Pioneer documents `pioneer/auto` specifically for **coding tasks** and **Anthropic-compatible requests**. There is no first-party evidence in the reviewed docs that the router is trained or supported for poker decisions. Treat using it for poker as a demo experiment that must be exercised live, not as a documented production guarantee.

Source: [Model Router](https://docs.pioneer.ai/concepts/router).

## Model identity and routing metadata

For routed requests, Pioneer documents:

- dashboard/history metadata at `inferences.metadata.model_routing` containing `selected_model`, `confidence`, `rule`, and savings;
- inference-detail routing fields including `selected_model`, `confidence`, `rule`, `savings_usd`, `savings_ratio`, and `reason_codes`;
- Anthropic-compatible response fields `pioneer_routed_model` and `pioneer_savings`, present in non-streaming bodies and streaming `message_start` frames.

The stable request-side identity is `pioneer/auto`; `pioneer_routed_model` is the concrete model that actually executed the request. Pioneer does **not** document that the standard top-level `model` field is rewritten to the routed backend. For a trustworthy demo UI, read `pioneer_routed_model` from the Anthropic-compatible response or correlate the `inference_id` with `GET /inferences/:id`/the dashboard; do not infer the backend from the ordinary `model` field without a live check.

Sources: [Model Router: routing decisions](https://docs.pioneer.ai/concepts/router), [Claude Code integration: response metadata](https://docs.pioneer.ai/claude-code).

## Demo-safe wording

Use:

> Every decision and reflection flows through Pioneer. Pioneer can route eligible calls across models, logs the selected model and confidence, and retains our correction traffic for Adaptive Inference. That loop trains and evaluates improved checkpoints underneath the same endpoint, with an auditable report and gated promotion.

Avoid:

- "Pioneer chooses every poker action" — the application agent still makes the decision.
- "Adaptive Inference automatically changes to any model" — cross-model selection is the separate Router.
- "The retrain has completed" unless a real training cycle/report is visible.
- "Promotion is fully automatic" unless the account's dashboard behavior confirms it; the current guide says both automatic promotion and user-controlled promotion.
