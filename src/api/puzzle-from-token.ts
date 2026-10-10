import { DifficultyUnavailableError, generatePuzzleForRequest } from "../generation/generator.js";
import type { GeneratedPuzzle, PuzzleTemplate } from "../domain/types.js";
import { verifyPuzzleToken, type PuzzleTokenSecrets } from "./puzzle-token.js";
import { PuzzleActionError } from "./puzzle-action-error.js";

/** v3-v5 preserve puzzle-solution semantics for tokens issued by older releases. */
function supportsTokenGeneratorVersion(tokenVersion: string, generatedVersion: string) {
  return tokenVersion === generatedVersion || (
    ["yokaiba-generator-v2", "yokaiba-generator-v3", "yokaiba-generator-v4"].includes(tokenVersion)
    && ["yokaiba-generator-v3", "yokaiba-generator-v4", "yokaiba-generator-v5"].includes(generatedVersion)
  );
}

export async function puzzleFromToken(puzzleToken: string, templates: Map<string, PuzzleTemplate>, secrets: PuzzleTokenSecrets): Promise<GeneratedPuzzle> {
  const token = await verifyPuzzleToken(puzzleToken, secrets);
  if (!token) throw new PuzzleActionError("invalid_puzzle_token", "puzzleToken is invalid");
  const template = templates.get(token.templateId);
  if (!template) throw new PuzzleActionError("invalid_puzzle_token", "puzzleToken references an unknown template");
  let puzzle: GeneratedPuzzle;
  try {
    puzzle = generatePuzzleForRequest(template, token.seed, token.requestedDifficultyLevel);
  } catch (error) {
    if (error instanceof DifficultyUnavailableError) {
      throw new PuzzleActionError("unsupported_puzzle_version", "puzzleToken references an unsupported puzzle version");
    }
    throw error;
  }
  if (!supportsTokenGeneratorVersion(token.generatorVersion, puzzle.generatorVersion) || puzzle.solverVersion !== token.solverVersion) {
    throw new PuzzleActionError("unsupported_puzzle_version", "puzzleToken references an unsupported puzzle version");
  }
  return puzzle;
}
