# Fallow workflows for Yokaiba

## Full repository review

```sh
./node_modules/.bin/fallow dead-code --format json --quiet
./node_modules/.bin/fallow dupes --format json --quiet
./node_modules/.bin/fallow health --format json --quiet --explain
```

Read the issue arrays and analysis status. Trace potentially used exports, files, and dependencies before proposing removal.

## Review changed code

```sh
./node_modules/.bin/fallow audit --format json --quiet --base origin/main
```

Confirm `origin/main` is present and current. This audit is scoped to changed files; it does not establish that the rest of the project is clean.

## Preview and apply cleanup

```sh
./node_modules/.bin/fallow fix --dry-run --no-create-config --format json --quiet
```

Review the proposed changes and the user's request. If applying them is authorized, run:

```sh
./node_modules/.bin/fallow fix --yes --no-create-config --format json --quiet
```

Then inspect the working-tree diff and report the exact removals. If the request was only to audit, stop at the preview.

## Investigate a finding

Use the installed CLI's `--help` or `schema` output to discover trace options available in the locked version. Trace the export, file, or dependency before concluding it is unused. Check dynamic loading, entry points, tests, scripts, and generated-code conventions.

## CI quality gate

Keep report generation, gate status, and report upload as distinct steps. A gate finding may return exit 1; allow that status only when a valid report was produced. Fail on exit 2, malformed JSON, or a missing report. Do not use a blanket `|| true` that also suppresses analyzer failures.
