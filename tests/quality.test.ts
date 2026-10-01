import assert from "node:assert/strict";
import test from "node:test";
import {
  DIFFICULTY_MODEL_VERSION,
  type Clue,
  type PuzzleTemplate,
} from "../src/index.js";
import { evaluateHumanDeductionTrace } from "../src/generation/quality.js";

const spec: PuzzleTemplate = {
  id: "deduction-scoring-fixture",
  title: "Deduction scoring fixture",
  baseCategory: "person",
  categories: [
    { id: "person", label: "Person", values: ["Aki", "Ben"] },
    { id: "color", label: "Color", values: ["Red", "Blue"] },
  ],
};

const directClue: Clue = {
  id: "aki-red",
  constraint: { kind: "matches", subject: "Aki", category: "color", value: "Red" },
  text: "Aki wore red.",
};

test(`deduction total cost is additive under ${DIFFICULTY_MODEL_VERSION}`, () => {
  const beforeClue: Clue = {
    id: "aki-before-ben",
    constraint: {
      kind: "before",
      left: { category: "person", value: "Aki" },
      right: { category: "person", value: "Ben" },
    },
    text: "Aki finished before Ben.",
  };

  const trace = evaluateHumanDeductionTrace(spec, [directClue, beforeClue]);

  // Numeric contract: yokaiba-difficulty-v4 assigns costs 1 (matches) + 3 (before).
  assert.equal(trace.totalCost, 4);
});

test(`deduction hardest step uses the maximum clue cost under ${DIFFICULTY_MODEL_VERSION}`, () => {
  const distanceClue: Clue = {
    id: "aki-two-from-ben",
    constraint: {
      kind: "distance",
      left: { category: "person", value: "Aki" },
      right: { category: "person", value: "Ben" },
      distance: 2,
    },
    text: "Aki finished two places from Ben.",
  };

  const trace = evaluateHumanDeductionTrace(spec, [directClue, distanceClue]);

  // Numeric contract: yokaiba-difficulty-v4 assigns distance the maximum cost, 4.
  assert.equal(trace.hardestStep, 4);
});

test(`deduction passes include the convergence check under ${DIFFICULTY_MODEL_VERSION}`, () => {
  const trace = evaluateHumanDeductionTrace(spec, [directClue]);

  // Calibration reference: yokaiba-difficulty-v4 counts one changing pass and one stable pass.
  assert.equal(trace.deductionPasses, 2);
});

test("relational deductions preserve ordering, adjacency, same-row, and exact-distance propagation", () => {
  const threeRows: PuzzleTemplate = {
    ...spec,
    categories: [
      { id: "person", label: "Person", values: ["Aki", "Ben", "Cia"] },
      { id: "color", label: "Color", values: ["Red", "Green", "Blue"] },
    ],
  };
  const red = (kind: "before" | "adjacent" | "sameRow" | "distance", distance?: number): Clue => ({
    id: `red-${kind}`,
    constraint: kind === "distance"
      ? { kind, left: { category: "person", value: "Aki" }, right: { category: "color", value: "Red" }, distance: distance! }
      : { kind, left: { category: "person", value: kind === "sameRow" ? "Aki" : "Ben" }, right: { category: "color", value: "Red" } },
    text: "A relational clue.",
  });
  const benGreen: Clue = {
    id: "ben-green",
    constraint: { kind: "matches", subject: "Ben", category: "color", value: "Green" },
    text: "Ben was associated with green.",
  };
  const beforeBenRed: Clue = {
    id: "ben-before-red",
    constraint: { kind: "before", left: { category: "person", value: "Ben" }, right: { category: "color", value: "Red" } },
    text: "Ben finished before red.",
  };

  for (const clues of [
    [red("before"), benGreen],
    [red("adjacent"), beforeBenRed, benGreen],
    [red("sameRow"), benGreen],
    [red("distance", 2), benGreen],
  ]) {
    assert.equal(evaluateHumanDeductionTrace(threeRows, clues).solved, true);
  }
});
