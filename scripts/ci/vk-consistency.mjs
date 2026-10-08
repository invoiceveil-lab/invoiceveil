#!/usr/bin/env node
// Verification-key consistency check.
//
// The committed `keys/verification_key.json`, the committed circuit source and
// the contract's IC-length guard must agree on the public-signal count. A
// mismatch makes every otherwise-valid proof fail on-chain with
// "invalid zk proof". Dependency-free.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const vkPath = "keys/verification_key.json";
const circuitPath = "circuits/invoice_range.circom";
const verifierPath = "contract/src/verifier.rs";
const wasmPath = "frontend/public/wasm/invoice_range.wasm";
const expectedPublicSignals = 3;

const errors = [];
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const vk = JSON.parse(read(vkPath));

if (vk.protocol !== "groth16") {
  errors.push(`${vkPath}: expected protocol "groth16", found ${JSON.stringify(vk.protocol)}`);
}
if (vk.nPublic !== expectedPublicSignals) {
  errors.push(`${vkPath}: expected nPublic === ${expectedPublicSignals}, found ${vk.nPublic}`);
}
if (!Array.isArray(vk.IC)) {
  errors.push(`${vkPath}: IC must be an array`);
} else if (vk.IC.length !== vk.nPublic + 1) {
  errors.push(`${vkPath}: IC length ${vk.IC.length} !== nPublic + 1 (${vk.nPublic + 1})`);
}

// The circuit's `main` component declares the public signals; the committed VK
// must describe exactly that many.
const circuit = read(circuitPath);
const mainMatch = circuit.match(/component\s+main\s*\{[^}]*public\s*\[([^\]]*)\]/);
if (!mainMatch) {
  errors.push(`${circuitPath}: could not find a "component main { public [...] }" declaration`);
} else {
  const publics = mainMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (publics.length !== vk.nPublic) {
    errors.push(
      `${circuitPath}: declares ${publics.length} public signal(s) (${publics.join(", ")}) but ${vkPath} has nPublic === ${vk.nPublic}`,
    );
  }
}

// The contract rejects a VK whose IC does not match inputs.len() + 1.
const verifier = read(verifierPath);
if (!/inputs\.len\(\)\s*\+\s*1\s*!=\s*vk\.ic\.len\(\)/.test(verifier)) {
  errors.push(`${verifierPath}: expected the "inputs.len() + 1 != vk.ic.len()" consistency guard`);
}

if (!fs.existsSync(path.join(root, wasmPath))) {
  errors.push(`${wasmPath}: committed circuit wasm is missing`);
}

if (errors.length > 0) {
  console.error(`vk-consistency: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `vk-consistency: OK — nPublic=${vk.nPublic}, IC length=${vk.IC.length}, committed VK matches ${circuitPath}.`,
);
