import type { Clue, ClueConstraint, PuzzleSpec, Solution } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";

export const RUST_WASM_SOLVER_VERSION = "yokaiba-rust-wasm-v1";

const WIRE_MAGIC = 0x594f_4b41;
const WIRE_VERSION = 1;
const MAX_U32 = 0xffff_ffff;

/** Narrow ABI exposed by the Rust WebAssembly module. */
export interface RustSolverWasmExports {
  readonly memory: WebAssembly.Memory;
  allocate_words(length: number): number;
  release_words(pointer: number, length: number): void;
  solve_words(pointer: number, length: number): bigint;
}

function categoryIndex(spec: PuzzleSpec, categoryId: string): number {
  const index = spec.categories.findIndex(category => category.id === categoryId);
  if (index < 0) throw new Error(`unknown category: ${categoryId}`);
  return index;
}

function valueIndex(spec: PuzzleSpec, categoryId: string, value: string): number {
  const category = spec.categories[categoryIndex(spec, categoryId)]!;
  const index = category.values.indexOf(value);
  if (index < 0) throw new Error(`unknown value ${JSON.stringify(value)} in ${categoryId}`);
  return index;
}

function termWords(spec: PuzzleSpec, term: { category: string; value: string }): number[] {
  return [categoryIndex(spec, term.category), valueIndex(spec, term.category, term.value)];
}

type MatchConstraint = Extract<ClueConstraint, { kind: "matches" | "notMatches" }>;
type PositionalConstraint = Extract<ClueConstraint, { kind: "before" | "adjacent" | "sameRow" | "distance" }>;

const POSITIONAL_TAGS: Record<PositionalConstraint["kind"], number> = {
  before: 2,
  adjacent: 3,
  sameRow: 4,
  distance: 5,
};

function matchConstraintWords(spec: PuzzleSpec, constraint: MatchConstraint): number[] {
  const baseValues = spec.categories[categoryIndex(spec, spec.baseCategory)]!.values;
  const subjectRow = baseValues.indexOf(constraint.subject);
  if (subjectRow < 0) throw new Error(`unknown value ${JSON.stringify(constraint.subject)} in ${spec.baseCategory}`);
  const [category, value] = termWords(spec, { category: constraint.category, value: constraint.value });
  const tag = constraint.kind === "matches" ? 0 : 1;
  return [tag, subjectRow, category!, value!, 0, 0];
}

function positionalConstraintWords(spec: PuzzleSpec, constraint: PositionalConstraint): number[] {
  if (constraint.kind === "distance" && (!Number.isInteger(constraint.distance) || constraint.distance < 1)) {
    throw new Error("distance clues require a positive integer distance");
  }
  const [leftCategory, leftValue] = termWords(spec, constraint.left);
  const [rightCategory, rightValue] = termWords(spec, constraint.right);
  const distance = constraint.kind === "distance" ? Math.min(constraint.distance, MAX_U32) : 0;
  return [POSITIONAL_TAGS[constraint.kind], leftCategory!, leftValue!, rightCategory!, rightValue!, distance];
}

function constraintWords(spec: PuzzleSpec, constraint: ClueConstraint): number[] {
  if (constraint.kind === "matches" || constraint.kind === "notMatches") {
    return matchConstraintWords(spec, constraint);
  }
  return positionalConstraintWords(spec, constraint);
}

function encodeRequest(spec: PuzzleSpec, clues: readonly Clue[], limit: number): Uint32Array {
  const baseIndex = categoryIndex(spec, spec.baseCategory);
  const rowCount = spec.categories[baseIndex]!.values.length;
  if (rowCount < 2 || rowCount > 5) {
    throw new Error("MVP solver supports grids with 2 through 5 rows");
  }
  for (const category of spec.categories) {
    if (category.values.length !== rowCount) throw new Error("every category must have one value per base row");
  }

  const isUnlimited = limit === Number.POSITIVE_INFINITY;
  const limitMode = isUnlimited ? 0 : 1;
  // Match solveWithTelemetry: non-positive and NaN limits produce no solutions.
  const limitCount = !isUnlimited && limit > 0
    ? Math.min(MAX_U32, Math.ceil(limit))
    : 0;
  const categoryLengths = spec.categories.map(category => category.values.length);
  // Preserve TypeScript's indexOf semantics if a hand-built spec contains duplicate values.
  const canonicalValues = spec.categories.flatMap(category => category.values.map(value => category.values.indexOf(value)));
  const constraints = clues.flatMap(clue => constraintWords(spec, clue.constraint));

  return Uint32Array.from([
    WIRE_MAGIC,
    WIRE_VERSION,
    rowCount,
    spec.categories.length,
    baseIndex,
    clues.length,
    limitMode,
    limitCount,
    ...categoryLengths,
    ...canonicalValues,
    ...constraints,
  ]);
}

function decodeSolutions(spec: PuzzleSpec, words: Uint32Array): Solution[] {
  const solutionCount = words[0];
  if (solutionCount === undefined) throw new Error("Rust solver returned an empty response");
  const baseIndex = categoryIndex(spec, spec.baseCategory);
  const rowCount = spec.categories[baseIndex]!.values.length;
  const resultWords = spec.categories.filter((_category, index) => index !== baseIndex).length * rowCount;
  const expectedLength = 1 + solutionCount * resultWords;
  if (words.length !== expectedLength) throw new Error("Rust solver returned a malformed solution response");

  const solutions: Solution[] = [];
  let offset = 1;
  for (let solutionIndex = 0; solutionIndex < solutionCount; solutionIndex += 1) {
    const assignments: Record<string, string[]> = {};
    for (const [categoryPosition, category] of spec.categories.entries()) {
      if (categoryPosition === baseIndex) continue;
      const assignment: string[] = [];
      for (let row = 0; row < rowCount; row += 1) {
        const valueIndex = words[offset++]!;
        const value = category.values[valueIndex];
        if (value === undefined) throw new Error("Rust solver returned an unknown category value");
        assignment.push(value);
      }
      assignments[category.id] = assignment;
    }
    solutions.push({ assignments });
  }
  return solutions;
}

/** Adapt the compact Rust ABI to the existing deterministic solver contract. */
export function createRustPuzzleSolver(exports: RustSolverWasmExports): PuzzleSolver {
  function solve(spec: PuzzleSpec, clues: readonly Clue[], limit = Number.POSITIVE_INFINITY): Solution[] {
    const input = encodeRequest(spec, clues, limit);
    const inputPointer = exports.allocate_words(input.length);
    if (inputPointer === 0) throw new Error("Rust solver could not allocate its input buffer");

    try {
      new Uint32Array(exports.memory.buffer, inputPointer, input.length).set(input);
      const packedOutput = BigInt.asUintN(64, exports.solve_words(inputPointer, input.length));
      const outputPointer = Number((packedOutput >> 32n) & 0xffff_ffffn);
      const outputLength = Number(packedOutput & 0xffff_ffffn);
      if (outputPointer === 0) throw new Error(`Rust solver rejected its input (error ${outputLength})`);

      try {
        // decodeSolutions copies strings into JS-owned values; never return this view beyond release_words.
        const output = new Uint32Array(exports.memory.buffer, outputPointer, outputLength);
        return decodeSolutions(spec, output);
      } finally {
        exports.release_words(outputPointer, outputLength);
      }
    } finally {
      exports.release_words(inputPointer, input.length);
    }
  }

  return {
    version: RUST_WASM_SOLVER_VERSION,
    solve,
    countSolutions: (spec, clues, limit = 2) => solve(spec, clues, limit).length,
  };
}
