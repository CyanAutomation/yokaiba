import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Clue, PuzzleTemplate } from "../src/domain/types.js";
import type { PuzzleSolver } from "../src/domain/puzzle-solver.js";
import { countSolutions as countTypeScriptSolutions, exhaustivePuzzleSolver, solve as solveTypeScript } from "../src/constraints/solver.js";
import { createRustPuzzleSolver, type RustSolverWasmExports } from "../src/constraints/rust-solver.js";
import { generatePuzzleForRequest } from "../src/generation/generator.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";

const threeRowSpec: PuzzleTemplate = {
  id: "rust-parity-three-row",
  title: "Rust parity three row",
  baseCategory: "person",
  categories: [
    { id: "color", label: "Color", values: ["Blue", "Green", "Red"] },
    { id: "person", label: "Person", values: ["Ada", "Bert", "Cora"] },
    { id: "medal", label: "Medal", values: ["Gold", "Silver", "Bronze"] },
  ],
};

const threeRowClues: Clue[] = [
  { id: "matches", text: "", constraint: { kind: "matches", subject: "Ada", category: "color", value: "Blue" } },
  { id: "not-matches", text: "", constraint: { kind: "notMatches", subject: "Bert", category: "medal", value: "Gold" } },
  { id: "before", text: "", constraint: { kind: "before", left: { category: "color", value: "Blue" }, right: { category: "medal", value: "Bronze" } } },
  { id: "adjacent", text: "", constraint: { kind: "adjacent", left: { category: "person", value: "Bert" }, right: { category: "medal", value: "Bronze" } } },
  { id: "same-row", text: "", constraint: { kind: "sameRow", left: { category: "color", value: "Red" }, right: { category: "medal", value: "Bronze" } } },
  { id: "distance", text: "", constraint: { kind: "distance", left: { category: "person", value: "Ada" }, right: { category: "color", value: "Red" }, distance: 2 } },
];

const twoRowSpec: PuzzleTemplate = {
  id: "rust-parity-two-row",
  title: "Rust parity two row",
  baseCategory: "person",
  categories: [
    { id: "person", label: "Person", values: ["Ada", "Bert"] },
    { id: "place", label: "Place", values: ["North", "South"] },
  ],
};

let rustSolver: PuzzleSolver;

test.before(async () => {
  const wasmBytes = await readFile(new URL("../rust/solver/target/wasm32-unknown-unknown/release/yokaiba_solver.wasm", import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasmBytes) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  rustSolver = createRustPuzzleSolver(instance.exports as unknown as RustSolverWasmExports);
});

test("Rust solver matches TypeScript results and ordering for every constraint kind", () => {
  assert.deepEqual(rustSolver.solve(threeRowSpec, threeRowClues), solveTypeScript(threeRowSpec, threeRowClues));
  assert.equal(rustSolver.countSolutions(threeRowSpec, threeRowClues, 2), countTypeScriptSolutions(threeRowSpec, threeRowClues, 2));
});

test("Rust solver preserves solution limits, including zero and unlimited", () => {
  for (const limit of [0, 1, 2, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(rustSolver.solve(twoRowSpec, [], limit), solveTypeScript(twoRowSpec, [], limit), `limit ${limit}`);
  }
});

test("Rust solver matches TypeScript for negative and NaN limits", () => {
  for (const limit of [-1, Number.NaN]) {
    assert.deepEqual(rustSolver.solve(twoRowSpec, [], limit), solveTypeScript(twoRowSpec, [], limit), `limit ${limit}`);
  }
});

test("Rust solver supports a base-only puzzle and the maximum grid size", () => {
  const baseOnly: PuzzleTemplate = {
    id: "rust-parity-base-only",
    title: "Base only",
    baseCategory: "person",
    categories: [{ id: "person", label: "Person", values: ["Ada", "Bert"] }],
  };
  assert.deepEqual(rustSolver.solve(baseOnly, []), solveTypeScript(baseOnly, []));

  const fiveRows: PuzzleTemplate = {
    ...twoRowSpec,
    id: "rust-parity-five-row",
    categories: [
      { id: "person", label: "Person", values: ["A", "B", "C", "D", "E"] },
      { id: "place", label: "Place", values: ["1", "2", "3", "4", "5"] },
    ],
  };
  assert.deepEqual(rustSolver.solve(fiveRows, [], 2), solveTypeScript(fiveRows, [], 2));
});

test("Rust solver preserves indexOf behavior for duplicate category values", () => {
  const duplicateValues: PuzzleTemplate = {
    id: "rust-parity-duplicate-values",
    title: "Duplicate values",
    baseCategory: "person",
    categories: [
      { id: "person", label: "Person", values: ["Ada", "Bert"] },
      { id: "color", label: "Color", values: ["Same", "Same"] },
    ],
  };
  const clues: Clue[] = [{
    id: "first-match",
    text: "",
    constraint: { kind: "matches", subject: "Ada", category: "color", value: "Same" },
  }];

  assert.deepEqual(rustSolver.solve(duplicateValues, clues), solveTypeScript(duplicateValues, clues));
});

test("Rust solver rejects unsupported row counts with the TypeScript contract error", () => {
  const sixRows: PuzzleTemplate = {
    ...twoRowSpec,
    id: "rust-parity-six-row",
    categories: [
      { id: "person", label: "Person", values: ["A", "B", "C", "D", "E", "F"] },
      { id: "place", label: "Place", values: ["1", "2", "3", "4", "5", "6"] },
    ],
  };
  assert.throws(() => rustSolver.countSolutions(sixRows, []), new Error("MVP solver supports grids with 2 through 5 rows"));
});

test("Rust solver keeps a complete 5-row generation result identical to the TypeScript backend", () => {
  const seed = "rust-go-eval-2";
  const typescriptPuzzle = generatePuzzleForRequest(openDivisionTemplate, seed, 8, false, exhaustivePuzzleSolver);
  const rustPuzzle = generatePuzzleForRequest(openDivisionTemplate, seed, 8, false, rustSolver);

  assert.deepEqual({ ...rustPuzzle, solverVersion: typescriptPuzzle.solverVersion }, typescriptPuzzle);
});
