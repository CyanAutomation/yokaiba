import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("deployment smoke probe uses a build-specific public generation seed", async () => {
  const smokeScript = await readFile(new URL("../scripts/smoke-deployment.mts", import.meta.url), "utf8");

  assert.match(smokeScript, /templateId=tournament-order-v2&seed=\$\{encodeURIComponent\(smokeSeed\)\}/);
  assert.match(smokeScript, /const smokeSeed = `deployment-smoke-\$\{expectedBuildSha\}`;/);
  assert.doesNotMatch(smokeScript, /seed=first-puzzle/);
});
