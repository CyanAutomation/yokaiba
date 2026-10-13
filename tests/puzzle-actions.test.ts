import assert from "node:assert/strict";
import test from "node:test";
import { puzzleHint } from "../src/api/puzzle-hints.js";
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

test("hints reject a puzzle with no available clues", () => {
  const generated = generatePuzzle(tournamentOrderTemplate, "empty-clue-hint");
  const puzzle = { ...generated, clues: [] };

  for (const kind of ["clue", "elimination"] as const) {
    assert.throws(() => puzzleHint(puzzle, kind), /No clues available for hints/);
  }
});
