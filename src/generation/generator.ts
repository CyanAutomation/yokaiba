import type { Clue, GeneratedPuzzle, PuzzleTemplate, Solution } from "../domain/types.js";
import { countSolutions } from "../constraints/solver.js";

export const GENERATOR_VERSION = "yokaiba-generator-v1";
export const SOLVER_VERSION = "yokaiba-exhaustive-v1";

function hash(seed: string): number {
  let value = 2166136261;
  for (const character of seed) { value ^= character.codePointAt(0)!; value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function random(seed: string) {
  let state = hash(seed) || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2 ** 32; };
}

function shuffled<T>(values: readonly T[], next: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function validateTemplate(template: PuzzleTemplate) {
  const base = template.categories.find(category => category.id === template.baseCategory);
  if (!base) throw new Error("template baseCategory must exist");
  if (new Set(template.categories.map(category => category.id)).size !== template.categories.length) throw new Error("template category IDs must be unique");
  if (new Set(base.values).size !== base.values.length) throw new Error("base values must be unique");
  for (const category of template.categories) {
    if (category.values.length !== base.values.length || new Set(category.values).size !== category.values.length) throw new Error("each category needs unique values matching base row count");
  }
}

function makeSolution(template: PuzzleTemplate, next: () => number): Solution {
  return {
    assignments: Object.fromEntries(template.categories.filter(category => category.id !== template.baseCategory)
      .map(category => [category.id, shuffled(category.values, next)])),
  };
}

function directCandidates(template: PuzzleTemplate, solution: Solution, next: () => number): Clue[] {
  const base = template.categories.find(category => category.id === template.baseCategory)!;
  const candidates: Clue[] = [];
  for (const category of template.categories) {
    if (category.id === template.baseCategory) continue;
    for (const [row, value] of solution.assignments[category.id].entries()) {
      const subject = base.values[row];
      candidates.push({
        id: `matches-${category.id}-${row}`,
        constraint: { kind: "matches", subject, category: category.id, value },
        text: `${subject} was associated with ${value}.`,
      });
    }
  }
  return shuffled(candidates, next);
}

/**
 * Select a clue subset that establishes uniqueness, then remove every
 * individually redundant clue. The candidate pool is intentionally direct in
 * v1; the solver already supports relational constraints for template v2.
 */
export function generatePuzzle(template: PuzzleTemplate, seed: string): GeneratedPuzzle {
  validateTemplate(template);
  const next = random(`${template.id}:${seed}`);
  const solution = makeSolution(template, next);
  const selected: Clue[] = [];
  for (const clue of directCandidates(template, solution, next)) {
    if (countSolutions(template, selected, 2) === 1) break;
    selected.push(clue);
  }
  if (countSolutions(template, selected, 2) !== 1) throw new Error("candidate pool did not establish uniqueness");
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const without = selected.filter((_clue, candidateIndex) => candidateIndex !== index);
    if (countSolutions(template, without, 2) === 1) selected.splice(index, 1);
  }
  return {
    id: `${template.id}:${seed}`,
    seed,
    templateId: template.id,
    generatorVersion: GENERATOR_VERSION,
    solverVersion: SOLVER_VERSION,
    spec: template,
    clues: selected,
    solution,
  };
}
