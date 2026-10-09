#!/usr/bin/env node
// Docs-drift check.
//
// Every `npm run <script>` / `npm --prefix <dir> run <script>` and recognised
// `cargo <subcommand>` shown in README.md must resolve to a script or command
// that actually exists in the manifest it targets. Dependency-free: uses only
// Node's fs and path modules.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/** Documented prefix directories and the manifest that backs them. */
const manifests = {
  ".": "package.json",
  frontend: "frontend/package.json",
  prover: "prover/package.json",
};

/** Cargo subcommands that are always available from the toolchain. */
const cargoAlwaysAvailable = new Set([
  "build",
  "check",
  "clean",
  "doc",
  "fmt",
  "test",
  "clippy",
  "metadata",
  "audit",
  "install",
  "run",
  "update",
]);

function loadScripts(relManifest) {
  const full = path.join(root, relManifest);
  if (!fs.existsSync(full)) return null;
  const pkg = JSON.parse(fs.readFileSync(full, "utf8"));
  return pkg.scripts ?? {};
}

const readmePath = path.join(root, "README.md");
if (!fs.existsSync(readmePath)) {
  console.error("docs-drift: README.md is missing");
  process.exit(1);
}
const readme = fs.readFileSync(readmePath, "utf8");

// Collect every fenced code block; commands live in shell blocks.
const blocks = [...readme.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
const lines = blocks.flatMap((block) => block.split("\n"));

const errors = [];
let checked = 0;

function checkScript(displayDir, script, where) {
  const relManifest = manifests[displayDir];
  if (!relManifest) {
    errors.push(`README documents \`npm --prefix ${displayDir} run ${script}\` but no manifest is registered for "${displayDir}" (${where})`);
    return;
  }
  const scripts = loadScripts(relManifest);
  if (!scripts) {
    errors.push(`README documents \`${script}\` but ${relManifest} does not exist (${where})`);
    return;
  }
  checked += 1;
  if (!Object.prototype.hasOwnProperty.call(scripts, script)) {
    errors.push(`README documents \`npm ${displayDir === "." ? "" : `--prefix ${displayDir} `}run ${script}\` but ${relManifest} has no "${script}" script (${where})`);
  }
}

for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;

  // npm --prefix <dir> run <script>
  for (const m of line.matchAll(/npm\s+--prefix\s+(\S+)\s+run\s+([^\s&;|]+)/g)) {
    checkScript(m[1].replace(/\/+$/, ""), m[2], line);
  }

  // npm run <script> (root)
  for (const m of line.matchAll(/(?:^|[;&|]\s*)npm\s+run\s+([^\s&;|]+)/g)) {
    checkScript(".", m[1], line);
  }

  // cargo <subcommand>
  for (const m of line.matchAll(/(?:^|[;&|]\s*)cargo\s+([a-z-]+)/g)) {
    const sub = m[1];
    if (!cargoAlwaysAvailable.has(sub)) {
      errors.push(`README documents \`cargo ${sub}\` but that is not a recognised cargo subcommand (${line})`);
    } else {
      checked += 1;
    }
  }
}

if (errors.length > 0) {
  console.error(`docs-drift: ${errors.length} README command(s) do not resolve:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`docs-drift: OK — ${checked} documented command(s) resolve to real scripts.`);
