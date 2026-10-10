/** Emit only generation metadata; response seeds and solution assignments stay private. */
export async function emitDifficultyGeneration(response: Response): Promise<void> {
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const record = body as Record<string, unknown>;
  const difficulty = record.difficulty;
  const error = record.error;
  const outcome = response.status === 200 ? "generated" : "unavailable";
  console.log(JSON.stringify({
    event: "difficulty_generation",
    outcome,
    templateId: typeof record.templateId === "string" ? record.templateId : undefined,
    requestedDifficultyLevel: typeof record.requestedDifficultyLevel === "number" ? record.requestedDifficultyLevel : undefined,
    assessedDifficultyLevel: difficulty && typeof difficulty === "object" && typeof (difficulty as Record<string, unknown>).level === "number" ? (difficulty as Record<string, unknown>).level : undefined,
    modelVersion: difficulty && typeof difficulty === "object" && typeof (difficulty as Record<string, unknown>).modelVersion === "string" ? (difficulty as Record<string, unknown>).modelVersion : undefined,
    errorCode: error && typeof error === "object" && typeof (error as Record<string, unknown>).code === "string" ? (error as Record<string, unknown>).code : undefined,
  }));
}
