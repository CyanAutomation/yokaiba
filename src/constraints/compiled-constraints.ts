import type { Clue, ClueConstraint, PuzzleSpec, Solution } from "../domain/types.js";

/** A clue reduced to the category assignments it needs during search. */
export interface CompiledConstraint {
  /** Non-base categories that must have a permutation before this is testable. */
  readonly requiredCategories: readonly string[];
  readonly satisfies: (assignments: Record<string, string[]>) => boolean;
}

type ConstraintPosition = (categoryId: string, value: string) => (assignments: Record<string, string[]>) => number;
type CategoryRequirements = (...categoryIds: string[]) => string[];
type Relation = (
  left: { category: string; value: string },
  right: { category: string; value: string },
  satisfies: (leftPosition: number, rightPosition: number) => boolean,
) => CompiledConstraint;

interface ConstraintCompilerContext {
  readonly baseId: string;
  readonly position: ConstraintPosition;
  readonly requirements: CategoryRequirements;
  readonly relation: Relation;
}

type ConstraintCompilers = {
  [K in ClueConstraint["kind"]]: (
    constraint: Extract<ClueConstraint, { kind: K }>,
    context: ConstraintCompilerContext,
  ) => CompiledConstraint;
};

type DirectConstraint = Extract<ClueConstraint, { kind: "matches" | "notMatches" }>;

function compileDirectConstraint(
  constraint: DirectConstraint,
  { baseId, position, requirements }: ConstraintCompilerContext,
  satisfiesRelation: (subjectPosition: number, valuePosition: number) => boolean,
): CompiledConstraint {
  const subjectPosition = position(baseId, constraint.subject);
  const valuePosition = position(constraint.category, constraint.value);
  return { requiredCategories: requirements(constraint.category), satisfies: assignments => satisfiesRelation(subjectPosition(assignments), valuePosition(assignments)) };
}

function compileMatches(constraint: Extract<ClueConstraint, { kind: "matches" }>, context: ConstraintCompilerContext): CompiledConstraint {
  return compileDirectConstraint(constraint, context, (subjectPosition, valuePosition) => subjectPosition === valuePosition);
}

function compileNotMatches(constraint: Extract<ClueConstraint, { kind: "notMatches" }>, context: ConstraintCompilerContext): CompiledConstraint {
  return compileDirectConstraint(constraint, context, (subjectPosition, valuePosition) => subjectPosition !== valuePosition);
}

function compileBefore(
  constraint: Extract<ClueConstraint, { kind: "before" }>,
  { relation }: ConstraintCompilerContext,
): CompiledConstraint {
  return relation(constraint.left, constraint.right, (left, right) => left < right);
}

function compileAdjacent(
  constraint: Extract<ClueConstraint, { kind: "adjacent" }>,
  { relation }: ConstraintCompilerContext,
): CompiledConstraint {
  return relation(constraint.left, constraint.right, (left, right) => Math.abs(left - right) === 1);
}

function compileSameRow(
  constraint: Extract<ClueConstraint, { kind: "sameRow" }>,
  { relation }: ConstraintCompilerContext,
): CompiledConstraint {
  return relation(constraint.left, constraint.right, (left, right) => left === right);
}

function compileDistance(
  constraint: Extract<ClueConstraint, { kind: "distance" }>,
  { relation }: ConstraintCompilerContext,
): CompiledConstraint {
  if (!Number.isInteger(constraint.distance) || constraint.distance < 1) throw new Error("distance clues require a positive integer distance");
  return relation(constraint.left, constraint.right, (left, right) => Math.abs(left - right) === constraint.distance);
}

const constraintCompilers: ConstraintCompilers = {
  matches: compileMatches,
  notMatches: compileNotMatches,
  before: compileBefore,
  adjacent: compileAdjacent,
  sameRow: compileSameRow,
  distance: compileDistance,
};

export function category(spec: PuzzleSpec, id: string) {
  const found = spec.categories.find(candidate => candidate.id === id);
  if (!found) throw new Error(`unknown category: ${id}`);
  return found;
}

function positionOf(spec: PuzzleSpec, solution: Solution, categoryId: string, value: string): number {
  const values = categoryId === spec.baseCategory
    ? category(spec, categoryId).values
    : solution.assignments[categoryId];
  if (!values) throw new Error(`solution has no assignment for category: ${categoryId}`);
  const result = values.indexOf(value);
  if (result < 0) throw new Error(`unknown value ${JSON.stringify(value)} in ${categoryId}`);
  return result;
}

export function satisfiesConstraint(spec: PuzzleSpec, solution: Solution, constraint: ClueConstraint): boolean {
  switch (constraint.kind) {
    case "matches":
      return positionOf(spec, solution, spec.baseCategory, constraint.subject) === positionOf(spec, solution, constraint.category, constraint.value);
    case "notMatches":
      return positionOf(spec, solution, spec.baseCategory, constraint.subject) !== positionOf(spec, solution, constraint.category, constraint.value);
    case "before":
      return positionOf(spec, solution, constraint.left.category, constraint.left.value) < positionOf(spec, solution, constraint.right.category, constraint.right.value);
    case "adjacent":
      return Math.abs(positionOf(spec, solution, constraint.left.category, constraint.left.value) - positionOf(spec, solution, constraint.right.category, constraint.right.value)) === 1;
    case "sameRow":
      return positionOf(spec, solution, constraint.left.category, constraint.left.value) === positionOf(spec, solution, constraint.right.category, constraint.right.value);
    case "distance":
      return Math.abs(positionOf(spec, solution, constraint.left.category, constraint.left.value) - positionOf(spec, solution, constraint.right.category, constraint.right.value)) === constraint.distance;
  }
}

export function compileConstraints(spec: PuzzleSpec, clues: readonly Clue[]): CompiledConstraint[] {
  const base = category(spec, spec.baseCategory);
  const knownPosition = (categoryId: string, value: string) => {
    const values = category(spec, categoryId).values;
    const position = values.indexOf(value);
    if (position < 0) throw new Error(`unknown value ${JSON.stringify(value)} in ${categoryId}`);
    return position;
  };
  const position = (categoryId: string, value: string) => {
    const fixedPosition = knownPosition(categoryId, value);
    if (categoryId === base.id) return (_assignments: Record<string, string[]>) => fixedPosition;
    return (assignments: Record<string, string[]>) => {
      const values = assignments[categoryId];
      if (!values) throw new Error(`solution has no assignment for category: ${categoryId}`);
      return values.indexOf(value);
    };
  };
  const requirements = (...categoryIds: string[]) => [...new Set(categoryIds.filter(categoryId => categoryId !== base.id))];
  const relation: Relation = (
    left: { category: string; value: string },
    right: { category: string; value: string },
    satisfies: (leftPosition: number, rightPosition: number) => boolean,
  ): CompiledConstraint => {
    const leftPosition = position(left.category, left.value);
    const rightPosition = position(right.category, right.value);
    return {
      requiredCategories: requirements(left.category, right.category),
      satisfies: assignments => satisfies(leftPosition(assignments), rightPosition(assignments)),
    };
  };

  const context: ConstraintCompilerContext = { baseId: base.id, position, requirements, relation };
  return clues.map(({ constraint }) => constraintCompilers[constraint.kind](constraint as never, context));
}
