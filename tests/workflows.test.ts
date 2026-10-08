import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseYamlDocument } from "./helpers/yaml.js";

// Workflow behavior contracts are documented in README.md#github-workflow-policy.
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts?: Record<string, string>;
};

type Workflow = Record<string, any>;

function readWorkflow(name: string): Workflow {
  return parseYamlDocument(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));
}

function getJob(workflow: Workflow, name: string): Workflow {
  const job = workflow.jobs?.[name] as Workflow | undefined;
  assert.ok(job, `workflow must define job ${name}`);
  return job;
}

function getRunStep(workflow: Workflow, jobName: string, stepName: string): string {
  const step = getJob(workflow, jobName).steps.find((candidate: Workflow) => candidate.name === stepName) as Workflow | undefined;
  assert.ok(step?.run, `${jobName} must define the ${stepName} run step`);
  return step.run as string;
}

function validateControllerUrl(script: string, url: string) {
  return spawnSync("bash", ["--noprofile", "--norc", "-e", "-u", "-o", "pipefail", "-c", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", KASEKI_BASE_URL: url },
  });
}

function runKasekiPoll(script: string, status: string, timeoutSeconds: number) {
  const directory = mkdtempSync(join(tmpdir(), "kaseki-poll-test-"));
  const bin = join(directory, "bin");
  const outputPath = join(directory, "github-output");
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(bin, "jq"), "#!/bin/sh\nprintf '%s\\n' \"$KASEKI_TEST_STATUS\"\n", { mode: 0o700 });

  try {
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-u", "-o", "pipefail", "-c", script], {
      encoding: "utf8",
      timeout: 5_000,
      env: {
        PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        KASEKI_API_TOKEN: "test-token",
        KASEKI_BASE_URL: "https://kaseki-tunnel.scheimann.xyz",
        RUN_ID: "test-run",
        GITHUB_OUTPUT: outputPath,
        KASEKI_TEST_STATUS: status,
        KASEKI_POLL_TIMEOUT_SECONDS: String(timeoutSeconds),
      },
    });
    if (result.error) throw result.error;
    return {
      ...result,
      githubOutput: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertKasekiTokenScope(workflow: Workflow, jobName: string): void {
  const currentJob = getJob(workflow, jobName);
  assert.equal(currentJob.env?.KASEKI_API_TOKEN, undefined, `${jobName} must not expose the token job-wide`);
  const tokenSteps = currentJob.steps.filter((step: Workflow) =>
    step.env?.KASEKI_API_TOKEN === "${{ secrets.KASEKI_API_TOKEN }}",
  );
  assert.deepEqual(tokenSteps.map((step: Workflow) => step.id ?? step.name), [
    "Verify gateway connectivity and authentication",
    "submit",
    "wait",
  ]);
}

// Workflow policy: README.md#github-workflow-policy.
test("Kaseki validation workflows invoke scripts declared by this package", () => {
  for (const name of ["kaseki-docs.yaml", "kaseki-dry.yaml"]) {
    const workflow = readWorkflow(name);
    const job = Object.values(workflow.jobs ?? {}).find((candidate: any) => candidate.env?.VALIDATION_COMMAND) as Workflow | undefined;
    const command = workflow.env?.VALIDATION_COMMAND ?? job?.env?.VALIDATION_COMMAND;

    assert.ok(command, `${name} must define VALIDATION_COMMAND`);

    const scripts = [
      ...[...command.matchAll(/\bnpm run ([\w:-]+)/g)].map((match) => match[1]),
      ...[...command.matchAll(/\bnpm (?!run\b)([\w:-]+)/g)].map((match) => match[1]),
    ];
    assert.ok(scripts.length > 0, `${name} must run at least one npm script`);

    for (const script of scripts) {
      assert.ok(packageJson.scripts?.[script], `${name} references missing npm script "${script}"`);
    }
  }
});

test("Kaseki workflows only run from main and submit the main branch ref", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");

  assert.equal(getJob(dry, "dry_sweep").if, "github.ref == 'refs/heads/main'");
  assert.equal(getJob(docs, "docs_sweep").if, "github.ref == 'refs/heads/main'");
  assert.equal(getJob(dry, "dry_sweep").env.REF, "main");
  assert.equal(docs.env.REF, "main");

  const submissions = [
    getRunStep(dry, "dry_sweep", "Submit DRY sweep"),
    getRunStep(docs, "docs_sweep", "Submit documentation sweep"),
  ];
  for (const submission of submissions) {
    assert.match(submission, /--arg ref "\$REF"/);
    assert.match(submission, /ref: \$ref/);
  }
});

