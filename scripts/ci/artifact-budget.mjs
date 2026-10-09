#!/usr/bin/env node
// Proved-artifact size regression check.
//
// The browser ships `invoice_range.wasm` and `invoice_range_final.zkey`; a
// circuit change can silently inflate the payload. Fail when either committed
// artifact grows more than the configured budget over its recorded baseline.
// Dependency-free.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// Baseline byte sizes recorded from the committed artifacts, with a 10% budget.
const BUDGET = 1.1;
const artifacts = [
  { path: "frontend/public/wasm/invoice_range.wasm", baseline: 1_753_957 },
  { path: "frontend/public/wasm/invoice_range_final.zkey", baseline: 344_400 },
];

const rows = [];
const errors = [];

for (const artifact of artifacts) {
  const full = path.join(root, artifact.path);
  if (!fs.existsSync(full)) {
    errors.push(`${artifact.path}: committed artifact is missing`);
    continue;
  }
  const size = fs.statSync(full).size;
  const limit = Math.floor(artifact.baseline * BUDGET);
  const delta = size - artifact.baseline;
  const ok = size <= limit;
  rows.push(
    `| \`${artifact.path}\` | ${size.toLocaleString("en-US")} | ${limit.toLocaleString("en-US")} | ${delta >= 0 ? "+" : ""}${delta.toLocaleString("en-US")} | ${ok ? "pass" : "FAIL"} |`,
  );
  if (!ok) {
    errors.push(
      `${artifact.path}: ${size} bytes exceeds the ${limit}-byte budget (baseline ${artifact.baseline}, +${delta})`,
    );
  }
}

console.log("### Proved-artifact size budget\n");
console.log("| Artifact | Bytes | Budget (baseline + 10%) | Δ vs baseline | Result |");
console.log("| --- | --- | --- | --- | --- |");
for (const row of rows) console.log(row);

if (errors.length > 0) {
  console.error(`\nartifacts: ${errors.length} artifact(s) over budget:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`\nartifacts: OK — ${rows.length} artifact(s) within budget.`);
