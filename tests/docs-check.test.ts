import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRestRouter } from "../src/api/router.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { inspectMarkdown } from "../scripts/check-docs.js";

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
