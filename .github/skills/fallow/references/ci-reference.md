# Fallow CLI reference for this repository

This quick reference is checked against the Fallow version resolved by this repository's lockfile (currently 3.31.0). The installed binary's `--help` and `schema` output take precedence if the lockfile changes.

## Common commands

Run commands through the repository's local executable:

```sh
./node_modules/.bin/fallow --format json --quiet
./node_modules/.bin/fallow dead-code --format json --quiet
./node_modules/.bin/fallow dead-code --format json --quiet --unused-exports
./node_modules/.bin/fallow dupes --format json --quiet
./node_modules/.bin/fallow health --format json --quiet --explain
./node_modules/.bin/fallow audit --format json --quiet --base origin/main
```

- `fallow` runs the combined analysis.
- `dead-code` reports unused files, exports, types, and dependencies.
- `dupes` reports duplicated code.
- `health` reports complexity and health metrics.
- `audit` combines checks for changed files. Confirm the intended base ref exists first.
- `fix --dry-run --no-create-config` previews changes without creating a fallback config. The fix command can also modify configuration; inspect the full preview. Use `fix --yes --no-create-config` only after reviewing it and when applying changes is within the user's request.
- `schema` prints the CLI schema. Use it to inspect supported options and JSON envelopes for this installed version.

## JSON and exit status

Use `--format json --quiet` for machine-readable results. JSON is written to stdout; diagnostics remain on stderr. Preserve both streams and the process status.

- 0: analysis completed without an error-level finding.
- 1: findings or a requested gate failure; inspect the JSON report.
- 2: execution error, such as invalid configuration or parse failure.

Do not use `|| true` as a general wrapper. If CI must upload findings despite exit 1, handle that expected status explicitly and fail on execution errors or missing reports.

JSON result envelopes may include a top-level `kind`; use it to identify the result type. Consult `schema` rather than assuming that a field from another version exists.

## Scope flags

- `--changed-since REF`: limit findings to changed files since a Git ref. This is incremental review, not a full-project scan.
- `--production`: focus on production code and omit test/development analysis.
- Issue filters such as `--unused-exports` narrow the reported finding types.
- `--explain`: include metric definitions when supported by the selected command.
