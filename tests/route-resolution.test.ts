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

test("route resolution reports sorted allowed methods for a known path", () => {
  assert.deepEqual(resolveRoute(routes, "PATCH", "/items"), { kind: "method_not_allowed", allowedMethods: ["GET", "POST"] });
});

test("route resolution distinguishes an unknown path", () => {
  assert.deepEqual(resolveRoute(routes, "GET", "/missing"), { kind: "not_found" });
});
