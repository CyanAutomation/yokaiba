import wasmModule from "../../rust/solver/target/wasm32-unknown-unknown/release/yokaiba_solver.wasm";
import { createRustPuzzleSolver, type RustSolverWasmExports } from "./rust-solver.js";

const instance = new WebAssembly.Instance(wasmModule);

export const rustWasmPuzzleSolver = createRustPuzzleSolver(instance.exports as unknown as RustSolverWasmExports);