test("Kaseki sweeps share one concurrency group and remain main-only", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");

  assert.equal(dry.concurrency.group, "kaseki-sweeps-${{ github.repository }}");
  assert.equal(docs.concurrency.group, dry.concurrency.group);
  assert.equal(dry.concurrency["cancel-in-progress"], false);
  assert.equal(docs.concurrency["cancel-in-progress"], false);
  assert.equal(getJob(dry, "dry_sweep").if, "github.ref == 'refs/heads/main'");
  assert.equal(getJob(docs, "docs_sweep").if, "github.ref == 'refs/heads/main'");
});

// Controller allowlist contract: README.md#github-workflow-policy.
test("Kaseki sweep validation accepts the approved controller and rejects lookalike URLs", () => {
  for (const [name, jobName, stepName] of [
    ["kaseki-dry.yaml", "dry_sweep", "Validate Kaseki configuration"],
    ["kaseki-docs.yaml", "docs_sweep", "Validate Kaseki controller URL"],
  ]) {
    const script = getRunStep(readWorkflow(name), jobName, stepName);

    assert.equal(validateControllerUrl(script, "https://kaseki-tunnel.scheimann.xyz").status, 0, name);
    for (const url of [
      "https://attacker.example",
      "https://kaseki-tunnel.scheimann.xyz.attacker.example",
      "http://kaseki-tunnel.scheimann.xyz",
    ]) {
      assert.notEqual(validateControllerUrl(script, url).status, 0, `${name} accepted ${url}`);
    }
  }
});

test("Kaseki sweeps request standard pull requests, never drafts, and cap diffs", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");
  const drySubmission = getRunStep(dry, "dry_sweep", "Submit DRY sweep");
  const docsSubmission = getRunStep(docs, "docs_sweep", "Submit documentation sweep");

  for (const submission of [drySubmission, docsSubmission]) {
    assert.match(submission, /publishMode:\s*"pr"/);
    assert.match(submission, /maxDiffBytes:\s*102400/);
    assert.doesNotMatch(submission, /\bdraft(?:_pr)?\b/i);
  }
});

test("Kaseki submissions reuse an idempotency key when a workflow run is rerun", () => {
  for (const [name, jobName, stepName] of [
    ["kaseki-docs.yaml", "docs_sweep", "Submit documentation sweep"],
    ["kaseki-dry.yaml", "dry_sweep", "Submit DRY sweep"],
  ]) {
    const workflow = readWorkflow(name);
    const submission = getRunStep(workflow, jobName, stepName);

    assert.match(submission, /uuidgen --sha1 --namespace @dns --name "\$GITHUB_REPOSITORY:\$GITHUB_WORKFLOW:\$GITHUB_RUN_ID"/);
    assert.match(submission, /--arg idempotencyKey "\$idempotency_key"/);
    assert.doesNotMatch(submission, /\/proc\/sys\/kernel\/random\/uuid|uuidgen \| tr/);
  }
});

// Polling contract: README.md#github-workflow-policy.
test("Kaseki sweeps stop on terminal results and respect the polling deadline", () => {
  for (const [name, jobName] of [["kaseki-docs.yaml", "docs_sweep"], ["kaseki-dry.yaml", "dry_sweep"]]) {
    const workflow = readWorkflow(name);
    const waitJob = getJob(workflow, jobName).steps.find((step: Workflow) => step.name === "Wait for Kaseki completion") as Workflow | undefined;
    assert.ok(waitJob?.run, `${name} must define its completion poller`);
    assert.equal(waitJob.env?.KASEKI_POLL_TIMEOUT_SECONDS, "11100");

    const completed = runKasekiPoll(waitJob.run as string, "completed", 11100);
    assert.equal(completed.status, 0, `${name}: ${completed.stderr}`);
    assert.match(completed.githubOutput, /status=completed/);

    const failed = runKasekiPoll(waitJob.run as string, "failed", 11100);
    assert.notEqual(failed.status, 0, name);
    assert.match(failed.githubOutput, /status=failed/);

    const timedOut = runKasekiPoll(waitJob.run as string, "completed", 0);
    assert.notEqual(timedOut.status, 0, name);
    assert.match(timedOut.stderr + timedOut.stdout, /timed out/i);
    assert.equal(timedOut.githubOutput, "");
  }
});

