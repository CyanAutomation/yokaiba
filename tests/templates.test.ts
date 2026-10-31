import assert from "node:assert/strict";
import test from "node:test";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { IJF_SENIOR_MENS_WEIGHT_CLASSES } from "../src/domain/ijf-weight-classes.js";

test("versioned tournament templates share the board while retaining generation metadata", () => {
  assert.deepEqual(tournamentOrderTemplate.categories, tournamentOrderV2Template.categories);
  assert.equal(tournamentOrderTemplate.metadata?.difficultyCalibration.requiresHumanSolve, undefined);
  assert.equal(tournamentOrderV2Template.metadata?.difficultyCalibration.requiresHumanSolve, true);
  assert.equal(tournamentOrderTemplate.id, "tournament-order-v1");
  assert.equal(tournamentOrderV2Template.id, "tournament-order-v2");
});

test("championship templates share their board structure and keep different result vocabularies", () => {
  assert.deepEqual(championshipBridgeTemplate.categories.slice(0, 3), championshipCircuitTemplate.categories.slice(0, 3));
  assert.deepEqual(championshipBridgeTemplate.categories[3]?.values, ["1st", "2nd", "3rd", "4th", "5th"]);
  assert.deepEqual(championshipCircuitTemplate.categories[3]?.values, ["Gold", "Silver", "Bronze", "Finalist", "Quarter-finalist"]);
  assert.deepEqual(championshipBridgeTemplate.metadata?.difficultyCalibration.levelRange, [8, 9]);
  assert.deepEqual(championshipCircuitTemplate.metadata?.difficultyCalibration.levelRange, [9, 12]);
});

// Template contract: docs/difficulty-and-calibration.md#clue-wording-compatibility.
test("every template publishes ordered, valid IJF weight divisions", () => {
  for (const template of [tournamentOrderTemplate, tournamentOrderV2Template, championshipBridgeTemplate, championshipCircuitTemplate, openDivisionTemplate]) {
    const weight = template.categories.find(category => category.id === "weight");
    assert.ok(weight, `${template.id} must expose a weight category`);
    assert.equal(weight.label, "Weight division", `${template.id} must use the public category label`);
    assert.equal(weight.ordered, true, `${template.id} must retain competition order`);
    assert.ok(weight.values.length > 0, `${template.id} must publish weight divisions`);
    assert.ok(weight.values.every(value => IJF_SENIOR_MENS_WEIGHT_CLASSES.includes(value as typeof IJF_SENIOR_MENS_WEIGHT_CLASSES[number])),
      `${template.id} must use valid IJF weight divisions`);
    assert.equal(new Set(weight.values).size, weight.values.length, `${template.id} must not repeat weight divisions`);
  }
});
