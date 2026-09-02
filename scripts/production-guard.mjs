import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
const root = process.cwd();
const roots = [join(root, "src", "app"), join(root, "src", "backend")];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
// Paths that are allowed to contain stubs/nondeterminism: test suites, seed
// data, test utilities and the guard's own tooling.
const excludedPatterns = [
  /(?:^|[\\/])seed\.ts$/,
  /(?:^|[\\/])test-utils[\\/]/,
  /\.(?:test|spec|vitest)\.[cm]?[jt]sx?$/,
  /(?:^|[\\/])scripts[\\/]/,
];
const checks = [
  ["mock-data import", /(?:from\s+|import\s*\()["'][^"']*mock-data["']/g],
  ["randomized runtime behavior", /\bMath\.random\s*\(/g],
  ["simulated provider outcome", /\bsimulate(?:d)?(?:Outcome|Success|Response)\b/gi],
  ["fake provider identifier", /[`"']dev-(?:\$\{|[a-z0-9])/gi],
  ["mock/fake mode", /(?:mock|fake)[ -]mode/gi],
  ["unverified fake-success response", /success\s*:\s*true[^\n]{0,160}(?:connected successfully|simulated|mock)/gi],
];
async function walk(dir) {
  const groups = await Promise.all((await readdir(dir, { withFileTypes: true })).map(async (e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return walk(path);
    const rel = relative(root, path);
    if (excludedPatterns.some((pattern) => pattern.test(rel))) return [];
    return extensions.has(extname(e.name)) && !/\.(?:test|spec|vitest)\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  }));
  return groups.flat();
}
const files = (await Promise.all(roots.map(walk))).flat();
const violations = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const [description, pattern] of checks) for (const match of source.matchAll(pattern)) {
    violations.push(`${relative(root, file)}:${source.slice(0, match.index).split(/\r?\n/).length} ${description}: ${JSON.stringify(match[0])}`);
  }
}
if (violations.length) {
  console.error(`Production guard rejected stubs or nondeterministic behavior:\n\n${violations.map((v) => `- ${v}`).join("\n")}`);
  process.exitCode = 1;
} else console.log(`Production guard passed (${files.length} source files scanned).`);
