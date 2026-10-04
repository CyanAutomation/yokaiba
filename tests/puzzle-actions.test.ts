import assert from "node:assert/strict";
import test from "node:test";
import { puzzleHint } from "../src/api/puzzle-actions.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";

test("clue and elimination hints never contain a solution placement", () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "spoiler-safe-hint");
  for (const kind of ["clue", "elimination"] as const) {
    const hint = puzzleHint(puzzle, kind);
    assert.equal("placement" in hint, false);
    assert.deepEqual(Object.keys(hint).sort(), ["clue", "kind"]);
  }
});

test("clue and elimination hints reject puzzles without clues", () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "empty-clue-hint");
  puzzle.clues = [];

  assert.throws(() => puzzleHint(puzzle, "clue"), /No clues available for hints/);
  assert.throws(() => puzzleHint(puzzle, "elimination"), /No clues available for hints/);
});
