import assert from "node:assert/strict";
import test from "node:test";
import {
  countSolutions,
  exhaustivePuzzleSolver,
  evaluatePuzzleQuality,
  renderClues,
  aggregateDifficultyAuditRecords,
  auditDifficultyCorpus,
  auditTargetedDifficultyCorpus,
  difficultyStrategyLimitForFallback,
  isIjfSeniorMensWeightClass,
  isClueTextReadable,
  satisfiesConstraint,
  solve,
  solveWithTelemetry,
  type Clue,
  type DifficultyAuditRecord,
  type PuzzleSolver,
  type PuzzleTemplate,
} from "../src/index.js";
import {
  DifficultyUnavailableError,
  generatePuzzle,
  generateProgressivePuzzle,
  generatePuzzleAtDifficulty,
  generatePuzzleAtDifficultyWithFallback,
} from "../src/generation/generator.js";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";

const template: PuzzleTemplate = {
  id: "test-tournament",
  title: "Test tournament",
  baseCategory: "judoka",
  categories: [
    { id: "judoka", label: "Judoka", values: ["Aki", "Ben", "Cora", "Dan"] },
    { id: "club", label: "Club", values: ["Falcons", "Lions", "Tigers", "Wolves"] },
    { id: "tatami", label: "Tatami", values: ["1", "2", "3", "4"] },
    { id: "placing", label: "Placing", values: ["1st", "2nd", "3rd", "4th"], ordered: true },
  ],
};

const qualityFixtureSpec: PuzzleTemplate = {
  id: "quality-fixture",
  title: "Quality evaluator fixture",
  baseCategory: "person",
  categories: [
    { id: "person", label: "Person", values: ["Aki", "Ben"] },
    { id: "color", label: "Color", values: ["Red", "Blue"] },
    { id: "placing", label: "Placing", values: ["1st", "2nd"], ordered: true },
  ],
};

const solverFixtureSpec: PuzzleTemplate = {
  id: "solver-fixture",
  title: "Solver fixture",
  baseCategory: "person",
  categories: [
    { id: "person", label: "Person", values: ["Aki", "Ben", "Cora"] },
    { id: "color", label: "Color", values: ["Red", "Blue", "Green"] },
    { id: "pet", label: "Pet", values: ["Cat", "Dog", "Fox"] },
  ],
};

const clueKindsAndReadabilityFixture: Clue[] = [
  { id: "direct-red", constraint: { kind: "matches", subject: "Aki", category: "color", value: "Red" }, text: "Aki wore red." },
  { id: "blank-negative", constraint: { kind: "notMatches", subject: "Ben", category: "color", value: "Red" }, text: "   " },
  { id: "undefined-order", constraint: { kind: "before", left: { category: "person", value: "Aki" }, right: { category: "person", value: "Ben" } }, text: "undefined finished first." },
  { id: "null-adjacency", constraint: { kind: "adjacent", left: { category: "color", value: "Red" }, right: { category: "color", value: "Blue" } }, text: "Red was beside null." },
];

const noGuessSolveFixture: Clue[] = [
  { id: "aki-red", constraint: { kind: "matches", subject: "Aki", category: "color", value: "Red" }, text: "Aki wore red." },
  { id: "aki-not-second", constraint: { kind: "notMatches", subject: "Aki", category: "placing", value: "2nd" }, text: "Aki did not finish second." },
];

test("Championship Circuit publishes its documented five-row expert board", () => {
  assert.equal(championshipCircuitTemplate.id, "championship-circuit-v2");
  assert.ok(championshipCircuitTemplate.categories.every(category => category.values.length === 5));
  assert.equal(
    championshipCircuitTemplate.categories.filter(category => category.id !== championshipCircuitTemplate.baseCategory).length,
    3,
  );
  assert.equal(championshipCircuitTemplate.categories.find(category => category.id === "medal")?.label, "Result");
});

test("templates provide a deliberate five-row bridge before the expert course", () => {
  assert.deepEqual(tournamentOrderV2Template.metadata!.difficultyCalibration.levelRange, [1, 4]);
  assert.deepEqual(openDivisionTemplate.metadata!.difficultyCalibration.levelRange, [5, 8]);
  assert.deepEqual(championshipBridgeTemplate.metadata!.difficultyCalibration.levelRange, [8, 9]);
  assert.equal(championshipBridgeTemplate.categories.length, 4);
  assert.ok(championshipBridgeTemplate.categories.every(category => category.values.length === 5));
  assert.deepEqual(championshipCircuitTemplate.metadata!.difficultyCalibration.levelRange, [9, 12]);
  for (const template of [tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate]) {
    assert.equal(template.metadata!.difficultyCalibration.requiresHumanSolve, true);
  }
});

