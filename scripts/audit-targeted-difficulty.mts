import { auditTargetedDifficultyCorpus } from "../src/generation/audit.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";

const rawSampleSize = process.argv[2];
const sampleSize = rawSampleSize === undefined ? undefined : Number(rawSampleSize);
if (sampleSize !== undefined && (!Number.isInteger(sampleSize) || sampleSize < 1)) throw new Error("usage: npm run audit:difficulty:targeted -- [positive sample size]");

const audit = [tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate]
  .map(template => auditTargetedDifficultyCorpus(template, { sampleSize }));
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), audit }, null, 2));
