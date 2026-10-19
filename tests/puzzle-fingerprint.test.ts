import assert from "node:assert/strict";
import test from "node:test";
import { puzzleFingerprint } from "../src/api/puzzle-fingerprint.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";

test("the fingerprint is stable for identical generated puzzles and changes with puzzle identity inputs", async () => {
  const first = generatePuzzle(tournamentOrderTemplate, "fingerprint-stable");
  const replay = generatePuzzle(tournamentOrderTemplate, "fingerprint-stable");

  const fingerprint = await puzzleFingerprint(first);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(await puzzleFingerprint(replay), fingerprint);
  assert.notEqual(await puzzleFingerprint(generatePuzzle(tournamentOrderTemplate, "fingerprint-other-seed")), fingerprint);
  assert.notEqual(await puzzleFingerprint({ ...first, generatorVersion: `${first.generatorVersion}-changed` }), fingerprint);
  assert.notEqual(await puzzleFingerprint({ ...first, clues: first.clues.slice(1) }), fingerprint);
});
