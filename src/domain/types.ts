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
  /** Public catalogue and localization metadata; clue prose currently ships in English. */
  metadata?: TemplateMetadata;
}

export interface TemplateMetadata {
  locales: { default: string; supported: string[] };
  difficultyCalibration: DifficultyCalibration;
}

/** Per-template thresholds make future puzzle families independently calibratable. */
export interface DifficultyCalibration {
  modelVersion: string;
  /** Inclusive upper bounds for every level except the final level in this template's range. */
  scoreThresholds: number[];
  /** Inclusive global difficulty levels this template is calibrated to produce. */
  levelRange: [DifficultyLevel, DifficultyLevel];
  corpus: { sampleSize: number; methodology: string };
}

export type PuzzleSpec = PuzzleTemplate;
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type ClueConstraint =
  | { kind: "matches"; subject: string; category: string; value: string }
  | { kind: "notMatches"; subject: string; category: string; value: string }
  | { kind: "before"; left: ClueTerm; right: ClueTerm }
  | { kind: "adjacent"; left: ClueTerm; right: ClueTerm }
  /** The two values occur on the same base row, possibly in different categories. */
  | { kind: "sameRow"; left: ClueTerm; right: ClueTerm }
  /** The two values are separated by exactly this many base rows. */
  | { kind: "distance"; left: ClueTerm; right: ClueTerm; distance: number };

export interface ClueTerm {
  category: string;
  value: string;
}

export interface Clue {
  id: string;
  constraint: ClueConstraint;
  text: string;
  /** Stable renderer choice, allowing a puzzle's prose to be replayed exactly. */
  phraseVariant?: string;
  /** Version of the phrase catalogue used to render this clue. */
  languageVersion?: string;
}

/** A complete hidden assignment. Each non-base category maps row index to value. */
export interface Solution {
  assignments: Record<string, string[]>;
}

/** Public, deterministic difficulty assessment for the current puzzle. */
export interface Difficulty {
  level: DifficultyLevel;
  label: string;
  modelVersion: string;
  /** Stable inputs used to classify this puzzle; timings are deliberately excluded. */
  evidence: {
    score: number;
    humanSolve: { solved: boolean; totalCost: number; hardestStep: number; deductionPasses: number };
    clueStructure: { directClues: number; relationalClues: number; crossCategoryClues: number };
    solver: { nodesVisited: number; constraintChecks: number };
  };
}

export interface GeneratedPuzzle {
  id: string;
  /** Stable caller-selected identity, including difficulty-selected puzzles. */
  requestedSeed: string;
  seed: string;
  templateId: string;
  generatorVersion: string;
  solverVersion: string;
  spec: PuzzleSpec;
  clues: Clue[];
  difficulty: Difficulty;
  /** Present only when a target difficulty selected a clue-generation strategy. */
  requestedDifficultyLevel?: Difficulty["level"];
  generationStrategy?: number;
  /** Retained by trusted callers only; REST/MCP generation responses redact this. */
  solution: Solution;
}
