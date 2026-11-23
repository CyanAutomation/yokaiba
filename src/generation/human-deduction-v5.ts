import type { Clue, ClueConstraint, ClueTerm, PuzzleSpec } from "../domain/types.js";
import type { PossibleRows, RelationalConstraint } from "./human-deduction-rules.js";
import { createDeductionPossibilities, satisfiesRelationship as relationHolds } from "./human-deduction-rules.js";

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
  constraint: RelationalConstraint,
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
type DirectConstraint = Extract<ClueConstraint, { kind: "matches" | "notMatches" }>;

interface DeductionTraceState {
  baseCategory: string;
  baseValues: readonly string[];
  possible: PossibleRows;
  orderedClues: readonly Clue[];
  steps: HumanDeductionStepV5[];
  reasonByElimination: Map<string, EliminationReason>;
  placementReason: Map<string, string>;
  placementClues: Map<string, string[]>;
}

interface RecordDeductionInput {
  rule: HumanDeductionRuleV5;
  clueIds: readonly string[];
  categories: readonly string[];
  dependsOn: readonly string[];
  eliminatedPossibilities: DeductionPossibilityV5[];
  placements: DeductionPlacementV5[];
  workingMemoryDemand: number;
}

interface StepLineage {
  dependsOn: string[];
  clueIds: string[];
  directClues: string[];
  categories: string[];
  dependencyDepth: number;
}

function createTraceState(spec: PuzzleSpec, clues: readonly Clue[]): DeductionTraceState {
  const { baseValues, possible } = createDeductionPossibilities(spec);
  return {
    baseCategory: spec.baseCategory,
    baseValues,
    possible,
    orderedClues: [...clues].sort((left, right) => left.id.localeCompare(right.id)),
    steps: [],
    reasonByElimination: new Map(),
    placementReason: new Map(),
    placementClues: new Map(),
  };
}

function relevantPossibilities(state: DeductionTraceState, categories: readonly string[]): number {
  return categories.reduce((total, category) => {
    const cells = state.possible.get(category);
    return total + (cells?.reduce((sum, cell) => sum + (cell.size > 1 ? cell.size : 0), 0) ?? 0);
  }, 0);
}

function priorStep(state: DeductionTraceState, id: string): HumanDeductionStepV5 | undefined {
  return state.steps.find(step => step.id === id);
}

function stepLineage(state: DeductionTraceState, input: RecordDeductionInput): StepLineage {
  const dependsOn = [...new Set(input.dependsOn)].sort();
  const directClues = [...new Set(input.clueIds)].sort();
  const inheritedClues = dependsOn.flatMap(id => priorStep(state, id)?.clueIds ?? []);
  const clueIds = [...new Set([...directClues, ...inheritedClues])].sort();
  const categories = [...new Set([
    ...input.categories,
    ...dependsOn.flatMap(id => priorStep(state, id)?.categories ?? []),
  ])].sort();
  const dependencyDepth = dependsOn.length === 0
    ? 0
    : Math.max(...dependsOn.map(id => priorStep(state, id)?.dependencyDepth ?? 0)) + 1;
  return { dependsOn, clueIds, directClues, categories, dependencyDepth };
}

function stepStrategies(state: DeductionTraceState, input: RecordDeductionInput, lineage: StepLineage): Set<HumanDeductionStrategyV5> {
  const strategies = new Set<HumanDeductionStrategyV5>();
  if (input.rule === "direct-fact") strategies.add("direct-fact");
  if (input.rule === "simple-elimination") strategies.add("elimination");
  if (input.rule === "single-candidate") strategies.add("single-candidate");
  if (input.rule === "constraint-propagation") {
    for (const clueId of lineage.directClues) {
      const clue = state.orderedClues.find(candidate => candidate.id === clueId);
      if (clue) strategyFor(clue.constraint, state.baseCategory, lineage.dependencyDepth).forEach(strategy => strategies.add(strategy));
    }
  }
  const nonBaseCategories = new Set(lineage.categories.filter(category => category !== state.baseCategory));
  if (input.rule === "constraint-propagation" && nonBaseCategories.size > 1) strategies.add("cross-category");
  if (input.rule === "single-candidate" && lineage.dependsOn.length > 0 && nonBaseCategories.size > 1) strategies.add("cross-category");
  if (lineage.dependencyDepth > 1) strategies.add("multi-step-chain");
  return strategies;
}

