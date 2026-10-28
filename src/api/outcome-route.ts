import type { PuzzleTemplate } from "../domain/types.js";
import { json } from "./json-response.js";
import { badRequest, readJsonBody } from "./request-utils.js";
import { verifyPuzzleToken, type PuzzleTokenSecrets } from "./puzzle-token.js";

type OutcomeSink = (event: Record<string, unknown>) => void | Promise<void>;
type ValidatedTelemetryRecord = Record<string, unknown> & { event: string };

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

function validateIdentity(event: Record<string, unknown>, templates: Map<string, PuzzleTemplate>, trustedTemplateId: string): asserts event is ValidatedTelemetryRecord {
  if (typeof event.event !== "string" || !PUZZLE_OUTCOME_EVENTS.has(event.event)) {
    throw new TypeError("event must be a supported puzzle outcome");
  }
  if (!templates.has(trustedTemplateId)) {
    throw new TypeError("puzzleToken references an unknown template");
  }
  if (event.templateId !== undefined && event.templateId !== trustedTemplateId) {
    throw new TypeError("templateId does not match puzzleToken");
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

function normalizedTelemetryEvent(event: ValidatedTelemetryRecord, version: number, token: Extract<Awaited<ReturnType<typeof verifyPuzzleToken>>, { version: 4 }>): Record<string, unknown> {
  return {
    schemaVersion: version,
    event: event.event,
    templateId: token.templateId,
    ...(token.requestedDifficultyLevel === undefined ? {} : { requestedDifficultyLevel: token.requestedDifficultyLevel }),
    assessedDifficultyLevel: token.assessedDifficultyLevel,
    ...optionalTelemetryNumber(event, "clueCount"),
    ...optionalTelemetryNumber(event, "elapsedMs"),
    ...optionalTelemetryNumber(event, "hintsUsed"),
    ...optionalTelemetryNumber(event, "mistakes"),
    ...(typeof event.smartMarkingEnabled === "boolean" ? { smartMarkingEnabled: event.smartMarkingEnabled } : {}),
  };
}

async function telemetryRequest(value: unknown, templates: Map<string, PuzzleTemplate>, secrets: PuzzleTokenSecrets): Promise<Record<string, unknown>> {
  const event = telemetryRecord(value);
  const version = schemaVersion(event);
  if (typeof event.puzzleToken !== "string" || event.puzzleToken.trim().length === 0 || event.puzzleToken.length > 3_000) {
    throw new TypeError("puzzleToken must be a bounded non-empty string");
  }
  const token = await verifyPuzzleToken(event.puzzleToken, secrets);
  if (!token || token.version !== 4) throw new TypeError("puzzleToken is invalid or unsupported");
  validateIdentity(event, templates, token.templateId);
  validateTelemetryNumbers(event);
  if (event.requestedDifficultyLevel !== undefined && event.requestedDifficultyLevel !== token.requestedDifficultyLevel) {
    throw new TypeError("requestedDifficultyLevel does not match puzzleToken");
  }
  if (event.assessedDifficultyLevel !== undefined && event.assessedDifficultyLevel !== token.assessedDifficultyLevel) {
    throw new TypeError("assessedDifficultyLevel does not match puzzleToken");
  }
  validateVersionOneFields(event, version);
  return normalizedTelemetryEvent(event, version, token);
}

export async function outcomeRoute(
  request: Request,
  templates: Map<string, PuzzleTemplate>,
  recordOutcome?: OutcomeSink,
  secrets: PuzzleTokenSecrets = [],
): Promise<Response> {
  if (!recordOutcome) return json({ error: { code: "not_configured", message: "puzzle outcome storage is not configured" } }, 503);
  const signingSecrets = typeof secrets === "string" ? [secrets] : secrets;
  if (!signingSecrets.some(secret => secret.length > 0)) {
    return json({ error: { code: "not_configured", message: "puzzle outcome signing is not configured" } }, 503);
  }
  let event: Record<string, unknown>;
  try {
    event = await telemetryRequest(await readJsonBody(request), templates, signingSecrets);
  } catch (error) {
    return badRequest(error);
  }
  try {
    await recordOutcome(event);
    return json({ accepted: true }, 202);
  } catch {
    console.error(JSON.stringify({ event: "puzzle_outcome_storage_failure" }));
    return json({ error: { code: "storage_unavailable", message: "puzzle outcome storage is unavailable" } }, 503);
  }
}
