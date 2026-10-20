import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
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

export interface DocumentationMarkdownFile {
  path: string;
  markdown: string;
}

export function readDocumentationMarkdown(root: string): DocumentationMarkdownFile[] {
  const readmePath = path.join(root, "README.md");
  const docsPath = path.join(root, "docs");
  const docsMarkdownPaths: string[] = [];

  if (!statSync(readmePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`README.md is required for external link checking: ${readmePath}`);
  }

  function collect(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(entryPath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        docsMarkdownPaths.push(entryPath);
      }
    }
  }

  if (statSync(docsPath, { throwIfNoEntry: false })?.isDirectory()) collect(docsPath);
  return [readmePath, ...docsMarkdownPaths].map(filePath => ({
    path: filePath,
    markdown: readFileSync(filePath, "utf8"),
  }));
}

async function curlStatus(url: string): Promise<number> {
  const { stdout } = await execFileAsync("curl", [
    "--location",
    "--silent",
    "--show-error",
    "--retry",
    "2",
    "--retry-all-errors",
    "--retry-delay",
    "1",
    "--retry-max-time",
    "45",
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
  const documents = readDocumentationMarkdown(root);
  const links = [...new Set(documents.flatMap(document => extractExternalLinks(document.markdown)))];
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

  console.log(`Checked ${results.length} external documentation links across ${documents.length} Markdown files; ${failures} failed.`);
  if (failures > 0) process.exitCode = 1;
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath === fileURLToPath(import.meta.url)) await main();
