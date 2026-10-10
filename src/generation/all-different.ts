type PossibleRows = Map<string, Array<Set<string>>>;

function eliminateAssignedValues(cells: Array<Set<string>>): boolean {
  const assigned = new Set(cells.filter(cell => cell.size === 1).map(cell => [...cell][0]));
  let changed = false;
  for (const cell of cells) {
    if (cell.size <= 1) continue;
    for (const value of assigned) changed = cell.delete(value) || changed;
  }
  return changed;
}

function assignUniqueCandidates(cells: Array<Set<string>>): boolean {
  let changed = false;
  const remainingValues = cells.flatMap(cell => [...cell]);
  for (const value of remainingValues) {
    const possibleRows = cells.flatMap((cell, row) => cell.has(value) ? [row] : []);
    if (possibleRows.length !== 1) continue;
    const cell = cells[possibleRows[0]!];
    if (cell.size > 1) {
      cells[possibleRows[0]!] = new Set([value]);
      changed = true;
    }
  }
  return changed;
}

/** Propagate singleton values and values that can occupy only one row per category. */
export function propagateAllDifferent(possible: PossibleRows): boolean {
  let changed = false;
  for (const cells of possible.values()) {
    changed = eliminateAssignedValues(cells) || changed;
    changed = assignUniqueCandidates(cells) || changed;
  }
  return changed;
}
