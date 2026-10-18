import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export interface ExternalLinkResult {
  url: string;
  status?: number;
  error?: string;
}

type StatusChecker = (url: string) => Promise<number>;
const execFileAsync = promisify(execFile);

async function curlStatus(url: string): Promise<number> {
  const { stdout } = await execFileAsync("curl", [
    "--location",
    "--silent",
    "--show-error",
    "--max-time",
    "15",
    "--output",
    "/dev/null",
    "--write-out",
    "%{http_code}",
    "--user-agent",
    "yokaiba-doc-link-check/1.0",
    url,
  ], { encoding: "utf8" });
  const status = Number(stdout);
  if (!Number.isInteger(status) || status === 0) throw new Error(`curl returned an invalid HTTP status: ${stdout.trim()}`);
  return status;
}

export function extractExternalLinks(markdown: string): string[] {
  const visibleMarkdown = markdown
    .replace(/^[ \t]{0,3}(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]{0,3}(?:```|~~~)[ \t]*$/gm, "")
    .replace(/(`+)[^`\n]*?\1/g, "");
  const links = new Set<string>();

  for (const match of visibleMarkdown.matchAll(/\]\(\s*<?(https?:\/\/[^\s)>]+)>?[^)]*\)/g)) {
    if (match[1]) links.add(match[1]);
  }

  return [...links];
}

export async function checkExternalLinks(
  urls: readonly string[],
  statusChecker: StatusChecker = curlStatus,
): Promise<ExternalLinkResult[]> {
  return Promise.all(urls.map(async url => {
    try {
      return { url, status: await statusChecker(url) };
    } catch (error) {
      return { url, error: error instanceof Error ? error.message : String(error) };
    }
  }));
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  const links = extractExternalLinks(readme);
  const results = await checkExternalLinks(links);
  let failures = 0;

  for (const result of results) {
    if (result.status !== undefined && result.status >= 200 && result.status < 400) {
      console.log(`OK ${result.status} ${result.url}`);
    } else {
      failures += 1;
      console.error(`FAIL ${result.status ?? "network error"} ${result.url}${result.error ? `: ${result.error}` : ""}`);
    }
  }

  console.log(`Checked ${results.length} external README links; ${failures} failed.`);
  if (failures > 0) process.exitCode = 1;
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath === fileURLToPath(import.meta.url)) await main();
