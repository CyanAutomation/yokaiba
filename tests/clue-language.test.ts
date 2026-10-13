import assert from "node:assert/strict";
import test from "node:test";
import type { ClueConstraint, PuzzleTemplate } from "../src/domain/types.js";
import { renderConstraintText } from "../src/generation/clue-language.js";

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
    [{ kind: "notMatches", subject: "Ben", category: "medal", value: "Silver" }, 0, "Ben did not win Silver."],
    [{ kind: "sameRow", left: weight, right: tatami }, 0, "The -60 kg competitor competed on Tatami 2."],
    [{ kind: "before", left: weight, right: tatami }, 0, "In the spring cup order, the -60 kg competitor came before the competitor on Tatami 2."],
    [{ kind: "adjacent", left: weight, right: tatami }, 1, "In the spring cup order, the -60 kg competitor was immediately next to the competitor on Tatami 2."],
    [{ kind: "distance", left: weight, right: tatami, distance: 1 }, 0, "In the spring cup order, the -60 kg competitor and the competitor on Tatami 2 were exactly one place apart."],
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
  assert.equal(renderConstraintText(titledOrder, { kind: "before", left: medalAndResult.left, right: medalAndResult.right }, 1), "In the judo cup order, the gold medallist was earlier than the competitor who finished 1st.");
  assert.equal(renderConstraintText(template, longDistance, 1), "the competitor who finished Finalist and the competitor on Tatami 1 were exactly 5 places apart in the spring cup order.");
});
