import assert from "node:assert/strict";
import test from "node:test";
import { decodePuzzleTokenPayload, MAX_PUZZLE_TOKEN_TTL_SECONDS } from "../src/api/puzzle-token-payload.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { generatePuzzleForRequest } from "../src/generation/generator.js";
import { puzzleFromToken } from "../src/api/puzzle-from-token.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { issuePuzzleToken, verifyPuzzleToken } from "../src/api/puzzle-token.js";

const secret = "test-token-secret";
const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("token payload decoding validates the wire format before returning claims", () => {
  const payload = {
    version: 3,
    templateId: "test-template",
    seed: "test-seed",
    generatorVersion: "yokaiba-generator-v5",
    solverVersion: "yokaiba-exhaustive-v1",
    issuedAt: 100,
    expiresAt: 200,
    requestedDifficultyLevel: 4,
  };
  const encode = (value: unknown) => encodeBase64Url(encoder.encode(JSON.stringify(value)));

  assert.deepEqual(decodePuzzleTokenPayload(encode(payload)), payload);
  assert.equal(decodePuzzleTokenPayload("not*base64"), undefined);
  assert.equal(decodePuzzleTokenPayload(encode({ ...payload, expiresAt: payload.issuedAt })), undefined);
  assert.equal(decodePuzzleTokenPayload(encode({ ...payload, requestedDifficultyLevel: 13 })), undefined);
  assert.equal(decodePuzzleTokenPayload(encode({
    version: 2,
    templateId: "test-template",
    seed: "legacy-seed",
    generatorVersion: "yokaiba-generator-v4",
    solverVersion: "yokaiba-exhaustive-v1",
  })), undefined);
  assert.notEqual(decodePuzzleTokenPayload(encode({
    ...payload,
    issuedAt: 10,
    expiresAt: 10 + MAX_PUZZLE_TOKEN_TTL_SECONDS,
  })), undefined);
  assert.equal(decodePuzzleTokenPayload(encode({
    ...payload,
    issuedAt: 10,
    expiresAt: 11 + MAX_PUZZLE_TOKEN_TTL_SECONDS,
  })), undefined);
});

async function signPayload(payload: unknown, signingSecret = secret): Promise<string> {
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

test("issued puzzle tokens round-trip the stable generation inputs", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "token-round-trip");
  const token = await issuePuzzleToken(puzzle, secret, { now: 1_000, ttlSeconds: 300 });

  const payload = await verifyPuzzleToken(token, secret, 1_000);
  if (!payload || payload.version !== 4) assert.fail("expected v4 puzzle token");
  assert.equal(payload.templateId, puzzle.templateId);
  assert.equal(payload.seed, puzzle.seed);
  assert.equal(payload.requestedSeed, puzzle.requestedSeed);
  assert.equal(payload.generatorVersion, puzzle.generatorVersion);
  assert.equal(payload.solverVersion, puzzle.solverVersion);
  assert.equal(payload.assessedDifficultyLevel, puzzle.difficulty.level);
  assert.equal(payload.difficultyModelVersion, puzzle.difficulty.modelVersion);
  assert.equal(payload.issuedAt, 1_000);
  assert.equal(payload.expiresAt, 1_300);
  assert.match(payload.puzzleFingerprint, /^[a-f0-9]{64}$/);
});

test("v5 puzzle tokens preserve their model selection when verification replays them", async () => {
  const now = Math.floor(Date.now() / 1_000);
  const puzzle = generatePuzzleForRequest(tournamentOrderTemplate, "token-v5-replay", undefined, false, undefined, "v5");
  const token = await issuePuzzleToken(puzzle, secret, { now, ttlSeconds: 300 });
  const payload = await verifyPuzzleToken(token, secret, now);
  const replayed = await puzzleFromToken(token, new Map([[tournamentOrderTemplate.id, tournamentOrderTemplate]]), secret);

  assert.equal(payload?.version, 4);
  assert.equal(payload?.difficultyModel, "v5");
  assert.equal(replayed.difficultyModel, "v5");
  assert.equal(replayed.difficulty.modelVersion, "yokaiba-difficulty-v5");
  assert.deepEqual(replayed.clues, puzzle.clues);
  assert.deepEqual(replayed.difficultyProfile, puzzle.difficultyProfile);
});

test("historical tokens without a model keep replaying through v4 after the generator version changes", async () => {
  const now = Math.floor(Date.now() / 1_000);
  const legacyPayload = {
    version: 3,
    templateId: tournamentOrderTemplate.id,
    seed: "historical-v4-replay",
    generatorVersion: "yokaiba-generator-v5",
    solverVersion: "yokaiba-exhaustive-v1",
    issuedAt: now,
    expiresAt: now + 300,
  };
  const token = await signPayload(legacyPayload);
  const replayed = await puzzleFromToken(token, new Map([[tournamentOrderTemplate.id, tournamentOrderTemplate]]), secret);
  const expected = generatePuzzleForRequest(tournamentOrderTemplate, legacyPayload.seed, undefined, false, undefined, "v4");

  assert.equal(replayed.difficultyModel, "v4");
  assert.equal(replayed.difficulty.modelVersion, "yokaiba-difficulty-v4");
  assert.deepEqual(replayed.clues, expected.clues);
});

test("issued puzzle tokens expire and can be verified with a previous rotation key", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "token-expiry");
  const token = await issuePuzzleToken(puzzle, "old-secret", { now: 10_000, ttlSeconds: 60 });

  const verified = await verifyPuzzleToken(token, ["new-secret", "old-secret"], 10_059);
  assert.equal(verified?.version, 4);
  assert.equal(verified?.version === 4 ? verified.expiresAt : undefined, 10_060);
  assert.equal(await verifyPuzzleToken(token, ["new-secret", "old-secret"], 10_060), undefined);
  assert.equal(await verifyPuzzleToken(token, "new-secret", 10_059), undefined);
});

test("verification accepts the supported difficulty endpoints and rejects invalid signed payloads", async () => {
  const now = Math.floor(Date.now() / 1_000);
  const validBase = {
    version: 3,
    templateId: "tournament-order-v1",
    seed: "signed-seed",
    generatorVersion: "yokaiba-generator-v5",
    solverVersion: "yokaiba-exhaustive-v1",
    issuedAt: now,
    expiresAt: now + 300,
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
    { ...validBase, version: 2 },
    { ...validBase, templateId: "" },
    { ...validBase, seed: 4 },
    { ...validBase, generatorVersion: null },
    { ...validBase, solverVersion: "" },
    ...[0, 13, 1.5, "1", null].map(requestedDifficultyLevel => ({ ...validBase, requestedDifficultyLevel })),
  ]) {
    assert.equal(await verifyPuzzleToken(await signPayload(payload), secret), undefined);
  }
});

test("legacy v2 tokens are rejected even when signed by an active or previous key", async () => {
  const legacyPayload = {
    version: 2,
    templateId: "tournament-order-v1",
    seed: "legacy-seed",
    generatorVersion: "yokaiba-generator-v5",
    solverVersion: "yokaiba-exhaustive-v1",
  };
  const legacyToken = await signPayload(legacyPayload, "previous-secret");

  assert.equal(await verifyPuzzleToken(legacyToken, ["active-secret", "previous-secret"]), undefined);
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
  const tamperedSignature = `${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;
  assert.equal(await verifyPuzzleToken(`${payload}.${tamperedSignature}`, secret), undefined);
  assert.equal(await verifyPuzzleToken(validToken, "different-secret"), undefined);
});
