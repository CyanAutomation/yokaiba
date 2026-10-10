import assert from "node:assert/strict";
import test from "node:test";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";

test("versioned tournament templates share the board while retaining generation metadata", () => {
  assert.deepEqual(tournamentOrderTemplate.categories, tournamentOrderV2Template.categories);
  assert.notStrictEqual(tournamentOrderTemplate.categories, tournamentOrderV2Template.categories);
  assert.equal(tournamentOrderTemplate.metadata?.difficultyCalibration.requiresHumanSolve, undefined);
  assert.equal(tournamentOrderV2Template.metadata?.difficultyCalibration.requiresHumanSolve, true);
  assert.equal(tournamentOrderTemplate.id, "tournament-order-v1");
  assert.equal(tournamentOrderV2Template.id, "tournament-order-v2");
});

test("championship templates share their board structure and keep different result vocabularies", () => {
  assert.deepEqual(championshipBridgeTemplate.categories.slice(0, 3), championshipCircuitTemplate.categories.slice(0, 3));
  assert.notStrictEqual(championshipBridgeTemplate.categories, championshipCircuitTemplate.categories);
  assert.deepEqual(championshipBridgeTemplate.categories[3]?.values, ["1st", "2nd", "3rd", "4th", "5th"]);
  assert.deepEqual(championshipCircuitTemplate.categories[3]?.values, ["Gold", "Silver", "Bronze", "Finalist", "Quarter-finalist"]);
  assert.deepEqual(championshipBridgeTemplate.metadata?.difficultyCalibration.levelRange, [8, 9]);
  assert.deepEqual(championshipCircuitTemplate.metadata?.difficultyCalibration.levelRange, [9, 12]);
});
