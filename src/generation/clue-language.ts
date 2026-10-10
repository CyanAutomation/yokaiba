import type { ClueConstraint, PuzzleTemplate } from "../domain/types.js";

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
  if (categoryId === "placing" || categoryId === "result") return `the competitor who finished ${value}`;
  if (categoryId === "medal") return resultSubject(value);
  return `the competitor with ${value}`;
}

function subjectAction(categoryId: string, value: string) {
  if (categoryId === "weight") return `fought in the ${value} division`;
  if (categoryId === "tatami") return `competed on ${value}`;
  if (categoryId === "placing" || categoryId === "result") return `finished in ${value} place`;
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

function orderedContext(template: PuzzleTemplate) {
  const title = template.title.trim().replace(/\s+/g, " ");
  return /\border$/i.test(title) ? title : `${title} order`;
}

function renderSameRow(constraint: Extract<ClueConstraint, { kind: "sameRow" }>, index: number): string {
  const subject = termSubject(constraint.left.category, constraint.left.value);
  const capitalizedSubject = capitalise(subject);
  const action = subjectAction(constraint.right.category, constraint.right.value);
  if (index === 0) return `${capitalizedSubject} ${action}.`;
  if (constraint.right.category === "placing") return `${constraint.right.value} place went to ${subject}.`;
  if (constraint.right.category === "tatami") return `${capitalizedSubject} was scheduled on ${constraint.right.value}.`;
  if (constraint.right.category === "weight") return `${capitalizedSubject} competed in the ${constraint.right.value} division.`;
  if (constraint.right.category === "medal") return `${capitalizedSubject} ${resultAction(constraint.right.value)}.`;
  return `${capitalizedSubject} had ${constraint.right.value}.`;
}

function orderedTerms(constraint: Extract<ClueConstraint, { kind: "before" | "adjacent" | "distance" }>) {
  const left = termSubject(constraint.left.category, constraint.left.value);
  const right = termSubject(constraint.right.category, constraint.right.value);
  return { left, right };
}

function renderBefore(template: PuzzleTemplate, constraint: Extract<ClueConstraint, { kind: "before" }>, index: number): string {
  const { left, right } = orderedTerms(constraint);
  const relation = index === 0 ? `${left} came before ${right}` : `${left} was earlier than ${right}`;
  return `In the ${orderedContext(template).toLowerCase()}, ${relation}.`;
}

function renderAdjacent(template: PuzzleTemplate, constraint: Extract<ClueConstraint, { kind: "adjacent" }>, index: number): string {
  const { left, right } = orderedTerms(constraint);
  const relation = index === 0
    ? `${left} and ${right} occupied consecutive positions`
    : `${left} was immediately next to ${right}`;
  return `In the ${orderedContext(template).toLowerCase()}, ${relation}.`;
}

function renderDistance(template: PuzzleTemplate, constraint: Extract<ClueConstraint, { kind: "distance" }>, index: number): string {
  const { left, right } = orderedTerms(constraint);
  const positionWords = ["zero", "one", "two", "three", "four"];
  const distance = positionWords[constraint.distance] ?? String(constraint.distance);
  const place = constraint.distance === 1 ? "place" : "places";
  return index === 0
    ? `In the ${orderedContext(template).toLowerCase()}, ${left} and ${right} were exactly ${distance} ${place} apart.`
    : `${left} and ${right} were exactly ${distance} ${place} apart in the ${orderedContext(template).toLowerCase()}.`;
}

export function renderConstraintText(template: PuzzleTemplate, constraint: ClueConstraint, index: number): string {
  switch (constraint.kind) {
    case "matches": return `${constraint.subject} ${subjectAction(constraint.category, constraint.value)}.`;
    case "notMatches": return `${constraint.subject} did not ${negativeAction(constraint.category, constraint.value)}.`;
    case "sameRow": return renderSameRow(constraint, index);
    case "before": return renderBefore(template, constraint, index);
    case "adjacent": return renderAdjacent(template, constraint, index);
    case "distance": return renderDistance(template, constraint, index);
  }
}
