import assert from "node:assert/strict";
import test from "node:test";
import { isFetchEntrypoint } from "../worker/entrypoint.js";

test("fetch entrypoint guard accepts values with callable fetch bindings", () => {
  const serviceBinding = Object.assign(async () => new Response("unused"), {
    fetch: async () => new Response("ok"),
  });

  assert.equal(isFetchEntrypoint(serviceBinding), true);
  assert.equal(isFetchEntrypoint({ fetch: async () => new Response("ok") }), true);
});

test("fetch entrypoint guard rejects values without a callable fetch binding", () => {
  for (const value of [null, undefined, {}, { call: () => undefined }, { fetch: "not callable" }]) {
    assert.equal(isFetchEntrypoint(value), false);
  }
});
