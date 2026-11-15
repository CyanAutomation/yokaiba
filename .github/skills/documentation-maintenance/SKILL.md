---
name: documentation-maintenance
description: Use when changing repository Markdown, documentation validation, local link checking, or external documentation link checks.
---

# Documentation maintenance

Use this skill for contributor docs, README examples, repository skills, or the scripts and workflows that validate documentation.

## Keep documentation executable and linked

- Read [local development](../../../docs/development.md) for the documented validation commands and [API usage](../../../docs/api-usage.md) or [operations and deployment](../../../docs/operations-and-deployment.md) for the relevant product contract.
- `npm run docs:check` runs Markdown lint and `scripts/check-docs.ts`. The local checker validates relative Markdown links and heading anchors in `README.md`, `docs/**/*.md`, and `.github/skills/**/*.md`, and verifies that every documented `npm run` command exists in `package.json`.
- `npm run docs:links` checks external links from the README and is separate because third-party sites can be temporarily unavailable. Use it for external-link workflow changes or when specifically validating external destinations.
- Keep examples accurate against their source contracts and tests. Public API examples must not expose puzzle solutions, credentials, or production secrets.
- Link to related repository guidance instead of copying long operational procedures into skills; update both when the underlying policy changes.

## Validate documentation changes

1. For documentation-only edits, run `npm run docs:check` and inspect any reported file and line.
2. For checker or workflow behavior changes, add or update a focused test in `tests/docs-check.test.ts` or `tests/external-doc-links.test.ts` before changing implementation.
3. Run the focused test and `npm run docs:check`; run `npm run docs:links` when changing external-link checking.
4. When examples describe behavior, update or add a contract test where practical so the example remains connected to the implementation.