test("targeted beginner puzzles complete under the bounded no-guess deduction model", () => {
  for (let level = 1; level <= 4; level += 1) {
    const puzzle = generatePuzzleAtDifficulty(tournamentOrderV2Template, "curriculum-ready", level as 1 | 2 | 3 | 4);
    assert.equal(puzzle.difficulty.level, level);
    assert.equal(puzzle.difficulty.evidence.humanSolve.solved, true);
  }
});

test("the versioned beginner course also protects untargeted generation from guess-only traces", () => {
  const puzzle = generateProgressivePuzzle(tournamentOrderV2Template, "curriculum-ready");
  assert.equal(puzzle.difficulty.evidence.humanSolve.solved, true);
});

test("adaptive target generation retains the caller seed while selecting a replayable fallback", () => {
  const puzzle = generatePuzzleAtDifficultyWithFallback(openDivisionTemplate, "course-anchor", 5);
  assert.equal(puzzle.requestedSeed, "course-anchor");
  assert.equal(puzzle.difficulty.level, 5);
  assert.ok(puzzle.seedFallbackAttempt === undefined || puzzle.seedFallbackAttempt > 0);
  if (puzzle.seedFallbackAttempt) assert.notEqual(puzzle.seed, puzzle.requestedSeed);
});

test("IJF-template puzzle payloads never use the invalid +81 kg division", () => {
  for (const template of [openDivisionTemplate, championshipCircuitTemplate]) {
    const puzzle = generatePuzzle(template, "ijf-weight-regression");
    const serialized = JSON.stringify({ spec: puzzle.spec, clues: puzzle.clues });
    assert.doesNotMatch(serialized, /\+81 kg/);
    assert.match(serialized, /-90 kg/);
  }
});

