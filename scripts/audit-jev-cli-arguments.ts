export interface ParsedCliOptions {
  values: Map<string, string>;
  flags: Set<string>;
}

export function parseCliOptions(
  argv: readonly string[],
  valueOptions: readonly string[],
  booleanOptions: readonly string[] = [],
): ParsedCliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (booleanOptions.includes(option)) {
      if (flags.has(option)) throw new Error(`duplicate option ${option}`);
      flags.add(option);
      continue;
    }
    if (!valueOptions.includes(option)) throw new Error(`unknown option ${option}`);
    if (values.has(option)) throw new Error(`duplicate option ${option}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    values.set(option, value);
    index += 1;
  }
  return { values, flags };
}
