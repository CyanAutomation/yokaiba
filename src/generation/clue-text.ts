import type { Clue, ClueConstraint, PuzzleTemplate } from "../domain/types.js";
import { hash } from "../domain/hash.js";
import { renderConstraintText } from "./clue-language.js";

export const CLUE_LANGUAGE_VERSION = "yokaiba-clue-prose-v7";

function chooseVariant(seed: string, clue: Clue, count: number, previousFamily?: string) {
  let index = hash(`${seed}:${clue.id}:${CLUE_LANGUAGE_VERSION}`) % count;
  const family = `${clue.constraint.kind}-${index}`;
  if (count > 1 && family === previousFamily) index = (index + 1) % count;
  return index;
}

/** Render semantic constraints through a deterministic, bounded phrase catalogue. */
export function renderClues(template: PuzzleTemplate, seed: string, clues: readonly Clue[]): Clue[] {
  const previousFamilies = new Map<ClueConstraint["kind"], string>();
  return clues.map(clue => {
    const index = chooseVariant(seed, clue, 2, previousFamilies.get(clue.constraint.kind));
    const phraseVariant = `${clue.constraint.kind}-${index}`;
    previousFamilies.set(clue.constraint.kind, phraseVariant);
    return {
      ...clue,
      text: renderConstraintText(template, clue.constraint, index),
      phraseVariant,
      languageVersion: CLUE_LANGUAGE_VERSION,
    };
  });
}
