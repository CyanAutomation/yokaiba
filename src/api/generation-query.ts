import { normalizeGenerationParameters, type GenerationParameters } from "./generation-parameters.js";
export { normalizeGenerationParameters } from "./generation-parameters.js";
export type { GenerationParameters } from "./generation-parameters.js";

function queryBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError("allowSeedFallback must be a boolean");
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
