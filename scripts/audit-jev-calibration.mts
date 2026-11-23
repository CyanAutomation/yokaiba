import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readJevAuditReport } from "./audit-jev-support.js";
import { compareJevWithHumanCalibration, parseHumanCalibrationLabels, renderHumanCalibrationMarkdown } from "./audit-jev-calibration-support.js";

function parseArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!["--report", "--labels", "--out"].includes(option)) throw new Error(`unknown option ${option}`);
    if (values.has(option)) throw new Error(`duplicate option ${option}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    values.set(option, value);
  }
  const report = values.get("--report");
  const labels = values.get("--labels");
  const outputBase = values.get("--out");
  if (!report) throw new Error("--report requires a saved JEV audit JSON report");
  if (!labels) throw new Error("--labels requires a version 1 human calibration JSON file");
  if (!outputBase) throw new Error("--out requires a base path without a JSON or Markdown extension");
  if (/\.(?:json|md)$/i.test(outputBase)) throw new Error("--out takes a base path without a JSON or Markdown extension");
  return { report, labels, outputBase };
}

const args = parseArguments(process.argv.slice(2));
const sourcePath = resolve(args.report);
const labelsPath = resolve(args.labels);
const outputBase = resolve(args.outputBase);
const jsonPath = `${outputBase}.json`;
const markdownPath = `${outputBase}.md`;
if ([jsonPath, markdownPath].some(path => path === sourcePath || path === labelsPath)) {
  throw new Error("--out must identify files different from --report and --labels");
}
const source = await readJevAuditReport(sourcePath);
const labels = parseHumanCalibrationLabels(JSON.parse(await readFile(labelsPath, "utf8")) as unknown);
const comparison = compareJevWithHumanCalibration(source.clueAudit.clues, labels);
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify({
  reportVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceReport: sourcePath,
  labelsFile: labelsPath,
  generationModelVersion: source.configuration.generationModelVersion,
  semanticAssessmentSchemaVersion: source.configuration.semanticAssessmentSchemaVersion,
  comparison,
}, null, 2)}\n`);
await writeFile(markdownPath, renderHumanCalibrationMarkdown(comparison, sourcePath, labelsPath));
console.log(JSON.stringify({ json: jsonPath, markdown: markdownPath, ...comparison }, null, 2));
