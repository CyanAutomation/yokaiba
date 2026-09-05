export function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ (character.codePointAt(0) ?? 0), 16777619);
  return result >>> 0;
}

export default hash;
