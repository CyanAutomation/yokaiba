import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSoyuzRunId } from "../scripts/validate-soyuz-run-id.js";
import { validateSoyuzBaseUrl } from "../scripts/validate-soyuz-url.js";
import { parseYamlDocument } from "./helpers/yaml.js";

// Workflow behavior contracts are documented in docs/operations-and-deployment.md#github-workflow-policy.
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts?: Record<string, string>;
  engines?: { node?: string };
};

type Workflow = Record<string, any>;

function readWorkflow(name: string): Workflow {
  return parseYamlDocument(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));
}

test("Node.js version is pinned consistently for local development, package installs, and CI", () => {
  const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as {
    packages?: Record<string, { engines?: { node?: string } }>;
  };

  assert.equal(readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim(), "26");
  assert.equal(packageJson.engines?.node, ">=26 <27");
  assert.equal(packageLock.packages?.[""]?.engines?.node, packageJson.engines?.node);

  for (const [name, jobName] of [
    ["validate-reusable.yml", "validate"],
    ["deploy-cloudflare.yml", "deploy"],
    ["docs-links.yml", "links"],
    ["kaseki-dry.yaml", "dry_sweep"],
    ["kaseki-docs.yaml", "docs_sweep"],
  ]) {
    const workflow = readWorkflow(name);
    const setupNode = getJob(workflow, jobName).steps
      .find((step: Workflow) => String(step.uses).startsWith("actions/setup-node@")) as Workflow | undefined;

    assert.equal(setupNode?.with?.["node-version-file"], ".nvmrc", `${name} must use the repository Node.js pin`);
    assert.equal(setupNode?.with?.["node-version"], undefined, `${name} must not duplicate the Node.js version`);
  }
});

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

function assertSoyuzTokenScope(workflow: Workflow, jobName: string): void {
  const currentJob = getJob(workflow, jobName);
  assert.equal(currentJob.environment, "soyuz", `${jobName} must use the Soyuz environment`);
  assert.equal(currentJob.env?.SOYUZ_SUBMISSION_API_TOKEN, undefined, `${jobName} must not expose the token job-wide`);
  const tokenSteps = currentJob.steps.filter((step: Workflow) =>
    step.env?.SOYUZ_SUBMISSION_API_TOKEN === "${{ secrets.SOYUZ_SUBMISSION_API_TOKEN }}",
  );
  assert.deepEqual(tokenSteps.map((step: Workflow) => step.id), ["submit"]);
}

// Workflow policy: docs/operations-and-deployment.md#github-workflow-policy.
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

test("Soyuz workflows keep their current schedules, main-only guard, and main ref", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");

  assert.deepEqual(dry.on.schedule, [{ cron: "0 2 * * 1" }]);
  assert.deepEqual(docs.on.schedule, [{ cron: "0 1 * * 3" }]);
  assert.equal(getJob(dry, "dry_sweep").if, "github.ref == 'refs/heads/main'");
  assert.equal(getJob(docs, "docs_sweep").if, "github.ref == 'refs/heads/main'");
  assert.equal(getJob(dry, "dry_sweep").env.REF, "main");
  assert.equal(docs.env.REF, "main");

  const submissions = [
    getRunStep(dry, "dry_sweep", "Submit DRY sweep to Soyuz"),
    getRunStep(docs, "docs_sweep", "Submit documentation sweep to Soyuz"),
  ];
  for (const submission of submissions) {
    assert.match(submission, /--arg ref "\$REF"/);
    assert.match(submission, /ref: \$ref/);
  }
});

test("Soyuz sweeps use separate concurrency groups and remain main-only", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");

  assert.equal(dry.concurrency.group, "soyuz-dry-sweep-${{ github.repository }}");
  assert.equal(docs.concurrency.group, "soyuz-docs-sweep-${{ github.repository }}");
  assert.equal(dry.concurrency["cancel-in-progress"], false);
  assert.equal(docs.concurrency["cancel-in-progress"], false);
  assert.equal(getJob(dry, "dry_sweep").if, "github.ref == 'refs/heads/main'");
  assert.equal(getJob(docs, "docs_sweep").if, "github.ref == 'refs/heads/main'");
});

test("Kaseki DRY sweep covers every source directory and the actual tests directory", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const allowlist = getJob(dry, "dry_sweep").env.ALLOWLIST.split(",");

  assert.deepEqual(allowlist, ["src/**/*", "worker/**/*", "scripts/**/*", "tests/**/*"]);
});