function estimatedCognitiveBase(rule: HumanDeductionRuleV5, strategies: ReadonlySet<HumanDeductionStrategyV5>): number {
  if (rule === "direct-fact") return 1;
  if (rule === "simple-elimination") return 1.25;
  if (rule === "single-candidate") return 1.75;
  return Math.max(2, ...[...strategies].map(strategy => {
    if (strategy === "ordering") return 3;
    if (strategy === "cross-category") return 3.5;
    return strategy === "adjacency" ? 2.5 : 2.25;
  }));
}

function createDeductionStep(
  state: DeductionTraceState,
  input: RecordDeductionInput,
  lineage: StepLineage,
  strategies: ReadonlySet<HumanDeductionStrategyV5>,
): HumanDeductionStepV5 {
  const cognitiveBase = estimatedCognitiveBase(input.rule, strategies);
  return {
    id: `d${String(state.steps.length + 1).padStart(4, "0")}`,
    rule: input.rule,
    strategy: [...strategies].sort(),
    clueIds: lineage.clueIds,
    categories: lineage.categories,
    dependsOn: lineage.dependsOn,
    eliminatedPossibilities: input.eliminatedPossibilities,
    placements: input.placements,
    dependencyDepth: lineage.dependencyDepth,
    estimatedCognitiveCost: Math.min(5, Number((cognitiveBase + Math.max(0, lineage.dependencyDepth - 1) * 0.25).toFixed(2))),
    workingMemoryDemand: Math.max(input.workingMemoryDemand, relevantPossibilities(state, lineage.categories)),
    triggeredAutomaticPropagation: false,
  };
}

function recordEliminationReasons(state: DeductionTraceState, step: HumanDeductionStepV5): void {
  for (const eliminated of step.eliminatedPossibilities) {
    state.reasonByElimination.set(termKey(eliminated.category, eliminated.row, eliminated.value), {
      deductionId: step.id,
      depth: step.dependencyDepth,
      clueIds: step.clueIds,
      categories: step.categories,
    });
  }
}

function recordPlacements(state: DeductionTraceState, step: HumanDeductionStepV5): void {
  for (const placement of step.placements) {
    const key = termKey(placement.category, placement.row, placement.value);
    state.placementReason.set(key, step.id);
    state.placementClues.set(key, step.clueIds);
  }
}

function recordDeduction(state: DeductionTraceState, input: RecordDeductionInput): HumanDeductionStepV5 {
  const lineage = stepLineage(state, input);
  const strategies = stepStrategies(state, input, lineage);
  const step = createDeductionStep(state, input, lineage, strategies);
  state.steps.push(step);
  for (const parentId of lineage.dependsOn) {
    const parent = priorStep(state, parentId);
    if (parent) parent.triggeredAutomaticPropagation = true;
  }
  recordEliminationReasons(state, step);
  recordPlacements(state, step);
  return step;
}

function directClueEliminations(constraint: DirectConstraint, possibleValues: ReadonlySet<string>): string[] {
  if (constraint.kind === "matches") return [...possibleValues].filter(value => value !== constraint.value);
  return possibleValues.has(constraint.value) ? [constraint.value] : [];
}

function directClueDependencies(
  state: DeductionTraceState,
  constraint: DirectConstraint,
  row: number,
  possibleValues: ReadonlySet<string>,
  eliminatedValues: readonly string[],
): string[] {
  if (constraint.kind !== "notMatches" || possibleValues.size !== eliminatedValues.length + 1) return [];
  return [...possibleValues]
    .filter(value => value !== constraint.value)
    .map(value => state.reasonByElimination.get(termKey(constraint.category, row, value))?.deductionId)
    .filter((id): id is string => id !== undefined);
}

function directCluePlacements(
  constraint: DirectConstraint,
  row: number,
  possibleValues: ReadonlySet<string>,
): DeductionPlacementV5[] {
  if (constraint.kind === "matches" && possibleValues.has(constraint.value)) {
    return [{ category: constraint.category, row, value: constraint.value }];
  }
  if (possibleValues.size !== 1) return [];
  return [{ category: constraint.category, row, value: [...possibleValues][0]! }];
}

