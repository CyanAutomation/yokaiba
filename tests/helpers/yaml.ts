import { createRequire } from "node:module";

type YamlObject = Record<string, any>;

/** Parse YAML with the same parser bundled in the project's Swagger UI. */
export function parseYamlDocument(source: string): YamlObject {
  const require = createRequire(import.meta.url);
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
  let SwaggerUI: YamlObject;
  try {
    Object.defineProperty(globalThis, "self", { value: globalThis, configurable: true });
    SwaggerUI = require("swagger-ui-dist/swagger-ui-bundle.js");
  } finally {
    if (originalSelf) Object.defineProperty(globalThis, "self", originalSelf);
    else Reflect.deleteProperty(globalThis, "self");
  }

  const actions = SwaggerUI.plugins.Spec({ getSystem: () => ({}) }).statePlugins.spec.actions;
  let parsed: YamlObject | undefined;
  let parseError: unknown;
  actions.parseToJson(source)({
    specActions: { updateJsonSpec: (value: YamlObject) => { parsed = value; } },
    specSelectors: { specStr: () => source },
    errActions: {
      clear: () => undefined,
      newSpecErr: (error: unknown) => { parseError = error; },
    },
  });
  if (parseError) throw parseError;
  if (!parsed) throw new Error("YAML parser did not produce a document");
  return parsed;
}