test("Soyuz URL validation accepts only the approved origin", () => {
  assert.equal(validateSoyuzBaseUrl("https://soyuz.scheimann.workers.dev"), "https://soyuz.scheimann.workers.dev");

  for (const value of [
    "https://attacker.example",
    "https://soyuz.scheimann.workers.dev.attacker.example",
    "http://soyuz.scheimann.workers.dev",
  ]) {
    assert.throws(() => validateSoyuzBaseUrl(value));
  }

  for (const [name, jobName] of [
    ["kaseki-dry.yaml", "dry_sweep"],
    ["kaseki-docs.yaml", "docs_sweep"],
  ]) {
    const validationStep = getJob(readWorkflow(name), jobName).steps.find((step: Workflow) => step.name === "Validate Soyuz URL") as Workflow | undefined;
    assert.ok(validationStep, `${name} must define the Soyuz URL validation step`);
    assert.equal(validationStep.shell, "bash", `${name} must declare the validation shell`);
    assert.match(validationStep.run, /scripts\/validate-soyuz-url\.ts/);
  }
});

test("Kaseki sweeps request standard pull requests, never drafts, and cap diffs", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");
  const drySubmission = getRunStep(dry, "dry_sweep", "Submit DRY sweep to Soyuz");
  const docsSubmission = getRunStep(docs, "docs_sweep", "Submit documentation sweep to Soyuz");

  for (const submission of [drySubmission, docsSubmission]) {
    assert.match(submission, /publishMode:\s*"pr"/);
    assert.match(submission, /maxDiffBytes:\s*102400/);
    assert.doesNotMatch(submission, /\bdraft(?:_pr)?\b/i);
  }
});

test("Soyuz submissions generate and send an idempotency key", () => {
  for (const [name, jobName, stepName] of [
    ["kaseki-docs.yaml", "docs_sweep", "Submit documentation sweep to Soyuz"],
    ["kaseki-dry.yaml", "dry_sweep", "Submit DRY sweep to Soyuz"],
  ]) {
    const submission = getRunStep(readWorkflow(name), jobName, stepName);
    assert.match(submission, /tr '\[:upper:\]' '\[:lower:\]' < \/proc\/sys\/kernel\/random\/uuid/);
    assert.match(submission, /--header "Idempotency-Key: \$idempotency_key"/);
    assert.match(submission, /idempotencyKey:\s*\$idempotencyKey/);
  }
});

test("Soyuz workflows submit once and report admission without waiting for completion", () => {
  for (const [name, jobName, taskName] of [
    ["kaseki-docs.yaml", "docs_sweep", "Soyuz documentation submission"],
    ["kaseki-dry.yaml", "dry_sweep", "Soyuz DRY submission"],
  ]) {
    const workflow = readWorkflow(name);
    const job = getJob(workflow, jobName);
    const steps = job.steps as Workflow[];
    const summary = steps.find((step) => step.name === "Publish Soyuz submission details");

    assert.equal(job.environment, "soyuz");
    assert.equal(job["timeout-minutes"], 15);
    assert.equal(steps.filter((step) => step.id === "submit").length, 1);
    assert.equal(steps.some((step) => step.id === "wait" || /Wait for Kaseki/.test(step.name ?? "")), false);
    assert.ok(summary);
    assert.equal(summary.if, "always()");
    assert.match(summary.run, new RegExp(taskName));
    assert.match(summary.run, /does not confirm execution completion/);
    assert.match(summary.run, /Monitor the run in the Soyuz dashboard/);
    assert.doesNotMatch(JSON.stringify(workflow), /KASEKI_(?:API_TOKEN|BASE_URL)|kaseki-tunnel|api\/v1\/runs\/\$RUN_ID\/status/);
  }
});

