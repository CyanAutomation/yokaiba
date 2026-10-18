import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseWranglerDeploymentUrl } from "../scripts/deployment-output.js";

test("deployment output parser selects the last direct Worker deployment", () => {
  const output = [
    JSON.stringify({ type: "upload" }),
    JSON.stringify({
      type: "deploy",
      worker_name: "yokaiba",
      targets: ["https://yokaiba.workers.dev"],
    }),
    JSON.stringify({
      type: "deploy",
      worker_name: "yokaiba",
      targets: ["http://localhost:8787", "https://yokaiba-new.workers.dev"],
    }),
  ].join("\n");

  assert.equal(parseWranglerDeploymentUrl(output), "https://yokaiba-new.workers.dev");
});

test("deployment output parser skips blank lines between Wrangler records", () => {
  const output = [
    JSON.stringify({ type: "upload" }),
    "",
    JSON.stringify({
      type: "deploy",
      worker_name: "yokaiba",
      targets: ["https://yokaiba.workers.dev"],
    }),
  ].join("\n");

  assert.equal(parseWranglerDeploymentUrl(output), "https://yokaiba.workers.dev");
});

test("deployment output parser rejects missing deployment records", () => {
  assert.throws(() => parseWranglerDeploymentUrl(JSON.stringify({ type: "upload" })), /did not write machine-readable deployment information/);
});

test("deployment output parser rejects an unexpected Worker name", () => {
  const output = JSON.stringify({ type: "deploy", worker_name: "other-worker", targets: ["https://yokaiba.workers.dev"] });
  assert.throws(() => parseWranglerDeploymentUrl(output), /deployed unexpected Worker/);
});

test("deployment output parser requires exactly one HTTPS workers.dev target", () => {
  const noDirectTarget = JSON.stringify({ type: "deploy", worker_name: "yokaiba", targets: ["http://yokaiba.workers.dev"] });
  const multipleDirectTargets = JSON.stringify({
    type: "deploy",
    worker_name: "yokaiba",
    targets: ["https://one.workers.dev", "https://two.workers.dev"],
  });

  assert.throws(() => parseWranglerDeploymentUrl(noDirectTarget), /Expected exactly one direct workers.dev deployment target/);
  assert.throws(() => parseWranglerDeploymentUrl(multipleDirectTargets), /Expected exactly one direct workers.dev deployment target/);
});

test("deployment output parser rejects malformed machine-readable output", () => {
  assert.throws(() => parseWranglerDeploymentUrl("not json"), /invalid machine-readable deployment information/);
});

test("deployment output entry point writes the validated URL to the workflow output file", () => {
  const directory = mkdtempSync(join(tmpdir(), "deployment-output-test-"));
  const wranglerOutputPath = join(directory, "wrangler-output.jsonl");
  const githubOutputPath = join(directory, "github-output");
  writeFileSync(wranglerOutputPath, `${JSON.stringify({
    type: "deploy",
    worker_name: "yokaiba",
    targets: ["https://yokaiba.workers.dev"],
  })}\n`);
  writeFileSync(githubOutputPath, "");

  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/record-deployment-output.mts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_OUTPUT_FILE_PATH: wranglerOutputPath,
        GITHUB_OUTPUT: githubOutputPath,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(githubOutputPath, "utf8"), "deployment_url=https://yokaiba.workers.dev\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