test("generation rejects a non-IJF value in a weight category", () => {
  const invalidTemplate: PuzzleTemplate = {
    ...openDivisionTemplate,
    categories: openDivisionTemplate.categories.map(category => category.id === "weight"
      ? { ...category, values: ["-60 kg", "-66 kg", "-73 kg", "-81 kg", "+81 kg"] }
      : category),
  };

  assert.equal(isIjfSeniorMensWeightClass("-90 kg"), true);
  assert.equal(isIjfSeniorMensWeightClass("+81 kg"), false);
  assert.throws(() => generatePuzzle(invalidTemplate, "invalid-weight"), /valid IJF senior men's weight classes/);
});

test("a seeded Open Division puzzle is reproducible and has exactly one solution", () => {
  const first = generatePuzzle(openDivisionTemplate, "catalogue-seed");
  const second = generatePuzzle(openDivisionTemplate, "catalogue-seed");

  assert.deepEqual(first, second);
  assert.equal(countSolutions(first.spec, first.clues, 2), 1);
});

test("representative clue prose satisfies grammar invariants for every generated constraint/category combination", () => {
  const categories = [
    { id: "weight", values: ["-60 kg", "-66 kg"] },
    { id: "tatami", values: ["Tatami 1", "Tatami 2"] },
    { id: "placing", values: ["1st", "2nd"] },
  ] as const;
  const clues: Clue[] = [];

  for (const [categoryIndex, category] of categories.entries()) {
    clues.push(
      { id: `matches-${category.id}`, constraint: { kind: "matches", subject: "Aki", category: category.id, value: category.values[0] }, text: "" },
      { id: `not-matches-${category.id}`, constraint: { kind: "notMatches", subject: "Hana", category: category.id, value: category.values[1] }, text: "" },
      { id: `before-${category.id}`, constraint: { kind: "before", left: { category: category.id, value: category.values[0] }, right: { category: category.id, value: category.values[1] } }, text: "" },
      { id: `adjacent-${category.id}`, constraint: { kind: "adjacent", left: { category: category.id, value: category.values[0] }, right: { category: category.id, value: category.values[1] } }, text: "" },
    );
    for (const rightCategory of categories.slice(categoryIndex + 1)) {
      clues.push(
        { id: `same-row-${category.id}-${rightCategory.id}`, constraint: { kind: "sameRow", left: { category: category.id, value: category.values[0] }, right: { category: rightCategory.id, value: rightCategory.values[0] } }, text: "" },
        { id: `distance-${category.id}-${rightCategory.id}`, constraint: { kind: "distance", left: { category: category.id, value: category.values[1] }, right: { category: rightCategory.id, value: rightCategory.values[1] }, distance: 2 }, text: "" },
      );
    }
  }

  const rendered = renderClues(tournamentOrderTemplate, "grammar-contract", clues);
  for (const clue of rendered) {
    assert.ok(clue.text.trim().length > 0, `${clue.id} must render nonblank prose`);
    assert.doesNotMatch(clue.text, /\b(?:undefined|null)\b/i, `${clue.id} must not expose a placeholder token`);
    const referencedValues = "subject" in clue.constraint
      ? [clue.constraint.subject, clue.constraint.value]
      : [clue.constraint.left.value, clue.constraint.right.value];
    for (const value of referencedValues) {
      assert.ok(clue.text.includes(value), `${clue.id} must interpolate ${JSON.stringify(value)}`);
    }
    if (clue.constraint.kind === "matches" || clue.constraint.kind === "notMatches") {
      assert.ok(clue.text.startsWith(`${clue.constraint.subject} `), `${clue.id} must use the competitor as its grammatical subject`);
    }
  }
});

test("rendered clue metadata satisfies the language catalogue contract", () => {
  const clues: Clue[] = [
    { id: "metadata-match", constraint: { kind: "matches", subject: "Aki", category: "weight", value: "-60 kg" }, text: "" },
    { id: "metadata-adjacent", constraint: { kind: "adjacent", left: { category: "tatami", value: "Tatami 1" }, right: { category: "tatami", value: "Tatami 2" } }, text: "" },
  ];

  const rendered = renderClues(tournamentOrderTemplate, "metadata-contract", clues);
  assert.ok(rendered.every(clue => clue.languageVersion === "yokaiba-clue-prose-v7"));
  assert.ok(rendered.every(clue => typeof clue.phraseVariant === "string" && clue.phraseVariant.length > 0));
});

test("championship results use natural finish language rather than treating every result as a medal", () => {
  const clues: Clue[] = [
    { id: "aki-result", constraint: { kind: "matches", subject: "Aki", category: "medal", value: "Quarter-finalist" }, text: "" },
    { id: "result-distance", constraint: { kind: "distance", left: { category: "tatami", value: "Tatami 1" }, right: { category: "medal", value: "Quarter-finalist" }, distance: 2 }, text: "" },
  ];

  const rendered = renderClues(championshipCircuitTemplate, "result-language", clues).map(clue => clue.text);

  assert.ok(rendered.includes("Aki finished as a quarter-finalist."));
  assert.equal(rendered.some(clue => clue.includes("Quarter-finalist medallist") || clue.includes("earned Quarter-finalist")), false);
});

test("direct clues keep the competitor as the grammatical subject", () => {
  const clues: Clue[] = [
    { id: "aki-weight", constraint: { kind: "matches", subject: "Aki", category: "weight", value: "-66 kg" }, text: "" },
    { id: "hana-tatami", constraint: { kind: "matches", subject: "Hana", category: "tatami", value: "Tatami 2" }, text: "" },
    { id: "kenji-placing", constraint: { kind: "matches", subject: "Kenji", category: "placing", value: "1st" }, text: "" },
  ];

  const rendered = renderClues(tournamentOrderTemplate, "subject-first", clues).map(clue => clue.text);

  assert.deepEqual(rendered, [
    "Aki fought in the -66 kg division.",
    "Hana competed on Tatami 2.",
    "Kenji finished in 1st place.",
  ]);
  assert.ok(rendered.every(clue => !/\bfor\s+(Aki|Hana|Kenji)\./.test(clue)));
});

test("negative clues remain direct and grammatical across every phrase variant", () => {
  const clues: Clue[] = [
    { id: "not-tatami", constraint: { kind: "notMatches", subject: "Sora", category: "tatami", value: "Tatami 3" }, text: "" },
    { id: "not-placing", constraint: { kind: "notMatches", subject: "Aki", category: "placing", value: "2nd" }, text: "" },
    { id: "not-weight", constraint: { kind: "notMatches", subject: "Kenji", category: "weight", value: "-81 kg" }, text: "" },
  ];

  for (const seed of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
    const rendered = renderClues(tournamentOrderTemplate, seed, clues).map(clue => clue.text);
    assert.ok(rendered.every(clue => !/was not the competitor to/i.test(clue)));
    assert.ok(rendered.every(clue => /^(Sora|Aki|Kenji) did not /.test(clue)));
  }
});

test("relational clues name the competitors without mid-sentence capitalization", () => {
  const clues: Clue[] = [
    { id: "placing-order", constraint: { kind: "before", left: { category: "placing", value: "2nd" }, right: { category: "placing", value: "4th" } }, text: "" },
    { id: "tatami-distance", constraint: { kind: "distance", left: { category: "tatami", value: "Tatami 4" }, right: { category: "placing", value: "3rd" }, distance: 1 }, text: "" },
  ];

  const coveredVariants = new Set<string>();
  for (const seed of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
    const rendered = renderClues(tournamentOrderTemplate, seed, clues);
    const beforeClue = rendered.find(clue => clue.id === "placing-order")!;

    coveredVariants.add(beforeClue.phraseVariant!);
    assert.match(beforeClue.text, /competitor who finished 2nd.*competitor who finished 4th/i);
    assert.match(beforeClue.text, /(came before|was earlier than)/i);
    assert.doesNotMatch(beforeClue.text, /In the .*?, The competitor/);
    assert.ok(rendered.some(clue => /competitor on Tatami 4.*competitor who finished 3rd.*exactly one place apart/i.test(clue.text)));
  }

  assert.deepEqual(coveredVariants, new Set(["before-0", "before-1"]));
});

test("ordered clue prose avoids a duplicated order word and states exact place distances", () => {
  const clues: Clue[] = [
    { id: "tatami-before", constraint: { kind: "before", left: { category: "tatami", value: "Tatami 2" }, right: { category: "tatami", value: "Tatami 1" } }, text: "" },
    { id: "weight-distance", constraint: { kind: "distance", left: { category: "weight", value: "-73 kg" }, right: { category: "tatami", value: "Tatami 1" }, distance: 3 }, text: "" },
  ];

  for (const seed of ["alpha", "beta", "gamma", "delta"]) {
    const rendered = renderClues(tournamentOrderTemplate, seed, clues);
    assert.ok(rendered.every(clue => !/order order/i.test(clue.text)));
    const distance = rendered.find(clue => clue.id === "weight-distance")!;
    assert.match(distance.text, /-73 kg competitor.*competitor on Tatami 1.*exactly three places apart/i);
    assert.doesNotMatch(distance.text, /positions of .* differed by exactly/i);
  }
});

test("clue rendering is deterministic and rotates phrase variants within a puzzle", () => {
  const clues: Clue[] = [
    { id: "weight-placing-one", constraint: { kind: "sameRow", left: { category: "weight", value: "-81 kg" }, right: { category: "placing", value: "2nd" } }, text: "" },
    { id: "weight-placing-two", constraint: { kind: "sameRow", left: { category: "weight", value: "-73 kg" }, right: { category: "placing", value: "3rd" } }, text: "" },
  ];

  const first = renderClues(tournamentOrderTemplate, "prose-seed", clues);
  const second = renderClues(tournamentOrderTemplate, "prose-seed", clues);

  assert.deepEqual(first, second);
  assert.match(first[0]!.text, /-81 kg/);
  assert.match(first[0]!.text, /2nd/);
  assert.match(first[1]!.text, /-73 kg/);
  assert.match(first[1]!.text, /3rd/);
  assert.notEqual(first[0]!.phraseVariant, first[1]!.phraseVariant);
});

test("targeted difficulty never substitutes a different seed", () => {
  const twoRowTemplate: PuzzleTemplate = {
    id: "two-row", title: "Two row", baseCategory: "person",
    categories: [
      { id: "person", label: "Person", values: ["Aki", "Ben"] },
      { id: "color", label: "Color", values: ["Red", "Blue"] },
    ],
  };

  assert.throws(() => generatePuzzleAtDifficulty(twoRowTemplate, "strict-seed", 5), DifficultyUnavailableError);
});

test("seed fallback reuses a valid target puzzle without an expensive strategy search", () => {
  const requestedSeed = "codex-audit-20260930-b4c2";
  let solverCalls = 0;
  const solver: PuzzleSolver = {
    version: exhaustivePuzzleSolver.version,
    solve: (...args) => exhaustivePuzzleSolver.solve(...args),
    countSolutions: (...args) => {
      solverCalls += 1;
      return exhaustivePuzzleSolver.countSolutions(...args);
    },
  };

  const puzzle = generatePuzzleAtDifficultyWithFallback(openDivisionTemplate, requestedSeed, 5, solver);

  assert.equal(puzzle.seed, requestedSeed);
  assert.equal(puzzle.difficulty.level, 5);
  assert.equal(puzzle.difficulty.evidence.humanSolve.solved, true);
  assert.ok(solverCalls < 500, `expected a bounded puzzle search, saw ${solverCalls} solver calls`);
});

test("seed fallback skips off-target guess-only candidates without retargeting each one", () => {
  const requestedSeed = "codex-audit-20260930-a7f3-open";
  let solverCalls = 0;
  const solver: PuzzleSolver = {
    version: exhaustivePuzzleSolver.version,
    solve: (...args) => exhaustivePuzzleSolver.solve(...args),
    countSolutions: (...args) => {
      solverCalls += 1;
      return exhaustivePuzzleSolver.countSolutions(...args);
    },
  };

  const puzzle = generatePuzzleAtDifficultyWithFallback(openDivisionTemplate, requestedSeed, 5, solver);

  assert.equal(puzzle.difficulty.level, 5);
  assert.equal(puzzle.difficulty.evidence.humanSolve.solved, true);
  assert.equal(puzzle.seedFallbackAttempt, 1);
  assert.ok(solverCalls < 500, `expected fallback to skip off-target candidates cheaply, saw ${solverCalls} solver calls`);
});

test("the beginner curriculum can generate every calibrated difficulty from one seed", () => {
  for (const level of [1, 2, 3, 4] as const) {
    const puzzle = generatePuzzleAtDifficulty(tournamentOrderTemplate, "curriculum-ready", level);
    assert.equal(puzzle.seed, "curriculum-ready");
    assert.equal(puzzle.difficulty.level, level);
  }
});

test("difficulty corpus audit aggregates human-trace and clue statistics", () => {
  const statistics = aggregateDifficultyAuditRecords([
    { level: 2, humanTraceComplete: true, clueCount: 5 },
    { level: 2, humanTraceComplete: false, clueCount: 8 },
    { level: 12, humanTraceComplete: true, clueCount: 11 },
  ]);

  assert.deepEqual(statistics, {
    levelCounts: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    humanTrace: { complete: 2, incomplete: 1 },
    clues: { average: 8, minimum: 5, maximum: 11 },
  });
});

test("difficulty audit reports sample progress through a callback", () => {
  const progress: Array<{ phase: string; completed: number; total: number }> = [];
  auditDifficultyCorpus(tournamentOrderV2Template, {
    sampleSize: 2,
    onProgress: event => progress.push({ phase: event.phase, completed: event.completed, total: event.total }),
  });
  assert.deepEqual(progress, [
    { phase: "difficulty", completed: 1, total: 2 },
    { phase: "difficulty", completed: 2, total: 2 },
  ]);

  const targetedProgress: Array<{ phase: string; level?: number; completed: number; total: number }> = [];
  auditTargetedDifficultyCorpus(tournamentOrderV2Template, {
    sampleSize: 1,
    onProgress: event => targetedProgress.push({ phase: event.phase, level: event.requestedDifficultyLevel, completed: event.completed, total: event.total }),
  });
  assert.equal(targetedProgress.length, 4);
  assert.ok(targetedProgress.every(event => event.phase === "targeted" && event.completed === 1 && event.total === 1));
  assert.deepEqual(targetedProgress.map(event => event.level), [1, 2, 3, 4]);
});

test("difficulty corpus audit rejects levels outside the 1–12 scale", () => {
  const record = (level: number): DifficultyAuditRecord => ({
    level: level as DifficultyAuditRecord["level"],
    humanTraceComplete: true,
    clueCount: 5,
  });

  for (const level of [0, 13, 1.5, Number.NaN]) {
    assert.throws(
      () => aggregateDifficultyAuditRecords([record(level)]),
      { name: "RangeError", message: `difficulty level must be an integer between 1 and 12, received ${level}` },
    );
  }
});

test("difficulty corpus audit emits a report for a real template", () => {
  const report = auditDifficultyCorpus(tournamentOrderTemplate, { seedPrefix: "audit-integration", sampleSize: 1 });

  assert.equal(report.templateId, tournamentOrderTemplate.id);
  assert.equal(report.sampleSize, 1);
  assert.equal(report.levelCounts.reduce((total, count) => total + count, 0), 1);
});

test("targeted corpus audits prove every requested course level rather than sampling untargeted puzzles", () => {
  const report = auditTargetedDifficultyCorpus(tournamentOrderV2Template, { seedPrefix: "targeted-audit", sampleSize: 1 });

  assert.deepEqual(report.levels.map(level => level.requestedDifficultyLevel), [1, 2, 3, 4]);
  assert.ok(report.levels.every(level => level.generated === 1 && level.humanTrace.incomplete === 0));
  assert.ok(report.levels.every(level => level.assessedLevelCounts[level.requestedDifficultyLevel - 1] === 1));
});

test("fallback bounds dense strategy search to protect production CPU while compact boards retain full search", () => {
  assert.equal(difficultyStrategyLimitForFallback(tournamentOrderV2Template), 64);
  assert.equal(difficultyStrategyLimitForFallback(openDivisionTemplate), 8);
  assert.equal(difficultyStrategyLimitForFallback(championshipCircuitTemplate), 8);
});

test("expert target generation favors relational deductions over direct facts", () => {
  const puzzle = generatePuzzle(championshipCircuitTemplate, "expert-relational", undefined, { difficultyLevel: 12, strategy: 0 });

  assert.equal(countSolutions(puzzle.spec, puzzle.clues, 2), 1);
  assert.ok(puzzle.clues.every(clue => clue.constraint.kind !== "matches"));
  assert.ok(puzzle.clues.some(clue => clue.constraint.kind === "sameRow" || clue.constraint.kind === "distance"));
});

test("the exhaustive solver fulfils the public solver contract", () => {
  const spec: PuzzleTemplate = {
    id: "exhaustive-solver-contract",
    title: "Exhaustive solver contract fixture",
    baseCategory: "person",
    categories: [
      { id: "person", label: "Person", values: ["Aki", "Ben"] },
      { id: "color", label: "Color", values: ["Red", "Blue"] },
      { id: "pet", label: "Pet", values: ["Cat", "Dog"] },
    ],
  };
  const clues = [{ id: "aki-red", constraint: { kind: "matches" as const, subject: "Aki", category: "color", value: "Red" }, text: "Aki wore red." }];
  const expectedAssignments = [
    { assignments: { color: ["Red", "Blue"], pet: ["Cat", "Dog"] } },
    { assignments: { color: ["Red", "Blue"], pet: ["Dog", "Cat"] } },
  ];

  assert.deepEqual(exhaustivePuzzleSolver.solve(spec, clues, 10), expectedAssignments);
  assert.deepEqual(exhaustivePuzzleSolver.solve(spec, clues, 1), expectedAssignments.slice(0, 1));
  assert.equal(exhaustivePuzzleSolver.countSolutions(spec, clues, 10), 2);

  // Replay contract: README.md, "Solver implementations".
  assert.equal(exhaustivePuzzleSolver.version, "yokaiba-exhaustive-v1");
});

test("solver preserves the semantics of every clue kind", () => {
  const count = (constraint: Clue["constraint"]) => countSolutions(solverFixtureSpec, [{ id: constraint.kind, constraint, text: constraint.kind }], 100);

  assert.equal(count({ kind: "matches", subject: "Aki", category: "color", value: "Red" }), 12);
  assert.equal(count({ kind: "notMatches", subject: "Aki", category: "color", value: "Red" }), 24);
  assert.equal(count({ kind: "before", left: { category: "color", value: "Red" }, right: { category: "color", value: "Blue" } }), 18);
  assert.equal(count({ kind: "adjacent", left: { category: "color", value: "Red" }, right: { category: "color", value: "Blue" } }), 24);
});

test("solver evaluates relational clues across categories", () => {
  const before: Clue = {
    id: "red-before-cat",
    constraint: { kind: "before", left: { category: "color", value: "Red" }, right: { category: "pet", value: "Cat" } },
    text: "Red comes before Cat.",
  };
  const adjacent: Clue = {
    id: "blue-next-to-dog",
    constraint: { kind: "adjacent", left: { category: "color", value: "Blue" }, right: { category: "pet", value: "Dog" } },
    text: "Blue is next to Dog.",
  };

  assert.equal(countSolutions(solverFixtureSpec, [before], 100), 12);
  assert.equal(countSolutions(solverFixtureSpec, [adjacent], 100), 16);
});

test("solver supports same-row and exact-distance clues", () => {
  const sameRow: Clue = {
    id: "red-cat", constraint: { kind: "sameRow", left: { category: "color", value: "Red" }, right: { category: "pet", value: "Cat" } }, text: "Red belongs with Cat.",
  };
  const distance: Clue = {
    id: "blue-two-from-fox", constraint: { kind: "distance", left: { category: "color", value: "Blue" }, right: { category: "pet", value: "Fox" }, distance: 2 }, text: "Blue is two places from Fox.",
  };

  assert.equal(countSolutions(solverFixtureSpec, [sameRow], 100), 12);
  assert.equal(countSolutions(solverFixtureSpec, [distance], 100), 8);
  const solution = solve(solverFixtureSpec, [sameRow, distance], 1)[0]!;
  assert.ok(satisfiesConstraint(solverFixtureSpec, solution, sameRow.constraint));
  assert.ok(satisfiesConstraint(solverFixtureSpec, solution, distance.constraint));
});

test("solver returns no solution for contradictory clues", () => {
  const contradictory: Clue[] = [
    { id: "aki-red", constraint: { kind: "matches", subject: "Aki", category: "color", value: "Red" }, text: "Aki is Red." },
    { id: "aki-not-red", constraint: { kind: "notMatches", subject: "Aki", category: "color", value: "Red" }, text: "Aki is not Red." },
  ];

  assert.equal(countSolutions(solverFixtureSpec, contradictory, 2), 0);
  assert.deepEqual(solve(solverFixtureSpec, contradictory), []);
});

test("solver honours limits while retaining deterministic exhaustive results", () => {
  const first = solve(solverFixtureSpec, [], 2);
  const second = solve(solverFixtureSpec, [], 2);

  assert.equal(countSolutions(solverFixtureSpec, [], 100), 36);
  assert.equal(countSolutions(solverFixtureSpec, [], 2), 2);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.deepEqual(solve(solverFixtureSpec, [], 0), []);
});

test("solver telemetry reports searched nodes, evaluated constraints, and elapsed time", () => {
  const clue: Clue = {
    id: "aki-cat",
    constraint: { kind: "matches", subject: "Aki", category: "pet", value: "Cat" },
    text: "Aki has Cat.",
  };
  let currentTime = 1_000;
  const advancingClock = () => {
    const reading = currentTime;
    currentTime += 25;
    return reading;
  };
  const constrained = solveWithTelemetry(solverFixtureSpec, [clue], 2, advancingClock);
  const unconstrained = solveWithTelemetry(solverFixtureSpec, [], 2, advancingClock);

  assert.equal(constrained.solutions.length, 2);
  for (const result of [constrained, unconstrained]) {
    assert.ok(Number.isInteger(result.telemetry.nodesVisited));
    assert.ok(result.telemetry.nodesVisited >= 0);
    assert.ok(Number.isInteger(result.telemetry.constraintChecks));
    assert.ok(result.telemetry.constraintChecks >= 0);
    assert.ok(result.telemetry.nodesVisited > 0, "a nontrivial solve must report search work");
    assert.equal(result.telemetry.elapsedMs, 25);
  }
  assert.ok(constrained.telemetry.constraintChecks > 0, "a constrained solve must evaluate constraints");
  assert.equal(unconstrained.telemetry.constraintChecks, 0, "a solve without clues has no constraints to evaluate");
  assert.ok(constrained.solutions.every(solution => satisfiesConstraint(solverFixtureSpec, solution, clue.constraint)));
});

test("generation uses the injected solver and records its version", () => {
  const solver: PuzzleSolver = {
    version: "contract-test-v1",
    solve: () => [],
    countSolutions: (_spec, clues) => clues.some(clue => clue.constraint.kind === "distance") ? 1 : 2,
  };
  const puzzle = generatePuzzle(template, "injected-solver", solver);

  assert.equal(puzzle.solverVersion, "contract-test-v1");
  assert.equal(puzzle.clues.length, 1);
  assert.equal(puzzle.clues[0]?.constraint.kind, "distance");
});

test("quality evaluation reflects injected solver results", () => {
  const solver: PuzzleSolver = {
    version: "quality-contract-test-v1",
    solve: () => [],
    countSolutions: (_spec, clues) => clues.some(clue => clue.id === "aki-red") ? 1 : 2,
  };
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, noGuessSolveFixture, solver);

  assert.equal(quality.unique, true);
  assert.deepEqual(quality.redundantClueIds, ["aki-not-second"]);
});

