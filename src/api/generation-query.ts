import type { Difficulty } from "../domain/types.js";

const MAX_GENERATION_FIELD_LENGTH = 128;

export interface GenerationParameters {
  templateId: string;
  seed: string;
  difficultyLevel?: Difficulty["level"];
  allowSeedFallback?: true;
}

/** Validate and normalize the inputs which can affect puzzle generation. */
export function normalizeGenerationParameters(value: Record<string, unknown>): GenerationParameters {
  if (typeof value.templateId !== "string" || !value.templateId.trim()) throw new TypeError("templateId must be a non-empty string");
  if (typeof value.seed !== "string" || !value.seed.trim()) throw new TypeError("seed must be a non-empty string");
  if (value.templateId.length > MAX_GENERATION_FIELD_LENGTH) throw new TypeError(`templateId must be at most ${MAX_GENERATION_FIELD_LENGTH} characters`);
  if (value.seed.length > MAX_GENERATION_FIELD_LENGTH) throw new TypeError(`seed must be at most ${MAX_GENERATION_FIELD_LENGTH} characters`);
  const difficultyLevel = value.difficultyLevel;
  if (difficultyLevel !== undefined && (typeof difficultyLevel !== "number" || !Number.isInteger(difficultyLevel) || difficultyLevel < 1 || difficultyLevel > 12)) throw new TypeError("difficultyLevel must be an integer from 1 to 12");
  if (value.allowSeedFallback !== undefined && typeof value.allowSeedFallback !== "boolean") throw new TypeError("allowSeedFallback must be a boolean");
  return {
    templateId: value.templateId,
    seed: value.seed,
    ...(difficultyLevel === undefined ? {} : { difficultyLevel: difficultyLevel as Difficulty["level"] }),
    ...(value.allowSeedFallback ? { allowSeedFallback: true as const } : {}),
  };
}

/** Parse GET generation inputs, deliberately ignoring parameters the router does not consume. */
export function parseGenerationQuery(url: URL): GenerationParameters {
  const rawDifficulty = url.searchParams.get("difficultyLevel");
  const rawFallback = url.searchParams.get("allowSeedFallback");
  return normalizeGenerationParameters({
    templateId: url.searchParams.get("templateId"),
    seed: url.searchParams.get("seed"),
    ...(rawDifficulty === null ? {} : { difficultyLevel: Number(rawDifficulty) }),
    ...(rawFallback === null ? {} : { allowSeedFallback: rawFallback === "true" ? true : rawFallback === "false" ? false : rawFallback }),
  });
}
