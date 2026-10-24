---
name: difficulty-calibration
description: Use when changing Yokaiba difficulty scoring, deduction traces, clue selection, difficulty audits, calibration reports, or semantic clue review.
---

# Difficulty and clue audits

Use this skill for difficulty-model code in src/generation, audit scripts, calibration reports, and semantic clue-language evaluation.

## Read the evidence rules

Start with [Difficulty and calibration](../../../docs/difficulty-and-calibration.md). Check the current model version, default selection policy, template-specific rules, and report schema before changing behavior; these can evolve.

- Deterministic seed samples measure implementation behavior and target availability. They are not player research.
- The no-guess trace is a bounded engineering model. It does not prove human solvability or measure human inference depth.
- Score bands and thresholds documented as provisional must not be retuned from model-to-model comparisons alone. Use held-out player outcomes for calibration.
- Keep logical difficulty, semantic wording review, and observed player outcomes as separate evidence sources.

## Make changes safely

1. Add a focused test for the scoring or trace behavior before implementation.
2. Preserve stable clue ordering, seed replay, and model/version metadata in audit outputs and puzzle identity.
3. Keep checkpoint compatibility explicit. Resume only when the saved model and schema are compatible; use a new output path when regeneration under a new model is needed.
4. Update the guide and report metadata when the model, selection policy, audit schema, or interpretation changes.

Useful scripts include npm run audit:difficulty, npm run audit:difficulty:targeted, npm run audit:difficulty:v5, and npm run audit:jev. These can be expensive; run them when requested or when they are necessary to validate a change, and choose an output path that will not overwrite useful reports.

Semantic model review may send clue text to an external service. Run it only when the task requires semantic evaluation, use credentials supplied in the invoking environment, and never copy secrets into source files or reports. A missing or unavailable review is not evidence that wording is correct.

For solver, template, and deterministic-generation invariants, also follow the puzzle-engine skill.