test("the generated clue set is minimal for uniqueness", () => {
  const puzzle = generatePuzzle(template, "minimal-seed");
  const quality = evaluatePuzzleQuality(puzzle.spec, puzzle.clues);

  assert.equal(quality.unique, true);
  assert.deepEqual(quality.redundantClueIds, []);
  for (const clue of puzzle.clues) {
    assert.notEqual(countSolutions(puzzle.spec, puzzle.clues.filter(candidate => candidate.id !== clue.id), 2), 1);
  }
});

test("quality reports the exact clue kinds in a controlled fixture", () => {
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, clueKindsAndReadabilityFixture);

  assert.equal(quality.clueDiversity.distinctKinds, 4);
  assert.deepEqual(
    new Set(quality.clueDiversity.kinds),
    new Set(["adjacent", "before", "matches", "notMatches"]),
  );
});

test("clue readability rejects blank text", () => {
  assert.equal(isClueTextReadable("   "), false);
});

test("clue readability rejects an unresolved undefined value", () => {
  assert.equal(isClueTextReadable("undefined finished first."), false);
});

test("clue readability rejects an unresolved null value", () => {
  assert.equal(isClueTextReadable("Red was beside null."), false);
});

test("clue readability accepts valid clue prose", () => {
  assert.equal(isClueTextReadable("Aki wore red."), true);
});

