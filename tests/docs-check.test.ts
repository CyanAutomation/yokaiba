import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRestRouter } from "../src/api/router.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { inspectMarkdown } from "../scripts/check-docs.js";
import { createWorker } from "../worker/index.js";

async function withFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "yokaiba-docs-check-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "tsc", test: "node --test" } }));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("documentation checker accepts existing relative links, heading anchors, and package scripts", async () => {
  await withFixture(async root => {
    await writeFile(path.join(root, "README.md"), "# Project\n\n[Guide](docs/guide.md#local-setup)\n\nRun `npm run build`.\n");
    await writeFile(path.join(root, "docs/guide.md"), "# Guide\n\n## Local setup\n");

    assert.deepEqual(inspectMarkdown(root), []);
  });
});

test("documentation checker reports broken links, anchors, and package script references", async () => {
  await withFixture(async root => {
    await writeFile(path.join(root, "README.md"), "# Project\n\n[Missing](docs/missing.md)\n\n[Broken anchor](README.md#nope)\n\nRun `npm run deploy`.\n");

    const issues = inspectMarkdown(root);
    assert.equal(issues.length, 3);
    assert.match(issues.map(issue => issue.message).join("\n"), /does not exist/);
    assert.match(issues.map(issue => issue.message).join("\n"), /unknown anchor/);
    assert.match(issues.map(issue => issue.message).join("\n"), /unknown package script/);
  });
});

test("documentation checker handles duplicate anchors and encoded links while checking fenced commands", async () => {
  await withFixture(async root => {
    await writeFile(path.join(root, "README.md"), [
      "# Project",
      "",
      "## Setup",
      "## Setup",
      "",
      "[Second heading](README.md#setup-1)",
      "[Encoded path](docs%20guide/guide.md#quick-start)",
      "",
      "```sh",
      "[Example only](missing.md)",
      "npm run missing-script",
      "```",
      "",
    ].join("\n"));
    await mkdir(path.join(root, "docs guide"));
    await writeFile(path.join(root, "docs guide", "guide.md"), "# Guide\n\n## Quick start\n");

    assert.deepEqual(inspectMarkdown(root), [{
      file: "README.md",
      line: 11,
      message: "unknown package script: npm run missing-script",
    }]);
  });
});

test("documentation checker reports malformed local URL encoding at the link line", async () => {
  await withFixture(async root => {
    await writeFile(path.join(root, "README.md"), "# Project\n\n[Bad link](docs/%E0%A4%A.md)\n");

    assert.deepEqual(inspectMarkdown(root), [{
      file: "README.md",
      line: 3,
      message: "invalid URL encoding in local link: docs/%E0%A4%A.md",
    }]);
  });
});

test("README generation quick starts call a registered route and produce a public puzzle", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const examples = [...readme.matchAll(/curl -fsS '((?:https?:\/\/[^']+)?\/v1\/puzzles\/generate\?[^']+)'/g)];
  assert.equal(examples.length, 2, "expected hosted and local generation examples");
  const router = createRestRouter([tournamentOrderV2Template]);

  for (const example of examples) {
    const url = new URL(example[1] ?? "", "http://localhost:8787");
    assert.equal(url.pathname, "/v1/puzzles/generate");
    assert.equal(url.searchParams.get("templateId"), tournamentOrderV2Template.id);
    const response = await router(new Request(url));
    assert.equal(response.status, 200);
    const puzzle = await response.json() as { templateId: string; seed: string; clues: unknown[]; solution?: unknown };
    assert.equal(puzzle.templateId, tournamentOrderV2Template.id);
    assert.equal(puzzle.seed, "first-puzzle");
    assert.ok(puzzle.clues.length > 0);
    assert.equal(puzzle.solution, undefined, "public generation must not expose the hidden solution");
  }
});

test("README response preview matches the deterministic generation example", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const preview = /Current response preview[\s\S]*?```text\n([\s\S]*?)\n```/.exec(readme)?.[1];
  assert.ok(preview, "expected a text preview of the generation response");

  const fields = new Map(preview.split("\n").map(line => {
    const separator = line.indexOf(":");
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
  const router = createRestRouter([tournamentOrderV2Template]);
  const response = await router(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v2&seed=first-puzzle"));
  assert.equal(response.status, 200);
  const puzzle = await response.json() as {
    templateId: string;
    seed: string;
    difficulty: { level: number; label: string };
    clues: unknown[];
    solution?: unknown;
  };

  assert.equal(fields.get("templateId"), puzzle.templateId);
  assert.equal(fields.get("seed"), puzzle.seed);
  assert.equal(fields.get("difficulty"), `level ${puzzle.difficulty.level} (${puzzle.difficulty.label})`);
  assert.equal(fields.get("clues"), String(puzzle.clues.length));
  assert.equal(fields.get("solution"), "not returned");
  assert.equal(puzzle.solution, undefined);
});

test("README links contributors to the documented architecture overview", async () => {
  const [readme, guide] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/development.md", import.meta.url), "utf8"),
  ]);

  assert.match(readme, /\[Architecture overview\]\(docs\/development\.md#architecture\)/);
  assert.match(guide, /^## Architecture$/m);
  assert.match(guide, /`worker\/index\.ts`/);
  assert.match(guide, /`src\/api\/`/);
  assert.match(guide, /`src\/mcp\/`/);
  assert.match(guide, /`src\/generation\/`/);
  assert.match(guide, /`src\/constraints\/`/);
});

test("hosted API docs point both MCP setup links at the operations guide", async () => {
  const worker = createWorker();
  const response = await worker.fetch(new Request("https://yokaiba.test/docs"), {}, {} as ExecutionContext);
  assert.equal(response.status, 200);
  const html = await response.text();
  const setupGuide = "https://github.com/CyanAutomation/yokaiba/blob/main/docs/operations-and-deployment.md#mcp-and-deployment";

  assert.equal(html.split(setupGuide).length - 1, 2);
  assert.doesNotMatch(html, /github\.com\/CyanAutomation\/yokaiba#mcp-and-deployment/);
});
