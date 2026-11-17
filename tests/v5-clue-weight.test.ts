import assert from "node:assert/strict";
import test from "node:test";
import type { Clue, ClueConstraint, DifficultyLevel } from "../src/domain/types.js";
import { v5ClueWeight } from "../src/generation/v5-clue-weight.js";

function clue(kind: ClueConstraint["kind"], id = `${kind}-clue-0`, leftCategory = "color", rightCategory = "pet"): Clue {
  const constraint: ClueConstraint = kind === "matches"
    ? { kind, subject: "Aki", category: leftCategory, value: "Red" }
    : kind === "notMatches"
      ? { kind, subject: "Aki", category: leftCategory, value: "Red" }
      : kind === "distance"
        ? { kind, left: { category: leftCategory, value: "Red" }, right: { category: rightCategory, value: "Cat" }, distance: 1 }
        : { kind, left: { category: leftCategory, value: "Red" }, right: { category: rightCategory, value: "Cat" } };
  return { id, text: "", constraint };
}

test("v5 beginner clue selection favors simpler and anchor-row clues", () => {
  const weight = (kind: ClueConstraint["kind"], level: DifficultyLevel, strategy = 0, id?: string) =>
    v5ClueWeight(clue(kind, id ?? `${kind}-candidate`), level, strategy, 4);

  assert.ok(weight("matches", 1) < weight("notMatches", 1));
  assert.ok(weight("notMatches", 1) < weight("sameRow", 1));
  assert.ok(weight("sameRow", 1) < weight("adjacent", 1));
  assert.ok(weight("adjacent", 1) < weight("before", 1));
  assert.ok(weight("before", 1) < weight("distance", 1));

  const anchorRow = weight("matches", 3, 2, "candidate-matches-color-row-2");
  const otherRow = weight("matches", 3, 2, "candidate-matches-color-row-1");
  assert.ok(anchorRow < weight("before", 3, 2));
  assert.ok(otherRow > weight("notMatches", 3, 2));
  assert.ok(weight("before", 3, 2) <= weight("distance", 3, 2));
  assert.ok(weight("distance", 3, 2) < weight("sameRow", 3, 2));
  assert.ok(weight("sameRow", 3, 2) < weight("adjacent", 3, 2));

  assert.equal(weight("sameRow", 4), weight("adjacent", 4));
  assert.ok(weight("adjacent", 4) < weight("before", 4));
  assert.ok(weight("sameRow", 5) < weight("distance", 5));
  assert.ok(weight("distance", 5) < weight("before", 5));
  assert.ok(weight("before", 5) < weight("adjacent", 5));
});

test("v5 expert strategies rotate relational priorities and favor cross-category ordering", () => {
  const weight = (kind: ClueConstraint["kind"], level: DifficultyLevel, strategy: number, rightCategory = "color") =>
    v5ClueWeight(clue(kind, `${kind}-candidate`, "color", rightCategory), level, strategy, 5);

  assert.ok(weight("sameRow", 6, 0) < weight("distance", 6, 0));
  assert.ok(weight("distance", 6, 4) < weight("sameRow", 6, 4));
  assert.ok(weight("sameRow", 6, 8) < weight("distance", 6, 8));
  assert.ok(weight("distance", 9, 0) < weight("sameRow", 9, 0));
  assert.ok(weight("distance", 9, 4) < weight("sameRow", 9, 4));
  assert.ok(weight("sameRow", 9, 8) < weight("distance", 9, 8));

  assert.ok(weight("before", 11, 4, "pet") < weight("before", 11, 4));
});
