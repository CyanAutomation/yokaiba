import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MarkdownIssue {
  file: string;
  line: number;
  message: string;
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolutePath] : [];
  });
}

function documentationFiles(root: string): string[] {
  const files = [path.join(root, "README.md")];
  const docs = path.join(root, "docs");
  if (statSync(docs, { throwIfNoEntry: false })?.isDirectory()) files.push(...markdownFiles(docs));
  const skills = path.join(root, ".github", "skills");
  if (statSync(skills, { throwIfNoEntry: false })?.isDirectory()) files.push(...markdownFiles(skills));
  return files;
}

function headingAnchors(source: string): Set<string> {
  const headings = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of source.split(/\r?\n/)) {
    const heading = headingText(line);
    if (!heading) continue;
    const base = headingAnchorBase(heading);
    if (!base) continue;
    addHeadingAnchor(headings, counts, base);
  }
  return headings;
}

function headingText(line: string): string | undefined {
  return /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
}

function headingAnchorBase(heading: string): string {
  return heading
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[*_~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function addHeadingAnchor(headings: Set<string>, counts: Map<string, number>, base: string): void {
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  headings.add(count === 0 ? base : `${base}-${count}`);
}

function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

interface MarkdownFileContext {
  file: string;
  relativeFile: string;
  source: string;
  knownFiles: Set<string>;
  contents: Map<string, string>;
}

function packageScripts(root: string): Set<string> {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return new Set(Object.keys(packageJson.scripts ?? {}));
}

function visibleMarkdownSource(source: string): string {
  return source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, block => block.replace(/[^\n]/g, " "));
}

function localTarget(rawTarget: string): string | undefined {
  const trimmedTarget = rawTarget.trim();
  const target = trimmedTarget.startsWith("<") && trimmedTarget.includes(">")
    ? trimmedTarget.slice(1, trimmedTarget.indexOf(">"))
    : trimmedTarget.split(/\s+/, 1)[0] ?? "";
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return undefined;
  return target;
}

function splitTarget(decodedTarget: string): { targetPath: string; anchor: string } {
  const hashIndex = decodedTarget.indexOf("#");
  return {
    targetPath: hashIndex < 0 ? decodedTarget : decodedTarget.slice(0, hashIndex),
    anchor: hashIndex < 0 ? "" : decodedTarget.slice(hashIndex + 1),
  };
}

function issueAt(context: MarkdownFileContext, offset: number, message: string): MarkdownIssue {
  return { file: context.relativeFile, line: lineNumber(context.source, offset), message };
}

function targetContents(context: MarkdownFileContext, resolvedFile: string): string | undefined {
  const cached = context.contents.get(resolvedFile);
  if (cached !== undefined) return cached;
  if (!statSync(resolvedFile, { throwIfNoEntry: false })?.isFile()) return undefined;
  return readFileSync(resolvedFile, "utf8");
}

function targetExists(context: MarkdownFileContext, resolvedFile: string): boolean {
  return context.knownFiles.has(resolvedFile) || Boolean(statSync(resolvedFile, { throwIfNoEntry: false })?.isFile());
}

function unknownAnchorIssue(
  context: MarkdownFileContext,
  resolvedFile: string,
  targetPath: string,
  anchor: string,
  offset: number,
): MarkdownIssue | undefined {
  const contents = targetContents(context, resolvedFile) ?? "";
  if (headingAnchors(contents).has(anchor.toLowerCase())) return undefined;
  const targetName = targetPath || path.basename(context.file);
  return issueAt(context, offset, `unknown anchor #${anchor} in ${targetName}`);
}

function validateLocalLink(context: MarkdownFileContext, rawTarget: string, offset: number): MarkdownIssue | undefined {
  const target = localTarget(rawTarget);
  if (!target) return undefined;

  let decodedTarget: string;
  try {
    decodedTarget = decodeURIComponent(target);
  } catch {
    return issueAt(context, offset, `invalid URL encoding in local link: ${target}`);
  }

  const { targetPath, anchor } = splitTarget(decodedTarget);
  const resolvedFile = path.resolve(path.dirname(context.file), targetPath || path.basename(context.file));
  if (!targetExists(context, resolvedFile)) {
    return issueAt(context, offset, `local link target does not exist: ${targetPath}`);
  }
  if (!anchor) return undefined;
  return unknownAnchorIssue(context, resolvedFile, targetPath, anchor, offset);
}

function markdownLinkIssues(context: MarkdownFileContext): MarkdownIssue[] {
  const visibleSource = visibleMarkdownSource(context.source);
  const issues: MarkdownIssue[] = [];
  for (const match of visibleSource.matchAll(/\[[^\]]*\]\(([^)]*)\)/g)) {
    const issue = validateLocalLink(context, match[1] ?? "", match.index ?? 0);
    if (issue) issues.push(issue);
  }
  return issues;
}

function packageScriptIssues(context: MarkdownFileContext, scripts: Set<string>): MarkdownIssue[] {
  const issues: MarkdownIssue[] = [];
  for (const match of context.source.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)) {
    const scriptName = match[1];
    if (scriptName && !scripts.has(scriptName)) {
      issues.push(issueAt(context, match.index ?? 0, `unknown package script: npm run ${scriptName}`));
    }
  }
  return issues;
}

function markdownFileContext(root: string, file: string, knownFiles: Set<string>, contents: Map<string, string>): MarkdownFileContext {
  const source = contents.get(file) ?? "";
  return {
    file,
    relativeFile: path.relative(root, file).split(path.sep).join("/"),
    source,
    knownFiles,
    contents,
  };
}

export function inspectMarkdown(root: string): MarkdownIssue[] {
  const scripts = packageScripts(root);
  const files = documentationFiles(root);
  const knownFiles = new Set(files);
  const contents = new Map(files.map(file => [file, readFileSync(file, "utf8")]));
  const issues: MarkdownIssue[] = [];

  for (const file of files) {
    const context = markdownFileContext(root, file, knownFiles, contents);
    issues.push(...markdownLinkIssues(context), ...packageScriptIssues(context, scripts));
  }

  return issues;
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const issues = inspectMarkdown(root);
  if (issues.length > 0) {
    for (const issue of issues) console.error(`${issue.file}:${issue.line}: ${issue.message}`);
    process.exitCode = 1;
  } else {
    console.log("Documentation links and npm scripts are valid.");
  }
}
