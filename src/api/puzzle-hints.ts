import type { GeneratedPuzzle } from "../domain/types.js";

export type HintKind = "clue" | "elimination";

export type PuzzleHint =
  { kind: "clue" | "elimination"; clue: { id: string; text: string } };

function clueHint(puzzle: GeneratedPuzzle, kind: HintKind, hintIndex: number): PuzzleHint {
  const candidates = kind === "elimination"
    ? puzzle.clues.filter(candidate => candidate.constraint.kind === "notMatches")
    : puzzle.clues;
  const pool = candidates.length > 0 ? candidates : puzzle.clues;
  if (pool.length === 0) throw new Error("No clues available for hints");
  const clue = pool[hintIndex % pool.length]!;
  return { kind: kind === "elimination" && clue.constraint.kind === "notMatches" ? "elimination" : "clue", clue: { id: clue.id, text: clue.text } };
}

/** Return one public clue at a deterministic index; no hint contains a solution placement. */
export function puzzleHint(puzzle: GeneratedPuzzle, kind: HintKind = "clue", hintIndex = 0): PuzzleHint {
  return clueHint(puzzle, kind, hintIndex);
}