function applyDirectClue(state: DeductionTraceState, clue: Clue & { constraint: DirectConstraint }): boolean {
  const constraint = clue.constraint;
  const row = state.baseValues.indexOf(constraint.subject);
  const cells = state.possible.get(constraint.category);
  if (row < 0 || !cells?.[row]) return false;

  const before = cells[row]!;
  const removed = directClueEliminations(constraint, before);
  if (removed.length === 0) return false;

  const workingMemoryDemand = relevantPossibilities(state, [constraint.category]);
  const dependsOn = directClueDependencies(state, constraint, row, before, removed);
  for (const value of removed) before.delete(value);
  recordDeduction(state, {
    rule: constraint.kind === "matches" ? "direct-fact" : "simple-elimination",
    clueIds: [clue.id],
    categories: [state.baseCategory, constraint.category],
    dependsOn,
    eliminatedPossibilities: removed.map(value => ({ category: constraint.category, row, value })),
    placements: directCluePlacements(constraint, row, before),
    workingMemoryDemand,
  });
  return true;
}

function singletonTerms(state: DeductionTraceState, categories: readonly string[]): Set<string> {
  const terms = new Set<string>();
  for (const category of categories) {
    for (const [row, cell] of (state.possible.get(category) ?? []).entries()) {
      if (cell.size === 1) terms.add(termKey(category, row, [...cell][0]!));
    }
  }
  return terms;
}

function eliminateUnsupportedRelationTerms(
  state: DeductionTraceState,
  relation: RelationalConstraint,
  side: "left" | "right",
  sourceRows: readonly number[],
  otherRows: readonly number[],
): { eliminations: DeductionPossibilityV5[]; parents: Set<string> } {
  const term = relation[side];
  const eliminations: DeductionPossibilityV5[] = [];
  const parents = new Set<string>();
  for (const row of sourceRows) {
    if (otherRows.some(other => side === "left"
      ? relationHolds(relation, row, other)
      : relationHolds(relation, other, row))) continue;
    const requiredParents = requiredParentsForRelation(
      relation,
      side,
      row,
      state.baseCategory,
      state.baseValues,
      state.possible,
      state.reasonByElimination,
    );
    requiredParents.forEach(parent => parents.add(parent));
    if (term.category === state.baseCategory) continue;
    const cell = state.possible.get(term.category)?.[row];
    if (cell?.delete(term.value)) eliminations.push({ category: term.category, row, value: term.value });
  }
  return { eliminations, parents };
}

function placementsCreatedByRelation(
  state: DeductionTraceState,
  eliminations: readonly DeductionPossibilityV5[],
  beforeSingletons: ReadonlySet<string>,
): DeductionPlacementV5[] {
  return eliminations.flatMap(eliminated => {
    const cell = state.possible.get(eliminated.category)?.[eliminated.row];
    if (cell?.size !== 1) return [];
    const placement = { category: eliminated.category, row: eliminated.row, value: [...cell][0]! };
    return beforeSingletons.has(termKey(placement.category, placement.row, placement.value)) ? [] : [placement];
  });
}

function applyRelationClue(state: DeductionTraceState, clue: Clue & { constraint: RelationalConstraint }): boolean {
  const relation = clue.constraint;
  const categories = [...new Set([relation.left.category, relation.right.category])].sort();
  const workingMemoryDemand = relevantPossibilities(state, nonBaseCategories(relation, state.baseCategory));
  const leftRows = termRows(relation.left, state.baseCategory, state.baseValues, state.possible);
  const rightRows = termRows(relation.right, state.baseCategory, state.baseValues, state.possible);
  const beforeSingletons = singletonTerms(state, categories);
  const left = eliminateUnsupportedRelationTerms(state, relation, "left", leftRows, rightRows);
  const right = eliminateUnsupportedRelationTerms(state, relation, "right", rightRows, leftRows);
  const eliminations = [...left.eliminations, ...right.eliminations];
  if (eliminations.length === 0) return false;

  const parents = new Set([...left.parents, ...right.parents]);
  recordDeduction(state, {
    rule: "constraint-propagation",
    clueIds: [clue.id],
    categories,
    dependsOn: [...parents],
    eliminatedPossibilities: eliminations,
    placements: placementsCreatedByRelation(state, eliminations, beforeSingletons),
    workingMemoryDemand,
  });
  return true;
}

function applyClue(state: DeductionTraceState, clue: Clue): boolean {
  if (clue.constraint.kind === "matches" || clue.constraint.kind === "notMatches") {
    return applyDirectClue(state, clue as Clue & { constraint: DirectConstraint });
  }
  return applyRelationClue(state, clue as Clue & { constraint: RelationalConstraint });
}

