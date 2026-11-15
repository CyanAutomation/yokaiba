import type { Clue, DifficultyLevel } from "../domain/types.js";

type ClueKind = Clue["constraint"]["kind"];

const FAMILY_PREFERENCES: readonly (readonly number[])[] = [
  [0, 1, 5, 4, 3, 6], // Level 1: direct facts and exclusions form easy starts.
  [1, 0, 4, 3, 2, 5], // Level 2: slightly more use of a small number of relations.
  [1, 0, 3, 2, 4, 5],
  [1, 0, 4, 3, 2, 5],
  [1, 0, 2, 3, 4, 5],
  [5, 4, 2, 3, 0, 1],
  [3, 2, 1, 3, 0, 4],
  [4, 3, 2, 3, 0, 1],
  [5, 4, 2, 3, 1, 0], // Level 9: exact-distance and same-row relations lead.
  [4, 5, 2, 3, 1, 0], // Level 10: distance and same-row relations lead.
  [5, 4, 1, 3, 2, 0], // Level 11: exact-distance clues lead, then ordering.
  [5, 4, 3, 2, 1, 0], // Level 12: exact-distance and cross-category row links lead.
];

const ALTERNATIVE_ORDERS_FOR_LEVELS_6_TO_8: readonly (readonly number[])[] = [
  [5, 4, 1, 2, 3, 0], // Cross-category relations lead, exclusions before ordering.
  [4, 5, 2, 1, 3, 0], // Same-row and distance relations lead in reverse order.
];

const ALTERNATIVE_ORDERS_FOR_LEVELS_9_TO_12: readonly (readonly number[])[] = [
  [5, 2, 4, 1, 3, 0], // Distance, ordering, and same-row links lead.
  [4, 5, 2, 1, 3, 0], // Same-row, distance, then ordering and exclusions.
];

function familyFor(kind: ClueKind): number {
  switch (kind) {
    case "matches": return 0;
    case "notMatches": return 1;
    case "before": return 2;
    case "adjacent": return 3;
    case "sameRow": return 4;
    case "distance": return 5;
  }
}

function crossCategoryExpertWeight(clue: Clue, level: DifficultyLevel, strategy: number): number | undefined {
  const constraint = clue.constraint;
  if (level < 11 || (constraint.kind !== "before" && constraint.kind !== "adjacent")) return undefined;
  return constraint.left.category !== constraint.right.category ? -6 + (strategy % 6) : undefined;
}

function beginnerLevelThreeWeight(kind: ClueKind): number {
  if (kind === "before" || kind === "distance") return 6;
  if (kind === "sameRow") return 8;
  return kind === "adjacent" ? 12 : 18;
}

function beginnerLevelFourWeight(kind: ClueKind): number {
  if (kind === "sameRow" || kind === "adjacent") return 6;
  return kind === "before" ? 12 : 18;
}

function beginnerLevelFiveWeight(kind: ClueKind): number {
  if (kind === "sameRow") return 6;
  if (kind === "distance") return 9;
  if (kind === "before") return 12;
  return kind === "adjacent" ? 18 : 24;
}

function anchorRowFromClueId(clueId: string): number | undefined {
  let rowStart = clueId.length;
  while (rowStart > 0) {
    const digit = clueId.charCodeAt(rowStart - 1);
    if (digit < 48 || digit > 57) break;
    rowStart -= 1;
  }
  const rowSeparator = rowStart - 1;
  if (rowStart === clueId.length || rowSeparator < 0 || clueId[rowSeparator] !== "-") return undefined;

  const marker = "matches-";
  for (let markerStart = 0; markerStart + marker.length < rowSeparator; markerStart += 1) {
    if (!clueId.startsWith(marker, markerStart)) continue;
    if (markerStart > 0 && clueId[markerStart - 1] !== "-") continue;
    return Number(clueId.slice(rowStart));
  }
  return undefined;
}

function beginnerAnchorWeight(clue: Clue, level: DifficultyLevel, strategy: number, rowCount: number): number | undefined {
  if (level < 3 || level > 5) return undefined;
  const kind = clue.constraint.kind;
  if (kind === "matches") {
    const row = anchorRowFromClueId(clue.id);
    return row !== undefined && row === strategy % rowCount ? 0 : 36;
  }
  if (kind === "notMatches") return 30;
  if (level === 3) return beginnerLevelThreeWeight(kind);
  if (level === 4) return beginnerLevelFourWeight(kind);
  return beginnerLevelFiveWeight(kind);
}

function familyRank(level: DifficultyLevel, strategy: number, family: number): number {
  let rank = FAMILY_PREFERENCES[level - 1]![family]!;
  if (level < 6) return rank;

  const profile = Math.floor(strategy / 4) % 3;
  if (profile === 0) return rank;
  const alternatives = level <= 8
    ? ALTERNATIVE_ORDERS_FOR_LEVELS_6_TO_8
    : ALTERNATIVE_ORDERS_FOR_LEVELS_9_TO_12;
  rank = alternatives[profile - 1]!.indexOf(family);
  return rank;
}

/** Stable calibrated preference for a clue kind at one v5 difficulty strategy. */
export function v5ClueWeight(clue: Clue, level: DifficultyLevel, strategy: number, rowCount: number): number {
  const expertWeight = crossCategoryExpertWeight(clue, level, strategy);
  if (expertWeight !== undefined) return expertWeight;

  const beginnerWeight = beginnerAnchorWeight(clue, level, strategy, rowCount);
  if (beginnerWeight !== undefined) return beginnerWeight;

  const family = familyFor(clue.constraint.kind);
  const rank = familyRank(level, strategy, family);
  // Stable rotations give equal-rank candidates reproducible structural variety.
  return rank * 6 + ((family + strategy) % 6);
}
