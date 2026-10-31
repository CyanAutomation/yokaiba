import assert from "node:assert/strict";
import test from "node:test";
import type { PuzzleTemplate } from "../src/domain/types.js";
import { countSolutions, MAX_SUPPORTED_ROWS, satisfiesConstraint } from "../src/constraints/solver.js";

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

// Solver contract: docs/development.md#solver-internals.
test("solver rejects grids above the documented five-row maximum", () => {
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

test("constraint evaluation accepts matching relations and rejects mismatches", () => {
  const spec: PuzzleTemplate = {
    id: "constraint-relations",
    title: "Constraint relations",
    baseCategory: "person",
    categories: [
      { id: "person", label: "Person", values: ["A", "B", "C"] },
      { id: "color", label: "Color", values: ["Red", "Green", "Blue"] },
    ],
  };
  const solution = { assignments: { color: ["Red", "Green", "Blue"] } };
  const term = (category: string, value: string) => ({ category, value });
  const cases = [
    ["matches", { kind: "matches", subject: "A", category: "color", value: "Red" }, true],
    ["matches", { kind: "matches", subject: "A", category: "color", value: "Green" }, false],
    ["notMatches", { kind: "notMatches", subject: "A", category: "color", value: "Green" }, true],
    ["notMatches", { kind: "notMatches", subject: "A", category: "color", value: "Red" }, false],
    ["before", { kind: "before", left: term("person", "A"), right: term("person", "B") }, true],
    ["before", { kind: "before", left: term("person", "B"), right: term("person", "A") }, false],
    ["adjacent", { kind: "adjacent", left: term("person", "A"), right: term("person", "B") }, true],
    ["adjacent", { kind: "adjacent", left: term("person", "A"), right: term("person", "C") }, false],
    ["sameRow", { kind: "sameRow", left: term("person", "A"), right: term("color", "Red") }, true],
    ["sameRow", { kind: "sameRow", left: term("person", "A"), right: term("color", "Green") }, false],
    ["distance", { kind: "distance", left: term("person", "A"), right: term("color", "Green"), distance: 1 }, true],
    ["distance", { kind: "distance", left: term("person", "A"), right: term("color", "Red"), distance: 1 }, false],
  ] as const;

  for (const [kind, constraint, expected] of cases) {
    assert.equal(satisfiesConstraint(spec, solution, constraint), expected, `${kind} should evaluate to ${expected}`);
  }
});
