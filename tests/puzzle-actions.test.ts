import assert from "node:assert/strict";
import test from "node:test";
import { puzzleHint } from "../src/api/puzzle-actions.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";

test("placement hints reject puzzles without a non-base category", () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "empty-category-hint");
  puzzle.spec = {
    ...puzzle.spec,
    categories: puzzle.spec.categories.filter(category => category.id === puzzle.spec.baseCategory),
  };

  assert.throws(
    () => puzzleHint(puzzle, "placement"),
    /No non-base categories available for placement hints/,
  );
});

test("clue and elimination hints reject puzzles without clues", () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "empty-clue-hint");
  puzzle.clues = [];

  assert.throws(() => puzzleHint(puzzle, "clue"), /No clues available for hints/);
  assert.throws(() => puzzleHint(puzzle, "elimination"), /No clues available for hints/);
});
