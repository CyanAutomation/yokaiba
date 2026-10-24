# Fallow gotchas

## Use the locked executable

This repository includes Fallow as a dev dependency. Run `./node_modules/.bin/fallow` after dependencies are installed. Check the local version before relying on options from online documentation.

## Keep findings separate from execution errors

Exit code 1 can mean the analysis found issues or a requested gate failed. Read the JSON. Exit code 2 means analysis failed; keep stderr and report the error. Never hide all nonzero statuses with `|| true`.

## Changed-file analysis is partial

`--changed-since REF` filters results to changed files. Use an unscoped run for a full audit, and confirm the Git ref exists before treating an empty result as clean.

## Production mode omits development code

`--production` excludes test and development files and dependencies. It is not appropriate when the user asks for a whole-repository cleanup review.

## Static reachability has blind spots

Dynamic imports, plugin registration, generated assets, reflection, and runtime loading can make used code look unreachable. Trace a finding and inspect project conventions before removing it.

## Fixes can create or modify configuration

`fix --dry-run --no-create-config` previews proposed changes while preventing fallback config creation. Review source and configuration changes before applying. Use `--no-create-config` when config changes are outside the request. A report can be incomplete if analysis itself failed.

## Security results are candidates

Fallow's security rules are deterministic and intentionally limited. Validate a reported path in context; do not describe it as a confirmed vulnerability without independent evidence.

## Keep configuration and privacy choices explicit

Do not add remote config inheritance or enable telemetry. Treat runtime coverage uploads, source-map uploads, and cloud inventory as separate integrations that require an explicit request.
