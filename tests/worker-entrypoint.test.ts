import assert from "node:assert/strict";
import test from "node:test";
import { isFetchEntrypoint } from "../worker/entrypoint.js";

test("fetch entrypoint guard accepts callable service binding proxies", () => {
  const serviceBinding = Object.assign(async () => new Response("unused"), {
    fetch: async () => new Response("ok"),
  });

  assert.equal(isFetchEntrypoint(serviceBinding), true);
});

test("fetch entrypoint guard accepts plain objects with fetch methods", () => {
  assert.equal(isFetchEntrypoint({ fetch: async () => new Response("ok") }), true);
});

test("fetch entrypoint guard rejects values without a fetch method", () => {
  assert.equal(isFetchEntrypoint({ call: () => undefined }), false);
  assert.equal(isFetchEntrypoint(null), false);
  assert.equal(isFetchEntrypoint(undefined), false);
});
