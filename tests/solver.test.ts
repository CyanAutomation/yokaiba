import assert from "node:assert/strict";
import test from "node:test";
import type { PuzzleTemplate } from "../src/domain/types.js";
import { countSolutions, MAX_SUPPORTED_ROWS } from "../src/constraints/solver.js";

test("solver handles the maximum supported row count", () => {
  assert.equal(MAX_SUPPORTED_ROWS, 5);
  const fiveRows: PuzzleTemplate = {
    id: "five-rows",
    title: "Five rows",
    baseCategory: "person",
    categories: [
      { id: "person", label: "Person", values: ["A", "B", "C", "D", "E"] },
      { id: "place", label: "Place", values: ["1", "2", "3", "4", "5"] },
    ],
  };

  assert.equal(countSolutions(fiveRows, [], 200), 120);
});

test("solver rejects a grid one row above the supported maximum", () => {
  const values = Array.from({ length: MAX_SUPPORTED_ROWS + 1 }, (_, index) => String(index + 1));
  const tooManyRows: PuzzleTemplate = {
    id: "too-many-rows",
    title: "Too many rows",
    baseCategory: "person",
    categories: [
      { id: "person", label: "Person", values },
      { id: "place", label: "Place", values: [...values] },
    ],
  };

  assert.throws(
    () => countSolutions(tooManyRows, []),
    new Error("MVP solver supports grids with 2 through 5 rows"),
  );
});
