import assert from "node:assert/strict";
import test from "node:test";
import { removeTermFromRows, type PossibleRows } from "../src/generation/human-deduction-rules.js";

test("removing a term ignores row indices outside the possibility array", () => {
  const possible: PossibleRows = new Map([["color", [new Set(["Red"])]]]);

  assert.equal(removeTermFromRows("color", "Red", new Set([-1, 0, 1]), "person", possible), true);
  assert.deepEqual([...possible.get("color")![0]!], []);
});
