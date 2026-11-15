---
name: feedback-data-lifecycle
description: Use when changing anonymous puzzle outcome events, difficulty feedback, their storage or retention, or the use of player data for calibration.
---

# Feedback and telemetry data lifecycle

Use this skill for changes spanning `POST /v1/events`, `POST /v1/feedback`, Analytics Engine, the `PUZZLE_FEEDBACK` D1 table, or analysis of player-submitted data.

## Read the contracts and policies

- Read [REST API usage](../../../docs/api-usage.md), [operations and deployment](../../../docs/operations-and-deployment.md), and [difficulty and calibration](../../../docs/difficulty-and-calibration.md).
- Inspect the relevant route, storage adapter, migration, OpenAPI schema, and tests before changing a payload or persistence rule.
- For public schemas, token behavior, or response compatibility, also follow the [API and MCP contracts skill](../api-mcp-contracts/SKILL.md). For Cloudflare bindings and migrations, also follow the [Cloudflare operations skill](../cloudflare-operations/SKILL.md).

## Keep trust and storage boundaries clear

- Require an unexpired, supported v4 puzzle token and derive puzzle identity, template, difficulty, model, and generation metadata from its signed claims. Treat gameplay measurements and completion state as self-reported; tokens can be reused and do not prove a person played or completed a puzzle.
- `/v1/events` is versioned aggregate telemetry written to Analytics Engine. Preserve schema-version validation and discard unsupported fields, seeds, and player identifiers. Analytics Engine uses adaptive sampling; interpret only supported aggregates as trends, not exact per-submission records.
- `/v1/feedback` stores ratings in D1 and is independent of event telemetry. Preserve UUID v4 idempotency behavior: an identical retry must not add a row, and reuse of a key with changed feedback must conflict.
- Minimize collected data. Do not add puzzle tokens, solutions, answer grids, IP addresses, names, email addresses, or player identifiers to persisted feedback or telemetry without an explicit product and privacy review.
- Keep the documented retention period and deletion process aligned with the D1 schema and operational procedure. Do not treat Analytics Engine as a D1 fallback or D1 as sampled telemetry.

## Validate data-path changes

1. Add focused route, schema, migration, or storage tests for the changed behavior before implementation.
2. Update both machine-readable contracts and API/operations documentation when public fields, storage, retention, or interpretation changes.
3. Run the focused tests. For broader validation when requested, use `npm test`, `npm run typecheck`, and `npm run build`.
4. Keep logical difficulty, deterministic generation audits, semantic wording review, and observed player outcomes as separate evidence. Do not retune difficulty thresholds from synthetic samples or sampled telemetry alone; use cohort analysis and held-out player outcomes.

Production D1 migrations and retention deletion commands affect external data. Run them only when the user explicitly asks for that operation.
