import type { AuditArguments } from "./audit-jev-support.js";

const BOOLEAN_FLAGS = new Set(["--resume", "--puzzle-review"]);
const KNOWN_FLAGS = new Set(["--samples", "--difficulty-samples", "--clue-samples", "--batch-size", "--out", ...BOOLEAN_FLAGS, "--puzzle-review-from"]);

function positiveIntegerArgument(args: readonly string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const raw = args[index + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function optionalStringArgument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function validateArgument(args: readonly string[], index: number): number {
  const arg = args[index]!;
  if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
  if (!KNOWN_FLAGS.has(arg)) throw new Error(`unknown argument: ${arg}`);
  if (BOOLEAN_FLAGS.has(arg)) return index;
  if (args[index + 1] === undefined || args[index + 1]!.startsWith("--")) throw new Error(`${arg} requires a value`);
  return index + 1;
}

function validateArguments(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) index = validateArgument(args, index);
}

export function parseAuditArguments(args: readonly string[]): AuditArguments {
  validateArguments(args);

  const sharedSamples = positiveIntegerArgument(args, "--samples", 100);
  const outputBase = optionalStringArgument(args, "--out");
  const puzzleReviewFrom = optionalStringArgument(args, "--puzzle-review-from");
  const resume = args.includes("--resume");
  if (resume && !outputBase) throw new Error("--resume requires --out so the checkpoint path stays stable");
  if (resume && puzzleReviewFrom) throw new Error("--resume and --puzzle-review-from cannot be combined");
  return {
    difficultySamples: positiveIntegerArgument(args, "--difficulty-samples", sharedSamples),
    clueSamples: positiveIntegerArgument(args, "--clue-samples", sharedSamples),
    batchSize: positiveIntegerArgument(args, "--batch-size", 20),
    outputBase,
    puzzleReviewFrom,
    resume,
    puzzleReview: args.includes("--puzzle-review") || puzzleReviewFrom !== undefined,
  };
}
