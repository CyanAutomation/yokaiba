---
name: puzzle-engine
description: Use when changing Yokaiba's puzzle solver, deterministic generation, templates, clue constraints, solution uniqueness, or replay behavior.
---

# Puzzle engine changes

Use this skill for changes under src/constraints, src/domain, src/generation, and src/templates, and for tests that define their behavior.

## Read the contracts first

- Read [the solver internals guide](../../../docs/development.md#solver-internals) and [API usage and versioning](../../../docs/api-usage.md).
- For difficulty-model behavior, also use the difficulty-calibration skill and [its guide](../../../docs/difficulty-and-calibration.md).

## Preserve these invariants

- Template IDs are public, versioned contracts. If a template correction changes its values or generated output, introduce a new template ID instead of silently changing the existing one.
- Seeded generation must remain reproducible. Keep random choices, ordering, and strategy selection deterministic, and retain version metadata needed to replay a puzzle.
- The exhaustive solver remains the authority for correctness and uniqueness. Preserve clue semantics, solution-limit behavior, and deterministic solution ordering.
- The built-in solver supports grids with 2–5 rows. Do not imply support outside that range without extending and validating the solver.
- Public puzzle responses must not expose the hidden solution.

## Work test-first

1. Identify the existing contract and the narrowest affected module.
2. Add or update a focused test that demonstrates the desired behavior or catches the regression.
3. Implement the change, then run the focused test. For behavior changes, run the repository test suite and typecheck when validation is requested or required by the task.
4. Update API, template, or development documentation if a public or contributor-facing contract changed.

Use tests in tests/solver.test.ts, tests/puzzle-generator.test.ts, tests/templates.test.ts, and related generation tests as applicable. For output-distribution changes, use the deterministic audit scripts only when the request calls for an audit; those reports do not establish human difficulty.

If a change alters REST or MCP behavior, also follow the api-mcp-contracts skill.
