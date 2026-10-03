import type { Difficulty } from "../domain/types.js";

const MAX_GENERATION_FIELD_LENGTH = 128;

export interface GenerationParameters {
  templateId: string;
  seed: string;
  difficultyLevel?: Difficulty["level"];
  allowSeedFallback?: true;
}

function requiredGenerationField(value: unknown, name: "templateId" | "seed"): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  if (value.length > MAX_GENERATION_FIELD_LENGTH) throw new TypeError(`${name} must be at most ${MAX_GENERATION_FIELD_LENGTH} characters`);
  return value;
}

function optionalDifficultyLevel(value: unknown): Difficulty["level"] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 12) {
    throw new TypeError("difficultyLevel must be an integer from 1 to 12");
  }
  return value as Difficulty["level"];
}

function optionalSeedFallback(value: unknown): true | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return true;
  throw new TypeError("allowSeedFallback must be a boolean");
}

function queryBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError("allowSeedFallback must be a boolean");
}

/** Validate and normalize the inputs which can affect puzzle generation. */
export function normalizeGenerationParameters(value: Record<string, unknown>): GenerationParameters {
  const allowedFields = new Set(["templateId", "seed", "difficultyLevel", "allowSeedFallback"]);
  const unknownField = Object.keys(value).find(name => !allowedFields.has(name));
  if (unknownField !== undefined) throw new TypeError(`unknown field ${unknownField}`);
  const templateId = requiredGenerationField(value.templateId, "templateId");
  const seed = requiredGenerationField(value.seed, "seed");
  const difficultyLevel = optionalDifficultyLevel(value.difficultyLevel);
  const allowSeedFallback = optionalSeedFallback(value.allowSeedFallback);
  return {
    templateId,
    seed,
    ...(difficultyLevel === undefined ? {} : { difficultyLevel: difficultyLevel as Difficulty["level"] }),
    ...(allowSeedFallback ? { allowSeedFallback } : {}),
  };
}

/** Parse GET generation inputs and reject parameters the router does not consume. */
export function parseGenerationQuery(url: URL): GenerationParameters {
  const allowedParameters = new Set(["templateId", "seed", "difficultyLevel", "allowSeedFallback"]);
  const unknownParameter = [...url.searchParams.keys()].find(name => !allowedParameters.has(name));
  if (unknownParameter !== undefined) throw new TypeError(`unknown query parameter ${unknownParameter}`);
  for (const name of allowedParameters) {
    if (url.searchParams.getAll(name).length > 1) throw new TypeError(`${name} must be provided at most once`);
  }
  const rawDifficulty = url.searchParams.get("difficultyLevel");
  const rawFallback = url.searchParams.get("allowSeedFallback");
  return normalizeGenerationParameters({
    templateId: url.searchParams.get("templateId"),
    seed: url.searchParams.get("seed"),
    ...(rawDifficulty === null ? {} : { difficultyLevel: Number(rawDifficulty) }),
    ...(rawFallback === null ? {} : { allowSeedFallback: queryBoolean(rawFallback) }),
  });
}
