import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts?: Record<string, string>;
};

function readWorkflow(name: string): string {
  return readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
}

test("Kaseki validation commands only call scripts defined by this package", () => {
  for (const name of ["kaseki-docs.yaml", "kaseki-dry.yaml"]) {
    const contents = readWorkflow(name);
    const command = contents.match(/^\s+VALIDATION_COMMAND:\s*(.+)$/m)?.[1];

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

  assert.match(dry, /^    if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(docs, /^    if: github\.ref == 'refs\/heads\/main'$/m);
  assert.doesNotMatch(dry, /github\.event_name == 'schedule'/);
  assert.doesNotMatch(docs, /github\.event_name == 'schedule'/);
  assert.match(dry, /^      REF: \$\{\{ github\.sha \}\}$/m);
  assert.match(docs, /^  REF: \$\{\{ github\.sha \}\}$/m);
});

test("Kaseki sweeps share a deterministic policy and keep run names readable", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");
  const mainOnlyGuard = /^    if: github\.ref == 'refs\/heads\/main'$/gm;

  assert.equal([...dry.matchAll(mainOnlyGuard)].length, 1);
  assert.equal([...docs.matchAll(mainOnlyGuard)].length, 1);
  assert.match(dry, /^run-name: >-\n  DRY sweep · .*@\$\{\{ github\.ref_name \}\}$/m);
  assert.match(docs, /^run-name: >-\n  Docs sweep · .*@\$\{\{ github\.ref_name \}\}$/m);
});

test("Kaseki DRY pins its controller and limits the token to authenticated steps", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const tokenEnvironments = [...dry.matchAll(/^\s+KASEKI_API_TOKEN:\s*\$\{\{\s*secrets\.KASEKI_API_TOKEN\s*\}\}/gm)];

  assert.match(dry, /\[\[ "\$KASEKI_BASE_URL" == "https:\/\/kaseki-tunnel\.scheimann\.xyz" \]\]/);
  assert.doesNotMatch(dry, /^ {6}KASEKI_API_TOKEN:/m, "the Kaseki token must not be job-wide");
  assert.equal(tokenEnvironments.length, 3, "the gateway, submit, and poll steps each need the token");
  assert.ok(tokenEnvironments.every((match) => match[0].startsWith("          ")));
});

test("Kaseki DRY controller validation accepts the approved host and rejects attacker-controlled hosts", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const configurationScript = dry.match(
    /- name: Validate Kaseki configuration\s+shell: bash\s+run: \|\n([\s\S]*?)(?=\n {6}- name:)/,
  )?.[1];

  assert.ok(configurationScript, "the workflow must have a Kaseki configuration validation step");

  const bashScript = configurationScript
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");

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

test("Kaseki sweeps request normal pull-request publication and cap diffs", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");

  assert.match(dry, /^\s+publishMode: "pr",?$/m);
  assert.match(docs, /^\s+publishMode: "pr",?$/m);
  assert.match(dry, /^\s+maxDiffBytes: 102400,?$/m);
  assert.match(docs, /^\s+maxDiffBytes: 102400,?$/m);
  assert.doesNotMatch(`${dry}\n${docs}`, /draft_pr/);
});

test("Kaseki submissions reuse an idempotency key when a workflow run is rerun", () => {
  for (const name of ["kaseki-docs.yaml", "kaseki-dry.yaml"]) {
    const workflow = readWorkflow(name);

    assert.match(workflow, /uuidgen --sha1 --namespace @dns --name "\$GITHUB_REPOSITORY:\$GITHUB_WORKFLOW:\$GITHUB_RUN_ID"/);
    assert.match(workflow, /--arg idempotencyKey "\$idempotency_key"/);
    assert.doesNotMatch(workflow, /\/proc\/sys\/kernel\/random\/uuid|uuidgen \| tr/);
  }
});

test("Kaseki Docs waits for a terminal run status within a wall-clock deadline", () => {
  const docs = readWorkflow("kaseki-docs.yaml");

  assert.match(docs, /^      - name: Wait for Kaseki completion$/m);
  assert.match(docs, /poll_deadline=\$\(\(SECONDS \+ 11100\)\)/);
  assert.match(docs, /^\s+completed\)/m);
  assert.match(docs, /^\s+failed\)/m);
  assert.match(docs, /No terminal status after 185 minutes/);
});

test("Kaseki DRY polling uses a wall-clock deadline instead of a poll count", () => {
  const dry = readWorkflow("kaseki-dry.yaml");

  assert.match(dry, /poll_deadline=\$\(\(SECONDS \+ 11100\)\)/);
  assert.doesNotMatch(dry, /remaining_polls|seq 1 185/);
});

test("Cloudflare deployment disables checkout credential persistence and quotes shell inputs", () => {
  const deploy = readWorkflow("deploy-cloudflare.yml");

  assert.match(deploy, /uses: actions\/checkout@[^\n]+\n\s+with:\n\s+persist-credentials: false/);
  assert.match(deploy, /BUILD_VERSION: \$\{\{ steps\.build\.outputs\.version \}\}/);
  assert.match(deploy, /BUILD_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(deploy, /--var "BUILD_VERSION:\$BUILD_VERSION" --var "BUILD_SHA:\$BUILD_SHA"/);
  assert.doesNotMatch(deploy, /--var BUILD_VERSION:\$\{\{/);
});

test("Kaseki Docs keeps its token inside the gateway-authentication step", () => {
  const docs = readWorkflow("kaseki-docs.yaml");
  const tokenEnvironments = [...docs.matchAll(/^\s+KASEKI_API_TOKEN:\s*\$\{\{\s*secrets\.KASEKI_API_TOKEN\s*\}\}/gm)];

  assert.doesNotMatch(docs, /^ {6}KASEKI_API_TOKEN:/m, "the Kaseki token must not be job-wide");
  assert.equal(tokenEnvironments.length, 3, "the gateway, submit, and poll steps each need the token");
  assert.ok(tokenEnvironments.every((match) => match[0].startsWith("          ")));
});

test("validation checkout does not persist its read-only GitHub token", () => {
  const validate = readWorkflow("validate.yml");

  assert.match(validate, /uses: actions\/checkout@[^\n]+\n\s+with:\n\s+persist-credentials: false/);
});

test("GitHub workflows use a stable Ubuntu runner release", () => {
  for (const name of ["validate.yml", "deploy-cloudflare.yml", "kaseki-docs.yaml", "kaseki-dry.yaml"]) {
    assert.match(readWorkflow(name), /^\s+runs-on: ubuntu-24\.04$/m, `${name} should not float with ubuntu-latest`);
  }
});
