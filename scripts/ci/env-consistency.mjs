#!/usr/bin/env node
// .env.example / code consistency check.
//
// The documented `VITE_*` keys in both `.env.example` files, the `ImportMetaEnv`
// declaration in `prover/src/shims.d.ts`, and the `import.meta.env.VITE_*` reads
// in the shipped source must all describe the same set of keys. Dependency-free.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envFiles = [".env.example", "frontend/.env.example"];
const declaredFile = "prover/src/shims.d.ts";
const sourceDirs = ["frontend/src", "prover/src"];

const VITE_KEY = /\bVITE_[A-Z0-9_]+\b/g;

function collectEnvFileKeys(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    console.error(`env-consistency: ${rel} is missing`);
    process.exit(1);
  }
  const keys = new Set();
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const m = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

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

// Documented keys.
const documented = new Set();
for (const rel of envFiles) {
  for (const key of collectEnvFileKeys(rel)) documented.add(key);
}

// Declared keys (ImportMetaEnv).
const declared = new Set(
  [...fs.readFileSync(path.join(root, declaredFile), "utf8").matchAll(VITE_KEY)].map((m) => m[0]),
);

// Keys actually read in shipped source.
const read = new Set();
for (const rel of sourceDirs) {
  for (const file of walk(rel)) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    for (const m of src.matchAll(/import\.meta\.env\??\.(VITE_[A-Z0-9_]+)/g)) read.add(m[1]);
  }
}

const errors = [];
const sorted = (s) => [...s].sort();

for (const key of sorted(documented)) {
  if (!read.has(key)) errors.push(`documented in .env.example but never read in code: ${key}`);
}
for (const key of sorted(read)) {
  if (!documented.has(key)) errors.push(`read in code (import.meta.env) but not documented in .env.example: ${key}`);
}
for (const key of sorted(declared)) {
  if (!documented.has(key)) errors.push(`declared in ${declaredFile} but not documented in .env.example: ${key}`);
}
for (const key of sorted(documented)) {
  if (!declared.has(key)) errors.push(`documented in .env.example but not declared in ${declaredFile}: ${key}`);
}

if (errors.length > 0) {
  console.error(`env-consistency: ${errors.length} mismatch(es):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`env-consistency: OK — ${sorted(documented).join(", ")} documented, declared and read.`);
