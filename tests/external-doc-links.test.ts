import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { checkExternalLinks, extractExternalLinks, readDocumentationMarkdown } from "../scripts/check-external-doc-links.js";

test("documentation link inputs include README and nested Markdown files under docs", () => {
  const root = mkdtempSync(join(tmpdir(), "external-doc-links-test-"));

  try {
    mkdirSync(join(root, "docs", "guides"), { recursive: true });
    writeFileSync(join(root, "README.md"), "[README](https://example.test/readme)");
    writeFileSync(join(root, "docs", "api.md"), "[API](https://example.test/api)");
    writeFileSync(join(root, "docs", "guides", "setup.md"), "[Setup](https://example.test/setup)");
    writeFileSync(join(root, "docs", "notes.txt"), "[Ignored](https://example.test/ignored)");

    const documents = readDocumentationMarkdown(root);

    assert.deepEqual(documents.map(document => relative(root, document.path)), [
      "README.md",
      "docs/api.md",
      "docs/guides/setup.md",
    ]);
    assert.deepEqual(documents.flatMap(document => extractExternalLinks(document.markdown)), [
      "https://example.test/readme",
      "https://example.test/api",
      "https://example.test/setup",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("documentation link discovery tolerates an absent docs directory but requires README", () => {
  const readmeOnlyRoot = mkdtempSync(join(tmpdir(), "external-doc-links-test-"));
  const docsOnlyRoot = mkdtempSync(join(tmpdir(), "external-doc-links-test-"));

  try {
    writeFileSync(join(readmeOnlyRoot, "README.md"), "[README](https://example.test/readme)");
    assert.deepEqual(readDocumentationMarkdown(readmeOnlyRoot).map(document => relative(readmeOnlyRoot, document.path)), ["README.md"]);

    mkdirSync(join(docsOnlyRoot, "docs"), { recursive: true });
    writeFileSync(join(docsOnlyRoot, "docs", "api.md"), "[API](https://example.test/api)");
    assert.throws(() => readDocumentationMarkdown(docsOnlyRoot), /README\.md is required/);
  } finally {
    rmSync(readmeOnlyRoot, { recursive: true, force: true });
    rmSync(docsOnlyRoot, { recursive: true, force: true });
  }
});

test("external documentation link extraction ignores code and deduplicates destinations", () => {
  const markdown = [
    "[API docs](https://example.test/docs)",
    "![Badge](https://example.test/badge.svg)",
    "[Repeat](https://example.test/docs)",
    "`[inline example](https://example.test/ignored)`",
    "```sh",
    "curl https://example.test/ignored-too",
    "[code link](https://example.test/code)",
    "```",
  ].join("\n");

  assert.deepEqual(extractExternalLinks(markdown), [
    "https://example.test/docs",
    "https://example.test/badge.svg",
  ]);
});

test("external link checks report successful and failed HTTP responses", async () => {
  const results = await checkExternalLinks(["https://example.test/ok", "https://example.test/missing"], async url =>
    url.endsWith("/ok") ? 200 : 404);

  assert.deepEqual(results, [
    { url: "https://example.test/ok", status: 200 },
    { url: "https://example.test/missing", status: 404 },
  ]);
});

test("external link checks report network errors without aborting the remaining links", async () => {
  const results = await checkExternalLinks(["https://example.test/one", "https://example.test/two"], async url => {
    if (url.endsWith("/one")) throw new Error("connection failed");
    return 200;
  });

  assert.equal(results[0]?.error, "connection failed");
  assert.deepEqual(results[1], { url: "https://example.test/two", status: 200 });
});
