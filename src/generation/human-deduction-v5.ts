import type { Clue, ClueConstraint, ClueTerm, PuzzleSpec } from "../domain/types.js";
import type { PossibleRows } from "./human-deduction-rules.js";
import { createDeductionPossibilities } from "./human-deduction-rules.js";

export type HumanDeductionRuleV5 = "direct-fact" | "simple-elimination" | "single-candidate" | "constraint-propagation";
export type HumanDeductionStrategyV5 = "direct-fact" | "elimination" | "single-candidate" | "relational" | "ordering" | "adjacency" | "same-row" | "distance" | "cross-category" | "multi-step-chain";

export interface DeductionPossibilityV5 {
  category: string;
  row: number;
  value: string;
}

export interface DeductionPlacementV5 extends DeductionPossibilityV5 {}

export interface HumanDeductionStepV5 {
  id: string;
  rule: HumanDeductionRuleV5;
  strategy: HumanDeductionStrategyV5[];
  clueIds: string[];
  categories: string[];
  dependsOn: string[];
  eliminatedPossibilities: DeductionPossibilityV5[];
  placements: DeductionPlacementV5[];
  dependencyDepth: number;
  estimatedCognitiveCost: number;
  workingMemoryDemand: number;
  triggeredAutomaticPropagation: boolean;
}

export interface HumanDeductionTraceV5 {
  solved: boolean;
  usedGuessing: false;
  status: "solved" | "stalled" | "contradiction";
  steps: HumanDeductionStepV5[];
  maximumDependencyDepth: number;
  startingDeductions: number;
  automaticPropagationSteps: number;
  crossCategorySteps: number;
  unresolvedPossibilities: number;
}

type EliminationReason = { deductionId: string; depth: number; clueIds: string[]; categories: string[] };
type Term = ClueTerm;

function termKey(category: string, row: number, value: string): string {
  return `${category}\u0000${row}\u0000${value}`;
}

function nonBaseCategories(constraint: ClueConstraint, baseCategory: string): string[] {
  const categories = constraint.kind === "matches" || constraint.kind === "notMatches"
    ? [constraint.category]
    : [constraint.left.category, constraint.right.category];
  return [...new Set(categories.filter(category => category !== baseCategory))].sort();
}

function termRows(term: Term, baseCategory: string, baseValues: readonly string[], possible: PossibleRows): number[] {
  if (term.category === baseCategory) {
    const row = baseValues.indexOf(term.value);
    return row < 0 ? [] : [row];
  }
  return (possible.get(term.category) ?? []).flatMap((cell, row) => cell.has(term.value) ? [row] : []);
}

function relationHolds(constraint: Exclude<ClueConstraint, { kind: "matches" | "notMatches" }>, left: number, right: number): boolean {
  switch (constraint.kind) {
    case "before": return left < right;
    case "sameRow": return left === right;
    case "distance": return Math.abs(left - right) === constraint.distance;
    case "adjacent": return Math.abs(left - right) === 1;
  }
}

function strategyFor(constraint: ClueConstraint, baseCategory: string, depth: number): HumanDeductionStrategyV5[] {
  const tags = new Set<HumanDeductionStrategyV5>();
  if (constraint.kind === "matches") tags.add("direct-fact");
  else if (constraint.kind === "notMatches") tags.add("elimination");
  else {
    tags.add("relational");
    if (constraint.kind === "before") tags.add("ordering");
    if (constraint.kind === "adjacent") tags.add("adjacency");
    if (constraint.kind === "sameRow") tags.add("same-row");
    if (constraint.kind === "distance") tags.add("distance");
    const involvedCategories = new Set([constraint.left.category, constraint.right.category].filter(category => category !== baseCategory));
    if (involvedCategories.size > 1) tags.add("cross-category");
  }
  if (depth > 1) tags.add("multi-step-chain");
  return [...tags].sort();
}

