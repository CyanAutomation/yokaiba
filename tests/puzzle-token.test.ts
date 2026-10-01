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

async function signPayload(payload: unknown): Promise<string> {
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

test("issued puzzle tokens round-trip the stable generation inputs", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "token-round-trip");
  const token = await issuePuzzleToken(puzzle, secret);

  assert.deepEqual(await verifyPuzzleToken(token, secret), {
    version: 2,
    templateId: puzzle.templateId,
    seed: puzzle.seed,
    generatorVersion: puzzle.generatorVersion,
    solverVersion: puzzle.solverVersion,
  } satisfies PuzzleTokenPayload);
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
