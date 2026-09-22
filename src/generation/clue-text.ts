import type { Clue, ClueConstraint, PuzzleTemplate } from "../domain/types.js";
import { hash } from "../domain/hash.js";

export const CLUE_LANGUAGE_VERSION = "yokaiba-clue-prose-v5";

function capitalise(value: string) {
  return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function isMedalResult(value: string) {
  return ["Gold", "Silver", "Bronze"].includes(value);
}

function resultSubject(value: string) {
  return isMedalResult(value) ? `the ${value.toLowerCase()} medallist` : `the ${value.toLowerCase()}`;
}

function resultAction(value: string) {
  return isMedalResult(value) ? `won ${value}` : `finished as a ${value.toLowerCase()}`;
}

function negativeResultAction(value: string) {
  return isMedalResult(value) ? `win ${value}` : `finish as a ${value.toLowerCase()}`;
}

function termSubject(categoryId: string, value: string) {
  if (categoryId === "weight") return `the ${value} competitor`;
  if (categoryId === "tatami") return `the competitor on ${value}`;
  if (categoryId === "placing") return `the competitor who finished ${value}`;
  if (categoryId === "result") return `the competitor who finished ${value}`;
  if (categoryId === "medal") return resultSubject(value);
  return `the competitor with ${value}`;
}

function subjectAction(categoryId: string, value: string) {
  if (categoryId === "weight") return `fought in the ${value} division`;
  if (categoryId === "tatami") return `competed on ${value}`;
  if (categoryId === "placing") return `finished in ${value} place`;
  if (categoryId === "result") return `finished in ${value} place`;
  if (categoryId === "medal") return resultAction(value);
  return `had ${value}`;
}

function negativeAction(categoryId: string, value: string) {
  if (categoryId === "weight") return `fight in the ${value} division`;
  if (categoryId === "tatami") return `compete on ${value}`;
  if (categoryId === "placing") return `finish ${value}`;
  if (categoryId === "result") return `finish in ${value} place`;
  if (categoryId === "medal") return negativeResultAction(value);
  return `have ${value}`;
}

function chooseVariant(seed: string, clue: Clue, count: number, previousFamily?: string) {
  let index = hash(`${seed}:${clue.id}:${CLUE_LANGUAGE_VERSION}`) % count;
  const family = `${clue.constraint.kind}-${index}`;
  if (count > 1 && family === previousFamily) index = (index + 1) % count;
  return index;
}

function renderConstraint(template: PuzzleTemplate, constraint: ClueConstraint, index: number): string {
  if (constraint.kind === "matches") {
    const action = subjectAction(constraint.category, constraint.value);
    return `${constraint.subject} ${action}.`;
  }
  if (constraint.kind === "notMatches") {
    const action = negativeAction(constraint.category, constraint.value);
    return `${constraint.subject} did not ${action}.`;
  }
  if (constraint.kind === "sameRow") {
    const subject = termSubject(constraint.left.category, constraint.left.value);
    const action = subjectAction(constraint.right.category, constraint.right.value);
    if (index === 0) return `${subject[0]!.toUpperCase()}${subject.slice(1)} ${action}.`;
    if (constraint.right.category === "placing") return `${constraint.right.value} place went to ${subject}.`;
    if (constraint.right.category === "tatami") return `${subject[0]!.toUpperCase()}${subject.slice(1)} was scheduled on ${constraint.right.value}.`;
    if (constraint.right.category === "weight") return `${subject[0]!.toUpperCase()}${subject.slice(1)} competed in the ${constraint.right.value} division.`;
    if (constraint.right.category === "medal") return `${subject[0]!.toUpperCase()}${subject.slice(1)} ${resultAction(constraint.right.value)}.`;
    return `${subject[0]!.toUpperCase()}${subject.slice(1)} had ${constraint.right.value}.`;
  }
  if (constraint.kind === "before") {
    const left = termSubject(constraint.left.category, constraint.left.value);
    const right = termSubject(constraint.right.category, constraint.right.value);
    return index === 0
      ? `In the ${template.title.toLowerCase()} order, ${left} came before ${right}.`
      : `In the ${template.title.toLowerCase()} order, ${left} was earlier than ${right}.`;
  }
  if (constraint.kind === "adjacent") {
    const left = termSubject(constraint.left.category, constraint.left.value);
    const right = termSubject(constraint.right.category, constraint.right.value);
    return index === 0
      ? `In the ${template.title.toLowerCase()} order, ${left} and ${right} occupied consecutive positions.`
      : `In the ${template.title.toLowerCase()} order, ${left} was immediately next to ${right}.`;
  }
  const left = termSubject(constraint.left.category, constraint.left.value);
  const right = termSubject(constraint.right.category, constraint.right.value);
  const positionWords = ["zero", "one", "two", "three", "four"];
  const distance = positionWords[constraint.distance] ?? String(constraint.distance);
  const positions = `${distance} position${constraint.distance === 1 ? "" : "s"}`;
  return index === 0
    ? `In the ${template.title.toLowerCase()} order, ${left} and ${right} were exactly ${positions} apart.`
    : `In the ${template.title.toLowerCase()} order, ${left} was exactly ${positions} away from ${right}.`;
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
      text: renderConstraint(template, clue.constraint, index),
      phraseVariant,
      languageVersion: CLUE_LANGUAGE_VERSION,
    };
  });
}
