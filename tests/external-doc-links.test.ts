import assert from "node:assert/strict";
import test from "node:test";
import { checkExternalLinks, extractExternalLinks } from "../scripts/check-external-doc-links.js";

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
