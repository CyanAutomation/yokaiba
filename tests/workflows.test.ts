import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseYamlDocument } from "./helpers/yaml.js";

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

test("Kaseki validation commands only call scripts defined by this package", () => {
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

test("Kaseki workflows only run from main and submit the immutable event commit", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");

  assert.equal(getJob(dry, "dry_sweep").if, "github.ref == 'refs/heads/main'");
  assert.equal(getJob(docs, "docs_sweep").if, "github.ref == 'refs/heads/main'");
  assert.equal(getJob(dry, "dry_sweep").env.REF, "${{ github.sha }}");
  assert.equal(docs.env.REF, "${{ github.sha }}");
});

test("Kaseki sweeps share a deterministic policy and keep run names readable", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");

  assert.equal(dry["run-name"], "DRY sweep · ${{ github.repository }}@${{ github.ref_name }}");
  assert.equal(docs["run-name"], "Docs sweep · ${{ github.repository }}@${{ github.ref_name }}");
});

test("Kaseki DRY pins its controller to the approved HTTPS host", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const configurationScript = getRunStep(dry, "dry_sweep", "Validate Kaseki configuration");
  assert.match(configurationScript, /\[\[ "\$KASEKI_BASE_URL" == "https:\/\/kaseki-tunnel\.scheimann\.xyz" \]\]/);
});

test("Kaseki DRY controller validation accepts the approved host and rejects attacker-controlled hosts", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const bashScript = getRunStep(dry, "dry_sweep", "Validate Kaseki configuration");

  function checkControllerUrl(url: string) {
    return spawnSync("bash", ["--noprofile", "--norc", "-e", "-u", "-o", "pipefail", "-c", bashScript], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", KASEKI_BASE_URL: url },
    });
  }

  assert.equal(checkControllerUrl("https://kaseki-tunnel.scheimann.xyz").status, 0);
  assert.notEqual(checkControllerUrl("https://attacker.example").status, 0);
  assert.notEqual(checkControllerUrl("https://kaseki-tunnel.scheimann.xyz.attacker.example").status, 0);
});

test("Kaseki Docs pins its controller to the approved HTTPS host", () => {
  const docs = readWorkflow("kaseki-docs.yaml");
  const configurationScript = getRunStep(docs, "docs_sweep", "Validate Kaseki controller URL");
  assert.match(configurationScript, /\[\[ "\$KASEKI_BASE_URL" == "https:\/\/kaseki-tunnel\.scheimann\.xyz" \]\]/);
});

test("Kaseki sweeps request normal pull-request publication and cap diffs", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");
  const drySubmission = getRunStep(dry, "dry_sweep", "Submit DRY sweep");
  const docsSubmission = getRunStep(docs, "docs_sweep", "Submit documentation sweep");

  for (const submission of [drySubmission, docsSubmission]) {
    assert.match(submission, /publishMode:\s*"pr"/);
    assert.match(submission, /maxDiffBytes:\s*102400/);
    assert.doesNotMatch(submission, /draft_pr/);
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

test("Kaseki Docs waits for a terminal run status within a wall-clock deadline", () => {
  const docs = readWorkflow("kaseki-docs.yaml");
  const waitScript = getRunStep(docs, "docs_sweep", "Wait for Kaseki completion");

  assert.match(waitScript, /poll_deadline=\$\(\(SECONDS \+ 11100\)\)/);
  assert.match(waitScript, /^\s+completed\)/m);
  assert.match(waitScript, /^\s+failed\)/m);
  assert.match(waitScript, /No terminal status after 185 minutes/);
});

test("Kaseki DRY polling uses a wall-clock deadline instead of a poll count", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const waitScript = getRunStep(dry, "dry_sweep", "Wait for Kaseki completion");

  assert.match(waitScript, /poll_deadline=\$\(\(SECONDS \+ 11100\)\)/);
  assert.doesNotMatch(waitScript, /remaining_polls|seq 1 185/);
});

test("Cloudflare deployment disables checkout credential persistence and quotes shell inputs", () => {
  const deploy = readWorkflow("deploy-cloudflare.yml");
  const deployJob = getJob(deploy, "deploy");
  const checkout = deployJob.steps.find((step: Workflow) => String(step.uses).startsWith("actions/checkout@")) as Workflow | undefined;
  const deployStep = deployJob.steps.find((step: Workflow) => step.name === "Deploy Worker") as Workflow | undefined;

  assert.equal(checkout?.with?.["persist-credentials"], false);
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
  const validate = readWorkflow("validate.yml");
  const checkout = getJob(validate, "validate").steps.find((step: Workflow) => String(step.uses).startsWith("actions/checkout@")) as Workflow | undefined;

  assert.equal(checkout?.with?.["persist-credentials"], false);
});

test("GitHub workflow jobs use a versioned Ubuntu runner instead of a floating label", () => {
  for (const name of ["validate.yml", "deploy-cloudflare.yml", "kaseki-docs.yaml", "kaseki-dry.yaml"]) {
    const workflow = readWorkflow(name);
    for (const [jobName, job] of Object.entries(workflow.jobs as Record<string, Workflow>)) {
      assert.match(job["runs-on"], /^ubuntu-\d+\.\d+$/, `${name} job ${jobName} should pin an Ubuntu release`);
    }
  }
});