test("Cloudflare deployment uses shared validation and quotes shell inputs", () => {
  const deploy = readWorkflow("deploy-cloudflare.yml");
  const deployJob = getJob(deploy, "deploy");
  const validation = getJob(deploy, "validate");
  const checkout = deployJob.steps.find((step: Workflow) => String(step.uses).startsWith("actions/checkout@")) as Workflow | undefined;
  const deployStep = deployJob.steps.find((step: Workflow) => step.name === "Deploy Worker") as Workflow | undefined;

  assert.equal(validation.uses, "./.github/workflows/validate-reusable.yml");
  assert.equal(deployJob.needs, "validate");
  assert.equal(checkout?.with?.["persist-credentials"], false);
  assert.equal(deployJob.steps.some((step: Workflow) => step.run === "npm ci"), true);
  assert.equal(deployJob.steps.some((step: Workflow) => step.run === "npm test" || step.run === "npm run typecheck"), false);
  assert.ok(deployStep);
  assert.equal(deployStep.env.BUILD_VERSION, "${{ steps.build.outputs.version }}");
  assert.equal(deployStep.env.BUILD_SHA, "${{ github.sha }}");
  assert.match(deployStep.run, /--var "BUILD_VERSION:\$BUILD_VERSION" --var "BUILD_SHA:\$BUILD_SHA"/);
  assert.doesNotMatch(deployStep.run, /--var BUILD_VERSION:\$\{\{/);
});

test("Kaseki workflows scope the token to gateway, submit, and poll steps", () => {
  const docs = readWorkflow("kaseki-docs.yaml");
  const dry = readWorkflow("kaseki-dry.yaml");
  assertKasekiTokenScope(docs, "docs_sweep");
  assertKasekiTokenScope(dry, "dry_sweep");
});

test("validation checkout does not persist its read-only GitHub token", () => {
  const validate = readWorkflow("validate-reusable.yml");
  const checkout = getJob(validate, "validate").steps.find((step: Workflow) => String(step.uses).startsWith("actions/checkout@")) as Workflow | undefined;

  assert.equal(checkout?.with?.["persist-credentials"], false);
});

test("pull requests and main deployments share one validation workflow", () => {
  const validate = readWorkflow("validate.yml");
  const shared = readWorkflow("validate-reusable.yml");
  const deploy = readWorkflow("deploy-cloudflare.yml");
  const validationCall = getJob(validate, "validate");
  const deploymentValidation = getJob(deploy, "validate");

  assert.ok(validate.on.pull_request);
  assert.equal(validate.on.push, undefined);
  assert.equal(validationCall.uses, "./.github/workflows/validate-reusable.yml");
  assert.ok(Object.hasOwn(shared.on, "workflow_call"));
  assert.equal(deploymentValidation.uses, validationCall.uses);
  assert.equal(getJob(deploy, "deploy").needs, "validate");
  assert.equal(getJob(deploy, "deploy").steps.some((step: Workflow) => step.run === "npm test" || step.run === "npm run typecheck"), false);
});

test("Dependabot updates GitHub Actions and npm dependencies weekly", () => {
  const dependabot = parseYamlDocument(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8"));
  const ecosystems = (dependabot.updates as Workflow[]).map(update => update["package-ecosystem"]);

  assert.deepEqual(ecosystems, ["github-actions", "npm"]);
  for (const update of dependabot.updates as Workflow[]) {
    assert.equal(update.schedule.interval, "weekly");
  }
});

// Runner policy: README.md#github-workflow-policy.
test("GitHub workflow jobs use a versioned Ubuntu runner instead of a floating label", () => {
  for (const name of ["validate.yml", "validate-reusable.yml", "deploy-cloudflare.yml", "kaseki-docs.yaml", "kaseki-dry.yaml"]) {
    const workflow = readWorkflow(name);
    for (const [jobName, job] of Object.entries(workflow.jobs as Record<string, Workflow>)) {
      if (job.uses) continue;
      assert.match(job["runs-on"], /^ubuntu-\d+\.\d+$/, `${name} job ${jobName} should pin an Ubuntu release`);
    }
  }
});
