import assert from "node:assert/strict";
import test from "node:test";
import { validateSoyuzBaseUrl } from "../scripts/validate-soyuz-url.js";
import { validateSoyuzRunId } from "../scripts/validate-soyuz-run-id.js";

test("Soyuz base URL accepts only the approved service origin", () => {
  assert.equal(validateSoyuzBaseUrl("https://soyuz.scheimann.workers.dev"), "https://soyuz.scheimann.workers.dev");
  assert.equal(validateSoyuzBaseUrl("https://soyuz.scheimann.workers.dev/"), "https://soyuz.scheimann.workers.dev");

  for (const value of [
    undefined,
    "",
    " https://soyuz.scheimann.workers.dev",
    "http://soyuz.scheimann.workers.dev",
    "https://soyuz.scheimann.workers.dev.attacker.example",
    "https://soyuz.scheimann.workers.dev/path",
    "https://soyuz.scheimann.workers.dev/?token=secret",
    "https://soyuz.scheimann.workers.dev/#fragment",
    "https://user:pass@soyuz.scheimann.workers.dev",
  ]) {
    assert.throws(() => validateSoyuzBaseUrl(value), `expected rejection for ${String(value)}`);
  }
});

test("Soyuz run ID accepts UUIDv7 values and rejects other or malformed IDs", () => {
  const runId = "018f47c2-5e8a-7abc-8def-0123456789ab";
  assert.equal(validateSoyuzRunId(runId), runId);
  assert.equal(validateSoyuzRunId(runId.toUpperCase()), runId.toUpperCase());

  for (const value of [undefined, "", "not-a-run-id", "018f47c2-5e8a-4abc-8def-0123456789ab", "../../etc/passwd"]) {
    assert.throws(() => validateSoyuzRunId(value), `expected rejection for ${String(value)}`);
  }
});
