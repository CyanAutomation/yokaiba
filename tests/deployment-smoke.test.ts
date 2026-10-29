import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("deployment smoke probe uses a build-specific public generation seed", async () => {
  const smokeScript = await readFile(new URL("../scripts/smoke-deployment.mts", import.meta.url), "utf8");

  assert.match(smokeScript, /const smokeSeed = `deployment-smoke-\$\{expectedBuildSha\}`;/);
  assert.match(smokeScript, /const smokeTemplateIds = \["tournament-order-v2", "tournament-order-v1"\] as const;/);
  assert.match(smokeScript, /const candidateSeed = attempt === 0 \? smokeSeed : `\$\{smokeSeed\}-\$\{attempt\}`;/);
  assert.match(smokeScript, /const candidatePath = `\/v1\/puzzles\/generate\?templateId=\$\{templateId\}&seed=\$\{encodeURIComponent\(candidateSeed\)\}`;/);
  assert.match(smokeScript, /for \(let attempt = 0; attempt < 5; attempt \+= 1\)/);
  assert.doesNotMatch(smokeScript, /seed=first-puzzle/);
});
