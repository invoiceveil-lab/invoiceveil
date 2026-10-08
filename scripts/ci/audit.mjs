#!/usr/bin/env node
// Dependency-vulnerability audit.
//
// Runs `npm audit --json` for the root, `frontend/` and `prover/` workspaces and
// fails when a high or critical advisory is reported for a package that is not
// on the reviewed allowlist (`scripts/ci/audit-allowlist.json`). Dependency-free.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const allowlistPath = path.join(root, "scripts", "ci", "audit-allowlist.json");
const workspaces = [
  { dir: ".", label: "root" },
  { dir: "frontend", label: "frontend" },
  { dir: "prover", label: "prover" },
];

if (!fs.existsSync(allowlistPath)) {
  console.error(`audit: missing allowlist at ${path.relative(root, allowlistPath)}`);
  process.exit(1);
}
const { packages: allowlist = {} } = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));

function runAudit(relDir) {
  const cwd = path.join(root, relDir);
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    // `npm audit` exits non-zero when advisories exist but still prints JSON.
    if (error.stdout) return JSON.parse(error.stdout.toString());
    throw error;
  }
}

const errors = [];
let checked = 0;

for (const { dir, label } of workspaces) {
  const dirPath = path.join(root, dir);
  if (dir !== "." && !fs.existsSync(path.join(dirPath, "package-lock.json"))) {
    console.log(`audit: ${label}/ has no committed package-lock.json — skipping`);
    continue;
  }
  if (!fs.existsSync(dirPath)) {
    console.log(`audit: ${label}/ does not exist — skipping`);
    continue;
  }

  const report = runAudit(dir);
  const vulnerabilities = report.vulnerabilities ?? {};
  for (const [name, info] of Object.entries(vulnerabilities)) {
    if (info.severity !== "high" && info.severity !== "critical") continue;
    checked += 1;
    if (Object.prototype.hasOwnProperty.call(allowlist, name)) continue;
    const advisories = (info.via ?? [])
      .filter((via) => typeof via === "object")
      .map((via) => via.title ?? via.url)
      .filter(Boolean);
    errors.push(
      `${label}: ${info.severity} advisory for "${name}" is not allowlisted${advisories.length ? `: ${advisories.join("; ")}` : ""}`,
    );
  }
  console.log(`audit: ${label}: scanned (${Object.keys(vulnerabilities).length} advisories reported)`);
}

if (errors.length > 0) {
  console.error(`\naudit: ${errors.length} unallowlisted high/critical advisory group(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\nFix the dependency, or add a reviewed entry to scripts/ci/audit-allowlist.json.");
  process.exit(1);
}

console.log(`\naudit: OK — ${checked} high/critical advisory group(s) checked against the reviewed allowlist.`);
