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
  return files;
}

function headingAnchors(source: string): Set<string> {
  const headings = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of source.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (!heading) continue;
    const base = heading
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .replace(/[*_~]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_ -]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    if (!base) continue;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    headings.add(count === 0 ? base : `${base}-${count}`);
  }
  return headings;
}

function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

export function inspectMarkdown(root: string): MarkdownIssue[] {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const files = documentationFiles(root);
  const knownFiles = new Set(files);
  const contents = new Map(files.map(file => [file, readFileSync(file, "utf8")]));
  const issues: MarkdownIssue[] = [];

  for (const file of files) {
    const source = contents.get(file) ?? "";
    const relativeFile = path.relative(root, file).split(path.sep).join("/");
    const visibleSource = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, block => block.replace(/[^\n]/g, " "));

    for (const match of visibleSource.matchAll(/\[[^\]]*\]\(([^)]*)\)/g)) {
      const rawTarget = match[1]?.trim() ?? "";
      const target = rawTarget.startsWith("<") && rawTarget.includes(">")
        ? rawTarget.slice(1, rawTarget.indexOf(">"))
        : rawTarget.split(/\s+/, 1)[0] ?? "";
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;

      let decodedTarget: string;
      try {
        decodedTarget = decodeURIComponent(target);
      } catch {
        issues.push({ file: relativeFile, line: lineNumber(source, match.index ?? 0), message: `invalid URL encoding in local link: ${target}` });
        continue;
      }
      const hashIndex = decodedTarget.indexOf("#");
      const targetPath = hashIndex < 0 ? decodedTarget : decodedTarget.slice(0, hashIndex);
      const anchor = hashIndex < 0 ? "" : decodedTarget.slice(hashIndex + 1);
      const resolvedFile = path.resolve(path.dirname(file), targetPath || path.basename(file));
      const targetExists = knownFiles.has(resolvedFile) || statSync(resolvedFile, { throwIfNoEntry: false })?.isFile();
      if (!targetExists) {
        issues.push({ file: relativeFile, line: lineNumber(source, match.index ?? 0), message: `local link target does not exist: ${targetPath}` });
        continue;
      }
      if (!anchor) continue;
      let targetContents = contents.get(resolvedFile);
      if (targetContents === undefined && statSync(resolvedFile, { throwIfNoEntry: false })?.isFile()) {
        targetContents = readFileSync(resolvedFile, "utf8");
      }
      if (!headingAnchors(targetContents ?? "").has(anchor.toLowerCase())) {
        issues.push({ file: relativeFile, line: lineNumber(source, match.index ?? 0), message: `unknown anchor #${anchor} in ${targetPath || path.basename(file)}` });
      }
    }

    for (const match of source.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)) {
      const scriptName = match[1];
      if (scriptName && !scripts.has(scriptName)) {
        issues.push({ file: relativeFile, line: lineNumber(source, match.index ?? 0), message: `unknown package script: npm run ${scriptName}` });
      }
    }
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
