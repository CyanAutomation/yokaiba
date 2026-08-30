export interface Category {
  id: string;
  label: string;
  values: string[];
  /** Values have a natural order suitable for before/after clues. */
  ordered?: boolean;
}

export interface PuzzleTemplate {
  id: string;
  title: string;
  baseCategory: string;
  categories: Category[];
}

export type PuzzleSpec = PuzzleTemplate;

export type ClueConstraint =
  | { kind: "matches"; subject: string; category: string; value: string }
  | { kind: "notMatches"; subject: string; category: string; value: string }
  | { kind: "before"; left: ClueTerm; right: ClueTerm }
  | { kind: "adjacent"; left: ClueTerm; right: ClueTerm };

export interface ClueTerm {
  category: string;
  value: string;
}

export interface Clue {
  id: string;
  constraint: ClueConstraint;
  text: string;
}

/** A complete hidden assignment. Each non-base category maps row index to value. */
export interface Solution {
  assignments: Record<string, string[]>;
}

/** Public, deterministic difficulty assessment for the current puzzle. */
export interface Difficulty {
  level: 1 | 2 | 3 | 4 | 5;
  label: "Very easy" | "Easy" | "Moderate" | "Hard" | "Very hard";
  modelVersion: string;
}

export interface GeneratedPuzzle {
  id: string;
  seed: string;
  templateId: string;
  generatorVersion: string;
  solverVersion: string;
  spec: PuzzleSpec;
  clues: Clue[];
  difficulty: Difficulty;
  /** Retained by trusted callers only; REST/MCP generation responses redact this. */
  solution: Solution;
}