test("quality reports the exact unreadable clue IDs in a controlled fixture", () => {
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, clueKindsAndReadabilityFixture);
  const unreadableClueIds = new Set(quality.readability.unreadableClueIds);

  assert.equal(unreadableClueIds.size, 3);
  assert.ok(unreadableClueIds.has("blank-negative"));
  assert.ok(unreadableClueIds.has("undefined-order"));
  assert.ok(unreadableClueIds.has("null-adjacency"));
  assert.equal(unreadableClueIds.has("direct-red"), false);
});

test("quality records a completed human trace without guessing", () => {
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, noGuessSolveFixture);

  assert.equal(quality.humanSolve.solved, true);
  assert.equal(quality.humanSolve.usedGuessing, false);
});

test("quality reports an incomplete human trace when clues cannot finish the puzzle", () => {
  const incompleteFixture = noGuessSolveFixture.slice(0, 1);
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, incompleteFixture);

  assert.equal(quality.humanSolve.solved, false);
  assert.equal(quality.humanSolve.usedGuessing, false);
  for (const diagnostic of [
    quality.humanSolve.deductionPasses,
    quality.humanSolve.totalCost,
    quality.humanSolve.hardestStep,
  ]) {
    assert.ok(Number.isFinite(diagnostic));
    assert.ok(diagnostic >= 0);
  }
});

test("difficulty is reproducible and publishes deterministic human and solver evidence", () => {
  const fixtures = ["recalibrate-7", "recalibrate-18", "recalibrate-3", "recalibrate-1", "recalibrate-0"];
  for (const seed of fixtures) {
    const difficulty = generatePuzzle(tournamentOrderTemplate, seed).difficulty;
    assert.equal(difficulty.modelVersion, "yokaiba-difficulty-v4");
    assert.ok(difficulty.evidence.score > 0);
    assert.ok(difficulty.evidence.solver.nodesVisited > 0);
    assert.ok(difficulty.evidence.solver.constraintChecks > 0);
    assert.equal(typeof difficulty.evidence.humanSolve.solved, "boolean");
  }

  const reproducibleSeed = fixtures[2]!;
  const first = generatePuzzle(tournamentOrderTemplate, reproducibleSeed);
  const second = generatePuzzle(tournamentOrderTemplate, reproducibleSeed);
  assert.deepEqual(first.difficulty, second.difficulty);
});
