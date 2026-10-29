import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("deployment smoke probe uses a stable public generation example", async () => {
  const smokeScript = await readFile(new URL("../scripts/smoke-deployment.mts", import.meta.url), "utf8");

  assert.match(smokeScript, /templateId=tournament-order-v2&seed=first-puzzle/);
  assert.doesNotMatch(smokeScript, /templateId=tournament-order-v1&seed=deployment-smoke/);
});