test("Soyuz workflow Bash steps have valid shell syntax", () => {
  for (const name of ["kaseki-docs.yaml", "kaseki-dry.yaml"]) {
    const workflow = readWorkflow(name);
    const jobName = name === "kaseki-dry.yaml" ? "dry_sweep" : "docs_sweep";
    const steps = getJob(workflow, jobName).steps as Workflow[];

    for (const step of steps.filter((candidate) => candidate.shell === "bash")) {
      const result = spawnSync("bash", ["--noprofile", "--norc", "-n"], {
        input: step.run,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${name} step ${step.name}: ${result.stderr}`);
    }
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

test("Cloudflare deployment runs typed scripts for version and deployment checks", () => {
  const deploy = readWorkflow("deploy-cloudflare.yml");
  const versionStep = getRunStep(deploy, "deploy", "Read package version");
  const smokeStep = getRunStep(deploy, "deploy", "Smoke-test deployed public API");

  assert.match(versionStep, /npm pkg get version/);
  assert.doesNotMatch(versionStep, /\bnode\b/);
  assert.equal(getRunStep(deploy, "deploy", "Probe direct Worker deployment"), "npm run deployment:health");
  assert.match(smokeStep, /if ! npm run deployment:smoke; then/);
  assert.match(smokeStep, /smoke response body, request ID, Cloudflare Ray ID, and Worker observability logs/);
  assert.match(smokeStep, /exit 1/);
  assert.equal(getRunStep(deploy, "deploy", "Contract-test deployed public API"), "npm run deployment:contract");

  const deployScript = getRunStep(deploy, "deploy", "Deploy Worker");
  assert.match(deployScript, /npm run deployment:record-output/);
  assert.doesNotMatch(deployScript, /node\s*<<|require\(/);

  for (const name of ["deployment:record-output", "deployment:health", "deployment:smoke", "deployment:contract"]) {
    assert.ok(packageJson.scripts?.[name], `package.json must define ${name}`);
  }
});

test("Soyuz workflows scope the token to the submission step", () => {
  const docs = readWorkflow("kaseki-docs.yaml");
  const dry = readWorkflow("kaseki-dry.yaml");
  assertSoyuzTokenScope(docs, "docs_sweep");
  assertSoyuzTokenScope(dry, "dry_sweep");
});

test("validation checkout does not persist its read-only GitHub token", () => {
  const validate = readWorkflow("validate-reusable.yml");
  const checkout = getJob(validate, "validate").steps.find((step: Workflow) => String(step.uses).startsWith("actions/checkout@")) as Workflow | undefined;

  assert.equal(checkout?.with?.["persist-credentials"], false);
  assert.equal(checkout?.with?.["fetch-depth"], 0, "Fallow's new-only audit needs the base commit in the checkout");
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

test("pull requests review dependency changes with read-only permissions", () => {
  const workflow = readWorkflow("validate.yml");
  const job = getJob(workflow, "dependency-review");
  const review = job.steps.find((step: Workflow) => step.name === "Review dependency changes") as Workflow | undefined;

  assert.ok(workflow.on.pull_request);
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
  assert.equal(workflow.on.push, undefined);
  assert.deepEqual(job.permissions, { contents: "read" });
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(review?.uses, "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294");
  assert.equal(review?.with?.["fail-on-severity"], "high");
});

test("shared validation runs the production TypeScript build", () => {
  const shared = readWorkflow("validate-reusable.yml");
  const steps = getJob(shared, "validate").steps as Workflow[];

  assert.ok(steps.some(step => step.run === "npm run build"));
});

test("shared validation audits changed code after collecting test coverage", () => {
  const shared = readWorkflow("validate-reusable.yml");
  const steps = getJob(shared, "validate").steps as Workflow[];
  const coverageIndex = steps.findIndex(step => step.run === "npm run test:coverage");
  const healthIndex = steps.findIndex(step => step.name === "Report TypeScript health with coverage");
  const auditIndex = steps.findIndex(step => step.name === "Audit changed code with Fallow");

  assert.ok(coverageIndex >= 0, "validation must collect Istanbul coverage");
  assert.ok(healthIndex > coverageIndex, "Fallow health must run after coverage is available");
  assert.equal(steps[healthIndex]?.run, "npm run fallow:health -- --coverage coverage/coverage-final.json");
  assert.ok(auditIndex > coverageIndex, "Fallow must run after coverage is available");
  assert.equal(steps[auditIndex]?.run, "npm run fallow:audit -- --coverage coverage/coverage-final.json --format compact --quiet");
});

test("Soyuz workflows validate the response and use the HTTPS submission endpoint", () => {
  for (const name of ["kaseki-dry.yaml", "kaseki-docs.yaml"]) {
    const source = readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
    const workflow = readWorkflow(name);
    const jobName = name === "kaseki-dry.yaml" ? "dry_sweep" : "docs_sweep";
    const submit = getRunStep(workflow, jobName, name === "kaseki-dry.yaml" ? "Submit DRY sweep to Soyuz" : "Submit documentation sweep to Soyuz");

    assert.equal(getJob(workflow, jobName).environment, "soyuz");
    assert.equal(getJob(workflow, jobName).env?.SOYUZ_BASE_URL ?? workflow.env?.SOYUZ_BASE_URL, "${{ vars.SOYUZ_BASE_URL }}");
    assert.match(submit, /--request POST "\$SOYUZ_BASE_URL\/v1\/runs"/);
    assert.match(submit, /--proto '=https'/);
    assert.match(submit, /--tlsv1\.2/);
    assert.match(submit, /--max-filesize 1048576/);
    assert.match(submit, /\^\(200\|202\)\$/);
    assert.match(submit, /\.data\.id \| strings/);
    assert.match(submit, /\.data\.displayId \| strings/);
    assert.match(submit, /\.data\.status \| strings/);
    assert.match(submit, /validate-soyuz-run-id\.ts/);
    assert.match(submit, /Response body omitted/);
    assert.doesNotMatch(source, /KASEKI_(?:API_TOKEN|BASE_URL)|kaseki-tunnel|api\/v1\/runs\/\$RUN_ID\/status/);
  }
});

test("Dependabot updates GitHub Actions, npm, and the actionlint Docker base weekly", () => {
  const dependabot = parseYamlDocument(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8"));
  const ecosystems = (dependabot.updates as Workflow[]).map(update => update["package-ecosystem"]);

  assert.deepEqual(ecosystems, ["github-actions", "npm", "docker"]);
  for (const update of dependabot.updates as Workflow[]) {
    assert.equal(update.schedule.interval, "weekly");
  }

  const docker = (dependabot.updates as Workflow[]).find(update => update["package-ecosystem"] === "docker");
  assert.equal(docker?.directory, "/.github/actionlint");
  const dockerfile = readFileSync(new URL("../.github/actionlint/Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /^FROM rhysd\/actionlint:\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/m);
});

test("shared validation builds and runs the Dependabot-managed actionlint image", () => {
  const shared = readWorkflow("validate-reusable.yml");
  const job = getJob(shared, "validate");
  const build = job.steps.find((step: Workflow) => step.name === "Build actionlint image") as Workflow | undefined;
  const lint = job.steps.find((step: Workflow) => step.name === "Lint GitHub Actions workflows") as Workflow | undefined;

  assert.equal(build?.run, "docker build --tag yokaiba-actionlint .github/actionlint");
  assert.match(lint?.run ?? "", /docker run --rm[\s\S]*yokaiba-actionlint/);
  assert.doesNotMatch(lint?.run ?? "", /rhysd\/actionlint@sha256:/);
});

test("documentation links run weekly, manually, and on documentation pull requests", () => {
  const workflow = readWorkflow("docs-links.yml");
  const job = getJob(workflow, "links");

  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
  assert.deepEqual(workflow.on.pull_request.paths, ["README.md", "docs/**/*.md"]);
  assert.ok(Array.isArray(workflow.on.schedule) && workflow.on.schedule.some((entry: Workflow) => entry.cron));
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.match(job["runs-on"], /^ubuntu-\d+\.\d+$/);
  assert.ok(job.steps.some((step: Workflow) => step.run === "npm ci"));
  assert.ok(job.steps.some((step: Workflow) => step.run === "npm run docs:links"));
  assert.ok(packageJson.scripts?.["docs:links"]);
});

test("PR validation cancels superseded commits per pull request", () => {
  const workflow = readWorkflow("validate.yml");

  assert.equal(workflow.concurrency.group, "pr-validation-${{ github.event.pull_request.number || github.ref }}");
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
});

// Runner policy: docs/operations-and-deployment.md#github-workflow-policy.
test("GitHub workflow jobs use a versioned Ubuntu runner instead of a floating label", () => {
  for (const name of ["validate.yml", "validate-reusable.yml", "deploy-cloudflare.yml", "kaseki-docs.yaml", "kaseki-dry.yaml", "docs-links.yml"]) {
    const workflow = readWorkflow(name);
    for (const [jobName, job] of Object.entries(workflow.jobs as Record<string, Workflow>)) {
      if (job.uses) continue;
      assert.match(job["runs-on"], /^ubuntu-\d+\.\d+$/, `${name} job ${jobName} should pin an Ubuntu release`);
    }
  }
});
