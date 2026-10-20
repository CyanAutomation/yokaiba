import assert from "node:assert/strict";
import test from "node:test";
import type { ClueConstraint, PuzzleTemplate } from "../src/domain/types.js";
import { CLUE_LANGUAGE_VERSION } from "../src/generation/clue-text.js";
import { renderConstraintText, renderDistanceConstraintText } from "../src/generation/clue-language.js";

const template: PuzzleTemplate = {
  id: "clue-language-test",
  title: "  Spring   Cup ",
  baseCategory: "person",
  categories: [
    { id: "person", label: "Person", values: ["Aki", "Ben"] },
    { id: "weight", label: "Weight", values: ["-60 kg", "-70 kg"] },
    { id: "tatami", label: "Tatami", values: ["Tatami 1", "Tatami 2"] },
    { id: "medal", label: "Medal", values: ["Gold", "Silver"] },
  ],
};

test("clue language renders every constraint kind in clear prose", () => {
  const weight = { category: "weight", value: "-60 kg" };
  const tatami = { category: "tatami", value: "Tatami 2" };
  const cases: Array<[ClueConstraint, number, string]> = [
    [{ kind: "matches", subject: "Aki", category: "weight", value: "-60 kg" }, 0, "Aki fought in the -60 kg division."],
    [{ kind: "notMatches", subject: "Ben", category: "medal", value: "Silver" }, 0, "Ben did not win the silver medal."],
    [{ kind: "sameRow", left: weight, right: tatami }, 0, "The -60 kg competitor competed on Tatami 2."],
    [{ kind: "sameRow", left: weight, right: { category: "medal", value: "Bronze" } }, 0, "The -60 kg competitor won the bronze medal."],
    [{ kind: "before", left: weight, right: tatami }, 0, "In the event order, the -60 kg competitor came before the competitor on Tatami 2."],
    [{ kind: "adjacent", left: weight, right: tatami }, 1, "No judoka appeared between the -60 kg competitor and the competitor on Tatami 2 in the event order."],
    [{ kind: "distance", left: weight, right: tatami, distance: 1 }, 0, "In the event order, the -60 kg competitor and the competitor on Tatami 2 were exactly one position apart."],
  ];

  for (const [constraint, index, expected] of cases) {
    assert.equal(renderConstraintText(template, constraint, index), expected);
  }
});

test("clue language varies repeated wording and handles less common categories", () => {
  const medalAndResult: ClueConstraint = {
    kind: "sameRow",
    left: { category: "medal", value: "Gold" },
    right: { category: "placing", value: "1st" },
  };
  const longDistance: ClueConstraint = {
    kind: "distance",
    left: { category: "result", value: "Finalist" },
    right: { category: "tatami", value: "Tatami 1" },
    distance: 5,
  };
  const titledOrder = { ...template, title: "Judo Cup Order" };

  assert.equal(renderConstraintText(template, medalAndResult, 1), "1st place went to the gold medallist.");
  assert.equal(renderConstraintText(titledOrder, { kind: "before", left: medalAndResult.left, right: medalAndResult.right }, 1), "The gold medallist appeared before the competitor who finished 1st in the event order.");
  assert.equal(renderConstraintText(template, longDistance, 1), "The competitor who finished Finalist and the competitor on Tatami 1 were exactly 5 positions apart in the event order.");
});

test("distance clues state how many positions apart the named competitors finished", () => {
  const left = { category: "weight", value: "-60 kg" };
  const right = { category: "tatami", value: "Tatami 2" };

  assert.equal(renderConstraintText(template, { kind: "distance", left, right, distance: 1 }, 0),
    "In the event order, the -60 kg competitor and the competitor on Tatami 2 were exactly one position apart.");
  assert.equal(renderConstraintText(template, { kind: "distance", left, right, distance: 2 }, 0),
    "In the event order, the -60 kg competitor and the competitor on Tatami 2 were exactly two positions apart.");
  assert.equal(renderConstraintText(template, { kind: "distance", left, right, distance: 3 }, 1),
    "The -60 kg competitor and the competitor on Tatami 2 were exactly three positions apart in the event order.");
});

test("v11 names event-order positions and retains between-count wording for paired review", () => {
  assert.equal(CLUE_LANGUAGE_VERSION, "yokaiba-clue-prose-v11");

  const constraint = { kind: "distance", left: { category: "weight", value: "-60 kg" }, right: { category: "tatami", value: "Tatami 2" }, distance: 3 } as const;
  assert.equal(renderDistanceConstraintText(template, constraint, 0, "between-count"),
    "In the spring cup order, exactly two competitors finished between the -60 kg competitor and the competitor on Tatami 2.");
  assert.equal(renderDistanceConstraintText(template, constraint, 0, "places-apart"),
    "In the event order, the -60 kg competitor and the competitor on Tatami 2 were exactly three positions apart.");
  assert.equal(renderDistanceConstraintText(template, { ...constraint, distance: 1 }, 1, "places-apart"),
    "The -60 kg competitor and the competitor on Tatami 2 were exactly one position apart in the event order.");
  assert.equal(renderConstraintText(template, constraint, 0),
    "In the event order, the -60 kg competitor and the competitor on Tatami 2 were exactly three positions apart.");
});
