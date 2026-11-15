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

test("v5 clue weights preserve calibrated beginner and anchor-row priorities", () => {
  const cases: { level: DifficultyLevel; kind: ClueConstraint["kind"]; expected: number }[] = [
    { level: 1, kind: "matches", expected: 0 },
    { level: 1, kind: "notMatches", expected: 7 },
    { level: 1, kind: "before", expected: 32 },
    { level: 1, kind: "adjacent", expected: 27 },
    { level: 1, kind: "sameRow", expected: 22 },
    { level: 1, kind: "distance", expected: 41 },
    { level: 3, kind: "matches", expected: 0 },
    { level: 3, kind: "notMatches", expected: 30 },
    { level: 3, kind: "before", expected: 6 },
    { level: 3, kind: "adjacent", expected: 12 },
    { level: 3, kind: "sameRow", expected: 8 },
    { level: 3, kind: "distance", expected: 6 },
    { level: 4, kind: "sameRow", expected: 6 },
    { level: 4, kind: "adjacent", expected: 6 },
    { level: 4, kind: "before", expected: 12 },
    { level: 5, kind: "sameRow", expected: 6 },
    { level: 5, kind: "distance", expected: 9 },
    { level: 5, kind: "adjacent", expected: 18 },
  ];

  for (const { level, kind, expected } of cases) {
    const candidate = clue(kind, kind === "matches" ? "candidate-matches-color-row-2" : `${kind}-candidate`);
    const strategy = level === 3 ? 2 : 0;
    assert.equal(v5ClueWeight(candidate, level, strategy, 4), expected, `${kind} at level ${level}`);
  }
  assert.equal(v5ClueWeight(clue("matches", "candidate-matches-color-row-1"), 3, 2, 4), 36);
  assert.equal(v5ClueWeight(clue("matches", "candidate-matches-color-row-0"), 5, 0, 4), 0);
  assert.equal(v5ClueWeight(clue("notMatches"), 5, 0, 4), 30);
  assert.equal(v5ClueWeight(clue("matches", "candidate-matches-color-row-0"), 4, 0, 4), 0);
});

test("v5 clue weights preserve deterministic expert profiles and cross-category ordering", () => {
  const cases: { level: DifficultyLevel; strategy: number; kind: ClueConstraint["kind"]; expected: number }[] = [
    { level: 6, strategy: 0, kind: "distance", expected: 11 },
    { level: 6, strategy: 4, kind: "distance", expected: 3 },
    { level: 6, strategy: 8, kind: "sameRow", expected: 0 },
    { level: 9, strategy: 0, kind: "distance", expected: 5 },
    { level: 9, strategy: 4, kind: "before", expected: 6 },
    { level: 9, strategy: 8, kind: "sameRow", expected: 0 },
    { level: 12, strategy: 0, kind: "distance", expected: 5 },
    { level: 11, strategy: 4, kind: "before", expected: -2 },
  ];

  for (const { level, strategy, kind, expected } of cases) {
    const crossesCategories = level === 11 && kind === "before";
    assert.equal(v5ClueWeight(clue(kind, `${kind}-expert`, "color", crossesCategories ? "pet" : "color"), level, strategy, 5), expected);
  }
  assert.equal(v5ClueWeight(clue("before", "before-expert", "color", "color"), 11, 4, 5), 6);
});
