import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

// `circuits/invoice_range.circom` instantiates `RangeCheck(64)` with these
// bounds and wires them as public inputs, so the committed artifacts exercise
// the 64-bit `LessEqThan` comparators directly.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WASM_PATH = path.join(repoRoot, "frontend", "public", "wasm", "invoice_range.wasm");
const ZKEY_PATH = path.join(repoRoot, "frontend", "public", "wasm", "invoice_range_final.zkey");

const LO_BOUND = 10_000n;
const HI_BOUND = 50_000n;
const SALT = 42n;

type Poseidon = Awaited<ReturnType<typeof buildPoseidon>>;
type VerificationKey = Awaited<ReturnType<typeof snarkjs.zKey.exportVerificationKey>>;

function commitmentFor(poseidon: Poseidon, amount: bigint, salt: bigint): string {
  return poseidon.F.toString(poseidon([amount, salt]));
}

async function prove(poseidon: Poseidon, amount: bigint, commitment: string) {
  const input = {
    amount: amount.toString(),
    salt: SALT.toString(),
    lo_bound: LO_BOUND.toString(),
    hi_bound: HI_BOUND.toString(),
    commitment,
  };
  return snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
}

async function expectAccepted(poseidon: Poseidon, vKey: VerificationKey, amount: bigint, label: string) {
  const commitment = commitmentFor(poseidon, amount, SALT);
  const { proof, publicSignals } = await prove(poseidon, amount, commitment);
  assert.deepEqual(
    publicSignals.map(String),
    [LO_BOUND.toString(), HI_BOUND.toString(), commitment],
    `${label}: public signals`,
  );
  assert.equal(await snarkjs.groth16.verify(vKey, publicSignals, proof), true, `${label}: proof verifies`);
  console.log(`✓ accepted: ${label} (amount=${amount})`);
}

async function expectRejected(poseidon: Poseidon, amount: bigint, label: string) {
  const commitment = commitmentFor(poseidon, amount, SALT);
  await assert.rejects(
    () => prove(poseidon, amount, commitment),
    `${label}: comparator should reject the witness`,
  );
  console.log(`✓ rejected: ${label} (amount=${amount})`);
}

async function runRangeCheckTests() {
  console.log("=== RangeCheck(64) boundary tests ===\n");

  const poseidon = await buildPoseidon();
  const vKey = await snarkjs.zKey.exportVerificationKey(ZKEY_PATH);

  // Inclusive boundaries: lo <= amount <= hi must hold.
  await expectAccepted(poseidon, vKey, LO_BOUND, "amount == lo_bound");
  await expectAccepted(poseidon, vKey, HI_BOUND, "amount == hi_bound");

  // Exclusive boundaries: one below lo and one above hi must be rejected.
  await expectRejected(poseidon, LO_BOUND - 1n, "amount == lo_bound - 1");
  await expectRejected(poseidon, HI_BOUND + 1n, "amount == hi_bound + 1");

  console.log("\n✅ RangeCheck boundary tests passed");
}

runRangeCheckTests().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
