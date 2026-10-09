#!/usr/bin/env node
// No stray `console.*` in shipped source.
//
// `frontend/src` runs in the user's browser and `prover/src` runs inside a Web
// Worker; a leftover debug log leaks UI state and pollutes the worker console.
// Logging stays allowed in the `test/` and `scripts/` harnesses and in files
// whose name ends in `_fixture` (e.g. `generate_test_fixture.ts`).
// Dependency-free: this is the equivalent of an ESLint `no-console: error` gate
// without adding a linter dependency.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const shippedDirs = ["frontend/src", "prover/src"];
const consoleCall = /console\s*\.\s*(log|debug|info|trace|warn|error)\s*\(/g;

function walk(dir, out = []) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(child);
  }
  return out;
}

const errors = [];
let scanned = 0;

for (const dir of shippedDirs) {
  for (const rel of walk(dir)) {
    const base = path.basename(rel);
    if (/_fixture\.[cm]?[jt]sx?$/.test(base)) continue; // harness fixture, allowed
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) continue; // tests, allowed
    scanned += 1;
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(consoleCall)) {
        errors.push(`${rel}:${index + 1}: stray \`${match[0].replace(/\s+/g, "")}\` in shipped source`);
      }
    });
  }
}

if (errors.length > 0) {
  console.error(`no-console: ${errors.length} stray console statement(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`no-console: OK — ${scanned} shipped source file(s) scanned.`);
