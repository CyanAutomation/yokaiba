import { auditDifficultyCorpus } from "../src/generation/audit.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";

const rawSampleSize = process.argv[2];
const sampleSize = rawSampleSize === undefined ? undefined : Number(rawSampleSize);
if (sampleSize !== undefined && (!Number.isInteger(sampleSize) || sampleSize < 1)) throw new Error("usage: npm run audit:difficulty -- [positive sample size]");

const audit = [tournamentOrderTemplate, openDivisionTemplate, championshipCircuitTemplate]
  .map(template => auditDifficultyCorpus(template, { sampleSize }));
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), audit }, null, 2));
