import assert from "node:assert/strict";
import test from "node:test";
import { renderClues } from "../src/generation/clue-text.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";

test("distance clue variants state the exact place difference directly", () => {
  const clue = {
    id: "tatami-distance",
    constraint: {
      kind: "distance" as const,
      left: { category: "tatami", value: "Tatami 4" },
      right: { category: "placing", value: "3rd" },
      distance: 1,
    },
    text: "",
  };
  const variants = new Set<string>();

  for (const seed of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]) {
    const rendered = renderClues(tournamentOrderTemplate, seed, [clue])[0]!;
    variants.add(rendered.phraseVariant!);
    assert.match(rendered.text, /competitor on Tatami 4.*competitor who finished 3rd/);
    assert.match(rendered.text, /exactly one place apart/);
    assert.match(rendered.text, /tournament order/);
    assert.doesNotMatch(rendered.text, /positions of .* differed by exactly/);
  }

  assert.deepEqual(variants, new Set(["distance-0", "distance-1"]));
});
