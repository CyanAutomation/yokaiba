---
name: github-actions-policy
description: Use when changing GitHub Actions workflows, reusable validation, scheduled agent jobs, Dependabot configuration, or actionlint setup in this repository.
---

# GitHub Actions policy

Use this skill for changes under .github/workflows, .github/dependabot.yml, or .github/actionlint.

## Preserve repository controls

- Reuse the shared validation workflow where appropriate. It runs actionlint, docs checks, typecheck, and tests.
- Keep runner images explicitly versioned and third-party actions pinned to full commit SHAs with readable release comments. Keep the actionlint image pinned by digest.
- Keep permissions minimal, disable persisted checkout credentials unless needed, and scope secrets to the job or protected environment that uses them.
- Production deployment must remain restricted to main and the protected production environment. Keep the build version/SHA checks and canonical endpoint smoke and contract checks.
- Kaseki jobs must remain main-only, use the approved exact HTTPS controller origin, serialize against each other, and validate terminal run status within the documented timeout. Do not add a public fallback URL or expose controller response bodies containing sensitive data.
- Keep Dependabot coverage for GitHub Actions, npm packages, and the actionlint image.

## Test workflow changes

Inspect the workflow's triggers, permissions, concurrency, environment, secret scope, timeout, and failure behavior. Add or update validation for any changed policy. Run the shared workflow checks locally where available, including actionlint and the documented docs, typecheck, and test commands.

Changes to GitHub environment protection, repository rules, or secret values are configured in GitHub and are not implemented by editing workflow YAML alone. Do not deploy or call external agent services just to validate a workflow edit.
