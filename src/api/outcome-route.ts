import type { PuzzleTemplate } from "../domain/types.js";
import { json } from "./json-response.js";
import { badRequest, readJsonBody } from "./request-utils.js";

type OutcomeSink = (event: Record<string, unknown>) => void | Promise<void>;
type ValidatedTelemetryRecord = Record<string, unknown> & { event: string; templateId: string };

const PUZZLE_OUTCOME_EVENTS = new Set(["puzzle_started", "puzzle_completed", "hint_used", "mistake", "puzzle_abandoned"]);
const TELEMETRY_NUMBER_RANGES = [
  ["requestedDifficultyLevel", 1, 12],
  ["assessedDifficultyLevel", 1, 12],
  ["clueCount", 0, 100],
  ["elapsedMs", 0, 86_400_000],
  ["hintsUsed", 0, 100],
  ["mistakes", 0, 100],
] as const;
const VERSION_ONE_OUTCOME_FIELDS: Record<string, readonly string[]> = {
  puzzle_started: ["hintsUsed", "mistakes"],
  puzzle_completed: ["elapsedMs", "hintsUsed", "mistakes"],
  hint_used: ["hintsUsed", "mistakes"],
  mistake: ["hintsUsed", "mistakes"],
  puzzle_abandoned: ["elapsedMs", "hintsUsed", "mistakes"],
};

function telemetryRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("request body must be an object");
  return value as Record<string, unknown>;
}

function schemaVersion(event: Record<string, unknown>): number {
  const version = event.schemaVersion === undefined ? 0 : event.schemaVersion;
  if (version !== 0 && version !== 1) throw new TypeError("schemaVersion must be 0 or 1");
  return version;
}

function validateIdentity(event: Record<string, unknown>, templates: Map<string, PuzzleTemplate>): asserts event is ValidatedTelemetryRecord {
  if (typeof event.event !== "string" || !PUZZLE_OUTCOME_EVENTS.has(event.event)) {
    throw new TypeError("event must be a supported puzzle outcome");
  }
  if (typeof event.templateId !== "string" || !templates.has(event.templateId)) {
    throw new TypeError("templateId must reference a known template");
  }
}

function validateTelemetryNumbers(event: Record<string, unknown>): void {
  for (const [name, minimum, maximum] of TELEMETRY_NUMBER_RANGES) {
    const candidate = event[name];
    if (candidate !== undefined && (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum)) {
      throw new TypeError(name + " is outside its supported range");
    }
  }
  if (event.smartMarkingEnabled !== undefined && typeof event.smartMarkingEnabled !== "boolean") {
    throw new TypeError("smartMarkingEnabled must be a boolean");
  }
}

function validateVersionOneFields(event: ValidatedTelemetryRecord, version: number): void {
  if (version !== 1) return;
  const requiredFields = VERSION_ONE_OUTCOME_FIELDS[event.event];
  if (!requiredFields) return;
  for (const field of requiredFields) {
    if (typeof event[field] !== "number") throw new TypeError(field + " is required for " + event.event + " schema version 1");
  }
}

function optionalTelemetryNumber(event: Record<string, unknown>, name: string): Record<string, number> {
  const value = event[name];
  return typeof value === "number" ? { [name]: value } : {};
}

function normalizedTelemetryEvent(event: ValidatedTelemetryRecord, version: number): Record<string, unknown> {
  return {
    schemaVersion: version,
    event: event.event,
    templateId: event.templateId,
    ...optionalTelemetryNumber(event, "requestedDifficultyLevel"),
    ...optionalTelemetryNumber(event, "assessedDifficultyLevel"),
    ...optionalTelemetryNumber(event, "clueCount"),
    ...optionalTelemetryNumber(event, "elapsedMs"),
    ...optionalTelemetryNumber(event, "hintsUsed"),
    ...optionalTelemetryNumber(event, "mistakes"),
    ...(typeof event.smartMarkingEnabled === "boolean" ? { smartMarkingEnabled: event.smartMarkingEnabled } : {}),
  };
}

function telemetryRequest(value: unknown, templates: Map<string, PuzzleTemplate>): Record<string, unknown> {
  const event = telemetryRecord(value);
  const version = schemaVersion(event);
  validateIdentity(event, templates);
  validateTelemetryNumbers(event);
  validateVersionOneFields(event, version);
  return normalizedTelemetryEvent(event, version);
}

export async function outcomeRoute(
  request: Request,
  templates: Map<string, PuzzleTemplate>,
  recordOutcome?: OutcomeSink,
): Promise<Response> {
  let event: Record<string, unknown>;
  try {
    event = telemetryRequest(await readJsonBody(request), templates);
  } catch (error) {
    return badRequest(error);
  }
  if (!recordOutcome) return json({ error: { code: "not_configured", message: "puzzle outcome storage is not configured" } }, 503);
  try {
    await recordOutcome(event);
    return json({ accepted: true }, 202);
  } catch {
    console.error(JSON.stringify({ event: "puzzle_outcome_storage_failure" }));
    return json({ error: { code: "storage_unavailable", message: "puzzle outcome storage is unavailable" } }, 503);
  }
}