function requiredParentsForRelation(
  constraint: Exclude<ClueConstraint, { kind: "matches" | "notMatches" }>,
  side: "left" | "right",
  candidateRow: number,
  baseCategory: string,
  baseValues: readonly string[],
  possible: PossibleRows,
  reasonByElimination: Map<string, EliminationReason>,
): string[] {
  const candidateTerm = constraint[side];
  const otherTerm = constraint[side === "left" ? "right" : "left"];
  const validRows = Array.from({ length: baseValues.length }, (_value, row) => row)
    .filter(row => side === "left"
      ? relationHolds(constraint, candidateRow, row)
      : relationHolds(constraint, row, candidateRow));
  const liveRows = new Set(termRows(otherTerm, baseCategory, baseValues, possible));
  const parents = new Set<string>();
  for (const row of validRows) {
    if (liveRows.has(row)) continue;
    const reason = reasonByElimination.get(termKey(otherTerm.category, row, otherTerm.value));
    if (reason) parents.add(reason.deductionId);
  }
  // The direct relation itself is sufficient when the opposite term is fixed
  // by the base row and there is no prior elimination to cite.
  return [...parents].sort();
}

/**
 * Build a deterministic, no-guess trace from public clue constraints. The
 * hidden solution is never accepted as input or consulted by this evaluator.
 */
