import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoute } from "../src/api/route-resolution.js";

const get = async () => new Response("get");
const post = async () => new Response("post");
const routes = new Map([
  ["GET /items", get],
  ["POST /items", post],
]);

test("route resolution returns the handler for an exact method and path", () => {
  assert.deepEqual(resolveRoute(routes, "POST", "/items"), { kind: "handler", handler: post });
});

test("route resolution reports the allowed methods for a known path", () => {
  const result = resolveRoute(routes, "PATCH", "/items");
  assert.equal(result.kind, "method_not_allowed");
  if (result.kind === "method_not_allowed") {
    assert.deepEqual(new Set(result.allowedMethods), new Set(["GET", "POST"]));
  }
});

test("route resolution distinguishes an unknown path", () => {
  assert.deepEqual(resolveRoute(routes, "GET", "/missing"), { kind: "not_found" });
});
