import type { GeneratedPuzzle } from "../domain/types.js";

export const PUZZLE_FINGERPRINT_VERSION = 1;

export function selectedDifficultyModel(puzzle: Pick<GeneratedPuzzle, "difficultyModel" | "difficulty">): "v4" | "v5" | "compare" {
  return puzzle.difficultyModel ?? (puzzle.difficulty.modelVersion.endsWith("v5") ? "v5" : "v4");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Hashes the complete public generated puzzle and the metadata needed to replay it. */
export async function puzzleFingerprint(puzzle: GeneratedPuzzle): Promise<string> {
  const canonicalPuzzle = stableJson({
    fingerprintVersion: PUZZLE_FINGERPRINT_VERSION,
    templateId: puzzle.templateId,
    requestedSeed: puzzle.requestedSeed,
    seed: puzzle.seed,
    generatorVersion: puzzle.generatorVersion,
    solverVersion: puzzle.solverVersion,
    difficultyModel: selectedDifficultyModel(puzzle),
    requestedDifficultyLevel: puzzle.requestedDifficultyLevel ?? null,
    assessedDifficultyLevel: puzzle.difficulty.level,
    difficultyModelVersion: puzzle.difficulty.modelVersion,
    generationStrategy: puzzle.generationStrategy ?? null,
    seedFallbackAttempt: puzzle.seedFallbackAttempt ?? null,
    spec: puzzle.spec,
    clues: puzzle.clues,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPuzzle));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