export function evaluateHumanDeductionTraceV5(spec: PuzzleSpec, clues: readonly Clue[]): HumanDeductionTraceV5 {
  const { baseValues, possible } = createDeductionPossibilities(spec);
  const baseCategory = spec.baseCategory;
  const orderedClues = [...clues].sort((left, right) => left.id.localeCompare(right.id));
  const steps: HumanDeductionStepV5[] = [];
  const reasonByElimination = new Map<string, EliminationReason>();
  const placementReason = new Map<string, string>();
  const placementClues = new Map<string, string[]>();

  const record = (input: {
    rule: HumanDeductionRuleV5;
    clueIds: readonly string[];
    categories: readonly string[];
    dependsOn: readonly string[];
    eliminatedPossibilities: DeductionPossibilityV5[];
    placements: DeductionPlacementV5[];
    workingMemoryDemand: number;
  }): HumanDeductionStepV5 => {
    const dependsOn = [...new Set(input.dependsOn)].sort();
    const directClues = [...new Set(input.clueIds)].sort();
    const inheritedClues = dependsOn.flatMap(id => steps.find(step => step.id === id)?.clueIds ?? []);
    const clueIds = [...new Set([...directClues, ...inheritedClues])].sort();
    const categories = [...new Set([
      ...input.categories,
      ...dependsOn.flatMap(id => steps.find(step => step.id === id)?.categories ?? []),
    ])].sort();
    const dependencyDepth = dependsOn.length === 0 ? 0 : Math.max(...dependsOn.map(id => steps.find(step => step.id === id)?.dependencyDepth ?? 0)) + 1;
    const strategies = new Set<HumanDeductionStrategyV5>();
    if (input.rule === "direct-fact") strategies.add("direct-fact");
    if (input.rule === "simple-elimination") strategies.add("elimination");
    if (input.rule === "single-candidate") strategies.add("single-candidate");
    if (input.rule === "constraint-propagation") {
      for (const clueId of directClues) {
        const clue = orderedClues.find(candidate => candidate.id === clueId);
        if (clue) strategyFor(clue.constraint, baseCategory, dependencyDepth).forEach(strategy => strategies.add(strategy));
      }
    }
    const nonBaseCategories = new Set(categories.filter(category => category !== baseCategory));
    if (input.rule === "constraint-propagation" && nonBaseCategories.size > 1) strategies.add("cross-category");
    if (input.rule === "single-candidate" && dependsOn.length > 0 && nonBaseCategories.size > 1) strategies.add("cross-category");
    if (dependencyDepth > 1) strategies.add("multi-step-chain");
    const cognitiveBase = input.rule === "direct-fact" ? 1
      : input.rule === "simple-elimination" ? 1.25
        : input.rule === "single-candidate" ? 1.75
          : Math.max(2, ...[...strategies].map(strategy => strategy === "ordering" ? 3 : strategy === "cross-category" ? 3.5 : strategy === "adjacency" ? 2.5 : 2.25));
    const step: HumanDeductionStepV5 = {
      id: `d${String(steps.length + 1).padStart(4, "0")}`,
      rule: input.rule,
      strategy: [...strategies].sort(),
      clueIds,
      categories,
      dependsOn,
      eliminatedPossibilities: input.eliminatedPossibilities,
      placements: input.placements,
      dependencyDepth,
      estimatedCognitiveCost: Math.min(5, Number((cognitiveBase + Math.max(0, dependencyDepth - 1) * 0.25).toFixed(2))),
      // Include unresolved categories carried forward by the prerequisite chain.
      workingMemoryDemand: Math.max(input.workingMemoryDemand, relevantPossibilities(categories)),
      triggeredAutomaticPropagation: false,
    };
    steps.push(step);
    for (const parentId of dependsOn) {
      const parent = steps.find(candidate => candidate.id === parentId);
      if (parent) parent.triggeredAutomaticPropagation = true;
    }
    for (const eliminated of input.eliminatedPossibilities) {
      reasonByElimination.set(termKey(eliminated.category, eliminated.row, eliminated.value), {
        deductionId: step.id,
        depth: dependencyDepth,
        clueIds,
        categories,
      });
    }
    for (const placement of input.placements) {
      const key = termKey(placement.category, placement.row, placement.value);
      placementReason.set(key, step.id);
      placementClues.set(key, clueIds);
    }
    return step;
  };

  const relevantPossibilities = (categories: readonly string[]): number => categories.reduce((total, category) => {
    const cells = possible.get(category);
    return total + (cells?.reduce((sum, cell) => sum + (cell.size > 1 ? cell.size : 0), 0) ?? 0);
  }, 0);

  let changed = true;
  let rounds = 0;
  const maximumRounds = baseValues.length * Math.max(1, spec.categories.length - 1) * 4;
  while (changed && rounds < maximumRounds) {
    rounds += 1;
    changed = false;
    for (const clue of orderedClues) {
      const constraint = clue.constraint;
      if (constraint.kind === "matches" || constraint.kind === "notMatches") {
        const row = baseValues.indexOf(constraint.subject);
        const cells = possible.get(constraint.category);
        if (row < 0 || !cells?.[row]) continue;
        const before = cells[row]!;
        const categories = [baseCategory, constraint.category];
        const workingMemoryDemand = relevantPossibilities([constraint.category]);
        const removed = constraint.kind === "matches"
          ? [...before].filter(value => value !== constraint.value)
          : before.has(constraint.value) ? [constraint.value] : [];
        if (removed.length === 0) continue;
        const parentIds = constraint.kind === "notMatches" && before.size === removed.length + 1
          ? [...before].filter(value => value !== constraint.value)
            .map(value => reasonByElimination.get(termKey(constraint.category, row, value))?.deductionId)
            .filter((id): id is string => id !== undefined)
          : [];
        for (const value of removed) before.delete(value);
        const placements = constraint.kind === "matches" && before.has(constraint.value)
          ? [{ category: constraint.category, row, value: constraint.value }]
          : before.size === 1
            ? [{ category: constraint.category, row, value: [...before][0]! }]
            : [];
        record({
          rule: constraint.kind === "matches" ? "direct-fact" : "simple-elimination",
          clueIds: [clue.id], categories, dependsOn: parentIds,
          eliminatedPossibilities: removed.map(value => ({ category: constraint.category, row, value })),
          placements, workingMemoryDemand,
        });
        changed = true;
        continue;
      }

      const categories = [...new Set([constraint.left.category, constraint.right.category])].sort();
      const workingMemoryCategories = nonBaseCategories(constraint, baseCategory);
      const workingMemoryDemand = relevantPossibilities(workingMemoryCategories);
      const leftRows = termRows(constraint.left, baseCategory, baseValues, possible);
      const rightRows = termRows(constraint.right, baseCategory, baseValues, possible);
      const relation = constraint as Exclude<ClueConstraint, { kind: "matches" | "notMatches" }>;
      const eliminations: DeductionPossibilityV5[] = [];
      const parents = new Set<string>();
      const beforeSingletons = new Set<string>();
      for (const category of categories) for (const [row, cell] of (possible.get(category) ?? []).entries()) {
        if (cell.size === 1) beforeSingletons.add(termKey(category, row, [...cell][0]!));
      }
      for (const row of leftRows) {
        if (!rightRows.some(other => relationHolds(relation, row, other))) {
          const reasonParents = requiredParentsForRelation(relation, "left", row, baseCategory, baseValues, possible, reasonByElimination);
          reasonParents.forEach(parent => parents.add(parent));
          if (constraint.left.category !== baseCategory) {
            const cell = possible.get(constraint.left.category)?.[row];
            if (cell?.delete(constraint.left.value)) eliminations.push({ category: constraint.left.category, row, value: constraint.left.value });
          }
        }
      }
      for (const row of rightRows) {
        if (!leftRows.some(other => relationHolds(relation, other, row))) {
          const reasonParents = requiredParentsForRelation(relation, "right", row, baseCategory, baseValues, possible, reasonByElimination);
          reasonParents.forEach(parent => parents.add(parent));
          if (constraint.right.category !== baseCategory) {
            const cell = possible.get(constraint.right.category)?.[row];
            if (cell?.delete(constraint.right.value)) eliminations.push({ category: constraint.right.category, row, value: constraint.right.value });
          }
        }
      }
      if (eliminations.length > 0) {
        const placements = eliminations.flatMap(eliminated => {
          const cell = possible.get(eliminated.category)?.[eliminated.row];
          if (cell?.size !== 1) return [];
          const placement = { category: eliminated.category, row: eliminated.row, value: [...cell][0]! };
          return beforeSingletons.has(termKey(placement.category, placement.row, placement.value)) ? [] : [placement];
        });
        record({
          rule: "constraint-propagation", clueIds: [clue.id], categories,
          dependsOn: [...parents], eliminatedPossibilities: eliminations, placements, workingMemoryDemand,
        });
        changed = true;
      }
    }

    for (const [category, cells] of possible) {
      for (const [row, cell] of cells.entries()) {
        if (cell.size !== 1) continue;
        const value = [...cell][0]!;
        const sourceKey = termKey(category, row, value);
        const parentId = placementReason.get(sourceKey);
        const workingMemoryDemand = relevantPossibilities([category]);
        const removed: DeductionPossibilityV5[] = [];
        for (const [otherRow, otherCell] of cells.entries()) {
          if (otherRow !== row && otherCell.delete(value)) removed.push({ category, row: otherRow, value });
        }
        if (removed.length > 0) {
          record({
            rule: "single-candidate", clueIds: placementClues.get(sourceKey) ?? [], categories: [category],
            dependsOn: parentId ? [parentId] : [], eliminatedPossibilities: removed, placements: [],
            workingMemoryDemand,
          });
          changed = true;
        }
      }
      for (const value of [...new Set(cells.flatMap(cell => [...cell]))].sort()) {
        const candidateRows = cells.flatMap((cell, row) => cell.has(value) ? [row] : []);
        if (candidateRows.length !== 1) continue;
        const row = candidateRows[0]!;
        const cell = cells[row]!;
        if (cell.size <= 1) continue;
        const workingMemoryDemand = relevantPossibilities([category]);
        const parents = new Set<string>();
        for (let otherRow = 0; otherRow < cells.length; otherRow += 1) {
          if (otherRow === row) continue;
          const reason = reasonByElimination.get(termKey(category, otherRow, value));
          if (reason) parents.add(reason.deductionId);
        }
        const removed = [...cell].filter(candidate => candidate !== value).sort();
        for (const candidate of removed) cell.delete(candidate);
        record({
          rule: "single-candidate", clueIds: [], categories: [category], dependsOn: [...parents],
          eliminatedPossibilities: removed.map(candidate => ({ category, row, value: candidate })),
          placements: [{ category, row, value }], workingMemoryDemand,
        });
        changed = true;
      }
    }
  }

  const domains = [...possible.values()].flat();
  const contradiction = domains.some(cell => cell.size === 0)
    || [...possible.values()].some(cells => {
      const assigned = cells.filter(cell => cell.size === 1).map(cell => [...cell][0]);
      return new Set(assigned).size !== assigned.length;
    });
  const solved = !contradiction && domains.every(cell => cell.size === 1);
  const usedParents = new Set(steps.flatMap(step => step.dependsOn));
  for (const step of steps) step.triggeredAutomaticPropagation = usedParents.has(step.id);
  return {
    solved,
    usedGuessing: false,
    status: contradiction ? "contradiction" : solved ? "solved" : "stalled",
    steps,
    maximumDependencyDepth: steps.reduce((maximum, step) => Math.max(maximum, step.dependencyDepth), 0),
    startingDeductions: steps.filter(step => step.dependencyDepth === 0).length,
    automaticPropagationSteps: steps.filter(step => step.triggeredAutomaticPropagation).length,
    crossCategorySteps: steps.filter(step => step.strategy.includes("cross-category")).length,
    unresolvedPossibilities: domains.reduce((total, cell) => total + Math.max(0, cell.size - 1), 0),
  };
}
