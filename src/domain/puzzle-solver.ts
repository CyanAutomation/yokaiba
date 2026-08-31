import type { Clue, PuzzleSpec, Solution } from "./types.js";

/**
 * A deterministic puzzle-solving capability consumed by generation and quality
 * evaluation. Implementations must preserve the documented clue semantics and
 * stop once `limit` solutions have been found.
 */
export interface PuzzleSolver {
  /** Stable identifier recorded with generated puzzles for reproducibility. */
  readonly version: string;
  solve(spec: PuzzleSpec, clues: readonly Clue[], limit?: number): Solution[];
  countSolutions(spec: PuzzleSpec, clues: readonly Clue[], limit?: number): number;
}
