import assert from "node:assert/strict";
import test from "node:test";
import { publicPuzzleFields, publicSelectionDiagnostics } from "../src/api/public-puzzle.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";

test("public puzzle projection strips answer-bearing and unknown future fields", () => {
  const generated = generatePuzzle(tournamentOrderV2Template, "public-projection-contract", undefined, { difficultyModel: "v5" });
  const withInternalFields = Object.assign(generated, {
    answer: generated.solution,
    trace: { steps: [{ placements: [{ category: "placing", row: 0, value: "1st" }] }] },
    selectionDiagnostics: {
      modelVersion: "yokaiba-difficulty-v5",
      strategyBudget: 12,
      strategiesAttempted: 1,
      eligibleCandidates: 1,
      answer: generated.solution,
    },
  });
  Object.assign(withInternalFields.difficultyProfile!.logical, {
    answer: generated.solution,
    internalAudit: { steps: [{ placements: [{ category: "placing", row: 0, value: "1st" }] }] },
  });

  const publicPuzzle = publicPuzzleFields(withInternalFields);

  assert.equal(Object.hasOwn(publicPuzzle, "solution"), false);
  assert.equal(Object.hasOwn(publicPuzzle, "answer"), false);
  assert.equal(Object.hasOwn(publicPuzzle, "trace"), false);
  assert.equal(Object.hasOwn(publicPuzzle.difficultyProfile!.logical, "answer"), false);
  assert.equal(Object.hasOwn(publicPuzzle.difficultyProfile!.logical, "internalAudit"), false);
  assert.equal(Object.hasOwn(publicPuzzle.selectionDiagnostics!, "answer"), false);
  assert.equal("steps" in publicPuzzle.difficultyProfile!.logical.trace, false);
  assert.equal(typeof publicPuzzle.difficultyProfile!.logical.trace.maximumDependencyDepth, "number");
});

test("public selection diagnostics retain safe error summaries and strip unknown fields", () => {
  const diagnostics = {
    modelVersion: "yokaiba-difficulty-v5",
    strategiesAttempted: 3,
    eligibleCandidates: 0,
    reason: "no_candidate_in_band",
    fallbackSeedsAttempted: 2,
    answer: { assignments: { placing: ["1st", "2nd"] } },
    candidateScoreRange: {
      minimum: 21,
      maximum: 68,
      complete: 3,
      incomplete: 0,
      trace: { steps: [{ placements: [{ category: "placing", value: "1st" }] }] },
    },
  } as const;

  assert.deepEqual(publicSelectionDiagnostics(diagnostics), {
    modelVersion: "yokaiba-difficulty-v5",
    strategiesAttempted: 3,
    eligibleCandidates: 0,
    reason: "no_candidate_in_band",
    fallbackSeedsAttempted: 2,
    candidateScoreRange: { minimum: 21, maximum: 68, complete: 3, incomplete: 0 },
  });
});
