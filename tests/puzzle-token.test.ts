import assert from "node:assert/strict";
import test from "node:test";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { issuePuzzleToken, verifyPuzzleToken, type PuzzleTokenPayload } from "../src/api/puzzle-token.js";

const secret = "test-token-secret";
const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signPayload(payload: unknown, signingSecret = secret): Promise<string> {
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

test("issued puzzle tokens round-trip the stable generation inputs", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "token-round-trip");
  const token = await issuePuzzleToken(puzzle, secret, { now: 1_000, ttlSeconds: 300 });

  assert.deepEqual(await verifyPuzzleToken(token, secret, 1_000), {
    version: 3,
    templateId: puzzle.templateId,
    seed: puzzle.seed,
    generatorVersion: puzzle.generatorVersion,
    solverVersion: puzzle.solverVersion,
    issuedAt: 1_000,
    expiresAt: 1_300,
  } satisfies PuzzleTokenPayload);
});

test("issued puzzle tokens expire and can be verified with a previous rotation key", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "token-expiry");
  const token = await issuePuzzleToken(puzzle, "old-secret", { now: 10_000, ttlSeconds: 60 });

  const verified = await verifyPuzzleToken(token, ["new-secret", "old-secret"], 10_059);
  assert.equal(verified?.version, 3);
  assert.equal(verified?.version === 3 ? verified.expiresAt : undefined, 10_060);
  assert.equal(await verifyPuzzleToken(token, ["new-secret", "old-secret"], 10_060), undefined);
  assert.equal(await verifyPuzzleToken(token, "new-secret", 10_059), undefined);
});

test("verification accepts the supported difficulty endpoints and rejects invalid signed payloads", async () => {
  const validBase = {
    version: 2,
    templateId: "tournament-order-v1",
    seed: "signed-seed",
    generatorVersion: "yokaiba-generator-v5",
    solverVersion: "yokaiba-exhaustive-v1",
  };

  for (const difficultyLevel of [1, 12]) {
    assert.deepEqual(await verifyPuzzleToken(await signPayload({ ...validBase, requestedDifficultyLevel: difficultyLevel }), secret), {
      ...validBase,
      requestedDifficultyLevel: difficultyLevel,
    });
  }

  for (const payload of [
    null,
    [],
    "payload",
    { ...validBase, version: 1 },
    { ...validBase, templateId: "" },
    { ...validBase, seed: 4 },
    { ...validBase, generatorVersion: null },
    { ...validBase, solverVersion: "" },
    ...[0, 13, 1.5, "1", null].map(requestedDifficultyLevel => ({ ...validBase, requestedDifficultyLevel })),
  ]) {
    assert.equal(await verifyPuzzleToken(await signPayload(payload), secret), undefined);
  }
});

test("legacy v2 tokens can use a previous key during a deliberate rotation grace window", async () => {
  const legacyPayload = {
    version: 2,
    templateId: "tournament-order-v1",
    seed: "legacy-seed",
    generatorVersion: "yokaiba-generator-v5",
    solverVersion: "yokaiba-exhaustive-v1",
  };
  const legacyToken = await signPayload(legacyPayload, "previous-secret");

  assert.deepEqual(await verifyPuzzleToken(legacyToken, ["active-secret", "previous-secret"]), legacyPayload);
  assert.equal(await verifyPuzzleToken(legacyToken, "active-secret"), undefined);
});

test("verification rejects malformed, extra-part, tampered, and wrongly keyed tokens", async () => {
  const validToken = await issuePuzzleToken(generatePuzzle(tournamentOrderTemplate, "token-malformed"), secret);
  const [encodedPayload] = validToken.split(".");

  for (const token of [
    "",
    "missing-separator",
    "one.two.three",
    ".signature",
    "payload.",
    "%%%.signature",
    `${encodedPayload}.YQ`,
  ]) {
    assert.equal(await verifyPuzzleToken(token, secret), undefined);
  }

  const [payload, signature] = validToken.split(".");
  assert.equal(await verifyPuzzleToken(`${payload}.${signature!.slice(0, -1)}A`, secret), undefined);
  assert.equal(await verifyPuzzleToken(validToken, "different-secret"), undefined);
});
