import { z } from "zod";

export const DEFAULT_PUBLIC_API_BASE_URL = "https://yokaiba.scheimann.workers.dev";

const CategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  values: z.array(z.string()),
  ordered: z.boolean().optional(),
});

const PuzzleSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  baseCategory: z.string(),
  categories: z.array(CategorySchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ScenarioSchema = PuzzleSpecSchema;

const CandidateScoreRangeSchema = z.object({
  minimum: z.number(),
  maximum: z.number(),
  complete: z.number().int(),
  incomplete: z.number().int(),
});

const ErrorOutputSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
  templateId: z.string().optional(),
  requestedDifficultyLevel: z.number().int().min(1).max(12).optional(),
  availableDifficultyLevels: z.array(z.number().int().min(1).max(12)).optional(),
  selectionDiagnostics: z.object({
    modelVersion: z.string(),
    strategiesAttempted: z.number().int().min(0),
    eligibleCandidates: z.number().int().min(0),
    reason: z.literal("no_candidate_in_band"),
    fallbackSeedsAttempted: z.number().int().min(0).optional(),
    candidateScoreRange: CandidateScoreRangeSchema.optional(),
  }).optional(),
});

const PuzzleOutputSchema = z.object({
  id: z.string(),
  requestedSeed: z.string(),
  seed: z.string(),
  requestedDifficultyLevel: z.number().int().min(1).max(12).optional(),
  seedFallbackAttempt: z.number().int().min(1).optional(),
  generationStrategy: z.number().int().min(0).optional(),
  difficultyModel: z.enum(["v4", "v5", "compare"]).optional(),
  difficultyProfile: z.record(z.string(), z.unknown()).optional(),
  selectionDiagnostics: z.object({
    modelVersion: z.string(),
    strategyBudget: z.number().int().min(1),
    strategiesAttempted: z.number().int().min(0),
    eligibleCandidates: z.number().int().min(0),
    selectedScore: z.number().optional(),
    selectedRankDistance: z.number().optional(),
    candidateScoreRange: CandidateScoreRangeSchema.optional(),
  }).optional(),
  templateId: z.string(),
  generatorVersion: z.string(),
  solverVersion: z.string(),
  puzzleToken: z.string().optional(),
  puzzleFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  spec: PuzzleSpecSchema,
  clues: z.array(z.object({
    id: z.string(),
    constraint: z.record(z.string(), z.unknown()),
    text: z.string(),
    phraseVariant: z.string().optional(),
    languageVersion: z.string().optional(),
  })),
  difficulty: z.object({
    level: z.number().int().min(1).max(12),
    label: z.string(),
    modelVersion: z.string(),
    evidence: z.record(z.string(), z.unknown()),
  }),
});

const GenerationBodySchema = z.object({
  templateId: z.string().min(1).max(128),
  seed: z.string().min(1).max(128).optional(),
  difficultyLevel: z.number().int().min(1).max(12).optional(),
  allowSeedFallback: z.boolean().optional(),
  difficultyModel: z.enum(["v4", "v5", "compare"]).optional(),
});

const VerifyBodySchema = z.object({
  puzzleToken: z.string().min(1).max(16_384),
  answer: z.object({ assignments: z.record(z.string(), z.array(z.string())) }),
});

const HintBodySchema = z.object({
  puzzleToken: z.string().min(1).max(16_384),
  kind: z.enum(["clue", "elimination"]).optional(),
  hintIndex: z.number().int().min(0).max(100).optional(),
});

function loopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    return octets.every(octet => octet <= 255) && octets[0] === 127;
  }
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!mappedIpv4) return false;
  const octets = mappedIpv4.slice(1).map(Number);
  return octets.every(octet => octet <= 255) && octets[0] === 127;
}

export function normalizePublicApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHostname(url.hostname))) {
    throw new Error("public API base URL must use HTTPS, except for HTTP loopback during local development");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("public API base URL must be an origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

interface HttpCallTemplate {
  call_template_type: "http";
  url: string;
  http_method: "GET" | "POST";
  content_type?: "application/json";
  body_field?: "body";
}

interface UtcpTool {
  name: string;
  description: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  tool_call_template: HttpCallTemplate;
}

export interface UtcpManual {
  manual_version: "1.0.0";
  utcp_version: "1.0.1";
  info: { title: string; version: string; description: string };
  tools: UtcpTool[];
}

export interface CreateUtcpManualOptions {
  publicApiBaseUrl: string;
  serviceVersion: string;
  puzzleActionsAvailable: boolean;
}

function bodyTool(name: string, description: string, url: string, inputSchema: z.ZodType, outputSchema: z.ZodType): UtcpTool {
  return {
    name,
    description,
    inputs: z.toJSONSchema(z.object({ body: inputSchema })),
    outputs: z.toJSONSchema(outputSchema),
    tool_call_template: {
      call_template_type: "http",
      url,
      http_method: "POST",
      content_type: "application/json",
      body_field: "body",
    },
  };
}

export function createUtcpManual(options: CreateUtcpManualOptions): UtcpManual {
  const baseUrl = normalizePublicApiBaseUrl(options.publicApiBaseUrl);
  const tools: UtcpTool[] = [
    {
      name: "list_scenarios",
      description: "List curated judo logic-puzzle scenarios. Use a returned scenario id with generate_puzzle.",
      inputs: z.toJSONSchema(z.object({})),
      outputs: z.toJSONSchema(z.object({ scenarios: z.array(ScenarioSchema) })),
      tool_call_template: {
        call_template_type: "http",
        url: `${baseUrl}/v1/scenarios`,
        http_method: "GET",
      },
    },
    bodyTool(
      "generate_puzzle",
      "Generate a deterministic, uniquely solvable judo logic-grid puzzle. Put the REST request fields inside body. The solution is never returned. If seed is omitted, one is generated and returned for replay.",
      `${baseUrl}/v1/puzzles/generate`,
      GenerationBodySchema,
      z.union([PuzzleOutputSchema, ErrorOutputSchema]),
    ),
  ];

  if (options.puzzleActionsAvailable) {
    tools.push(
      bodyTool(
        "verify_puzzle_answer",
        "Check a complete puzzle answer using its puzzleToken. Put puzzleToken and answer inside body. Returns only whether the whole answer is correct.",
        `${baseUrl}/v1/puzzles/verify`,
        VerifyBodySchema,
        z.union([z.object({ correct: z.boolean() }), ErrorOutputSchema]),
      ),
      bodyTool(
        "get_puzzle_hint",
        "Return one public clue as a spoiler-safe reminder. Put puzzleToken and optional hint fields inside body. No hint returns a solution placement.",
        `${baseUrl}/v1/puzzles/hint`,
        HintBodySchema,
        z.union([
          z.object({ kind: z.enum(["clue", "elimination"]), clue: z.object({ id: z.string(), text: z.string() }) }),
          ErrorOutputSchema,
        ]),
      ),
    );
  }

  return {
    manual_version: "1.0.0",
    utcp_version: "1.0.1",
    info: {
      title: "Yokaiba API",
      version: options.serviceVersion,
      description: "Discover and use Yokaiba's REST puzzle tools directly over HTTP.",
    },
    tools,
  };
}
