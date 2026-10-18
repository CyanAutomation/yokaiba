import { parse } from "yaml";

type YamlObject = Record<string, any>;

/** Parse YAML documents used by tests. */
export function parseYamlDocument(source: string): YamlObject {
  const parsed: unknown = parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML document must contain a mapping at its root");
  }
  return parsed as YamlObject;
}
