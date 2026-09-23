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

test("Kaseki DRY dispatch runs only from the repository's default branch", () => {
  const dry = readWorkflow("kaseki-dry.yaml");

  assert.match(
    dry,
    /^  dry_sweep:\n[\s\S]*?^    if: github\.event_name == 'schedule' \|\| github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)$/m,
  );
  assert.match(dry, /^      REF: \$\{\{ github\.ref_name \}\}$/m);
});

test("Kaseki scheduled runs use the default branch without relying on an event payload", () => {
  const dry = readWorkflow("kaseki-dry.yaml");
  const docs = readWorkflow("kaseki-docs.yaml");
  const scheduleAwareGuard = /^    if: github\.event_name == 'schedule' \|\| github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)$/gm;

  assert.equal([...dry.matchAll(scheduleAwareGuard)].length, 1);
  assert.equal([...docs.matchAll(scheduleAwareGuard)].length, 4);
  assert.match(dry, /^run-name: >-\n  DRY sweep · .*@\$\{\{ github\.ref_name \}\}$/m);
  assert.match(docs, /^run-name: >-\n  Docs sweep · .*@\$\{\{ github\.ref_name \}\}$/m);
  assert.match(docs, /^  REF: \$\{\{ github\.ref_name \}\}$/m);
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

test("Kaseki DRY explicitly requests draft pull-request publication", () => {
  const dry = readWorkflow("kaseki-dry.yaml");

  assert.match(dry, /^\s+publishMode: "draft_pr",?$/m);
});

test("Kaseki Docs keeps its token inside the gateway-authentication step", () => {
  const docs = readWorkflow("kaseki-docs.yaml");
  const tokenEnvironments = [...docs.matchAll(/^\s+KASEKI_API_TOKEN:\s*\$\{\{\s*secrets\.KASEKI_API_TOKEN\s*\}\}/gm)];

  assert.doesNotMatch(docs, /^ {6}KASEKI_API_TOKEN:/m, "the Kaseki token must not be job-wide");
  assert.equal(tokenEnvironments.length, 2, "the gateway and submit steps each need the token");
  assert.ok(tokenEnvironments.every((match) => match[0].startsWith("          ")));
});

test("validation checkout does not persist its read-only GitHub token", () => {
  const validate = readWorkflow("validate.yml");

  assert.match(validate, /uses: actions\/checkout@[^\n]+\n\s+with:\n\s+persist-credentials: false/);
});