function propagateAssignedValue(state: DeductionTraceState, category: string, cells: readonly Set<string>[], row: number, value: string): boolean {
  const sourceKey = termKey(category, row, value);
  const parentId = state.placementReason.get(sourceKey);
  const workingMemoryDemand = relevantPossibilities(state, [category]);
  const removed: DeductionPossibilityV5[] = [];
  for (const [otherRow, otherCell] of cells.entries()) {
    if (otherRow !== row && otherCell.delete(value)) removed.push({ category, row: otherRow, value });
  }
  if (removed.length === 0) return false;
  recordDeduction(state, {
    rule: "single-candidate",
    clueIds: state.placementClues.get(sourceKey) ?? [],
    categories: [category],
    dependsOn: parentId ? [parentId] : [],
    eliminatedPossibilities: removed,
    placements: [],
    workingMemoryDemand,
  });
  return true;
}

function placeUniqueValue(state: DeductionTraceState, category: string, cells: readonly Set<string>[], value: string): boolean {
  const candidateRows = cells.flatMap((cell, row) => cell.has(value) ? [row] : []);
  if (candidateRows.length !== 1) return false;
  const row = candidateRows[0]!;
  const cell = cells[row]!;
  if (cell.size <= 1) return false;

  const workingMemoryDemand = relevantPossibilities(state, [category]);
  const parents = new Set<string>();
  for (let otherRow = 0; otherRow < cells.length; otherRow += 1) {
    if (otherRow === row) continue;
    const reason = state.reasonByElimination.get(termKey(category, otherRow, value));
    if (reason) parents.add(reason.deductionId);
  }
  const removed = [...cell].filter(candidate => candidate !== value).sort();
  for (const candidate of removed) cell.delete(candidate);
  recordDeduction(state, {
    rule: "single-candidate",
    clueIds: [],
    categories: [category],
    dependsOn: [...parents],
    eliminatedPossibilities: removed.map(candidate => ({ category, row, value: candidate })),
    placements: [{ category, row, value }],
    workingMemoryDemand,
  });
  return true;
}

function propagateCategory(state: DeductionTraceState, category: string, cells: readonly Set<string>[]): boolean {
  let changed = false;
  for (const [row, cell] of cells.entries()) {
    if (cell.size === 1) changed = propagateAssignedValue(state, category, cells, row, [...cell][0]!) || changed;
  }
  const values = [...new Set(cells.flatMap(cell => [...cell]))].sort();
  for (const value of values) changed = placeUniqueValue(state, category, cells, value) || changed;
  return changed;
}

function propagateSingleCandidates(state: DeductionTraceState): boolean {
  let changed = false;
  for (const [category, cells] of state.possible) changed = propagateCategory(state, category, cells) || changed;
  return changed;
}

function hasContradiction(state: DeductionTraceState): boolean {
  const domains = [...state.possible.values()].flat();
  if (domains.some(cell => cell.size === 0)) return true;
  return [...state.possible.values()].some(cells => {
    const assigned = cells.filter(cell => cell.size === 1).map(cell => [...cell][0]);
    return new Set(assigned).size !== assigned.length;
  });
}

function completeTrace(state: DeductionTraceState): HumanDeductionTraceV5 {
  const domains = [...state.possible.values()].flat();
  const contradiction = hasContradiction(state);
  const solved = !contradiction && domains.every(cell => cell.size === 1);
  const usedParents = new Set(state.steps.flatMap(step => step.dependsOn));
  for (const step of state.steps) step.triggeredAutomaticPropagation = usedParents.has(step.id);
  return {
    solved,
    usedGuessing: false,
    status: contradiction ? "contradiction" : solved ? "solved" : "stalled",
    steps: state.steps,
    maximumDependencyDepth: state.steps.reduce((maximum, step) => Math.max(maximum, step.dependencyDepth), 0),
    startingDeductions: state.steps.filter(step => step.dependencyDepth === 0).length,
    automaticPropagationSteps: state.steps.filter(step => step.triggeredAutomaticPropagation).length,
    crossCategorySteps: state.steps.filter(step => step.strategy.includes("cross-category")).length,
    unresolvedPossibilities: domains.reduce((total, cell) => total + Math.max(0, cell.size - 1), 0),
  };
}

export function evaluateHumanDeductionTraceV5(spec: PuzzleSpec, clues: readonly Clue[]): HumanDeductionTraceV5 {
  const state = createTraceState(spec, clues);
  const maximumRounds = state.baseValues.length * Math.max(1, spec.categories.length - 1) * 4;
  let changed = true;
  let rounds = 0;
  while (changed && rounds < maximumRounds) {
    rounds += 1;
    changed = false;
    for (const clue of state.orderedClues) changed = applyClue(state, clue) || changed;
    changed = propagateSingleCandidates(state) || changed;
  }
  return completeTrace(state);
}
