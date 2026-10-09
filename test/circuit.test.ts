import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

// `npm run test:circuit` runs from the repository root, but resolve the
// committed Groth16 artifacts relative to this file so the suite is
// location-stable. These are the same artifacts `generateInvoiceProof`
// ships to the frontend, so the test exercises what actually proves.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WASM_PATH = path.join(repoRoot, "frontend", "public", "wasm", "invoice_range.wasm");
const ZKEY_PATH = path.join(repoRoot, "frontend", "public", "wasm", "invoice_range_final.zkey");

const LO_BOUND = 10_000n;
const HI_BOUND = 50_000n;
const SALT = 12_345_678_901_234_567_890n;

type Poseidon = Awaited<ReturnType<typeof buildPoseidon>>;

function commitmentFor(poseidon: Poseidon, amount: bigint, salt: bigint): string {
  // Same field encoding as `generateInvoiceProof`/`toCircuitInput`: the
  // Poseidon hash over the two signals, as a decimal field element.
  return poseidon.F.toString(poseidon([amount, salt]));
}

async function prove(poseidon: Poseidon, amount: bigint, salt: bigint, commitment: string) {
  const input = {
    amount: amount.toString(),
    salt: salt.toString(),
    lo_bound: LO_BOUND.toString(),
    hi_bound: HI_BOUND.toString(),
    commitment,
  };
  return snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
}

async function runCircuitTests() {
  console.log("=== InvoiceRange circuit ===\n");

  const poseidon = await buildPoseidon();
  const vKey = await snarkjs.zKey.exportVerificationKey(ZKEY_PATH);

  const amount = 25_000n;
  const commitment = commitmentFor(poseidon, amount, SALT);

  console.log("• An in-range (amount, salt, lo, hi, commitment) proves and verifies");
  const { proof, publicSignals } = await prove(poseidon, amount, SALT, commitment);
  assert.deepEqual(
    publicSignals.map(String),
    [LO_BOUND.toString(), HI_BOUND.toString(), commitment],
    "public signals should be [lo_bound, hi_bound, commitment]",
  );
  assert.equal(await snarkjs.groth16.verify(vKey, publicSignals, proof), true);

  console.log("• An out-of-range amount is rejected during witness generation");
  const badAmount = HI_BOUND + 1n;
  const badCommitment = commitmentFor(poseidon, badAmount, SALT);
  await assert.rejects(() => prove(poseidon, badAmount, SALT, badCommitment));

  console.log("\n✅ InvoiceRange circuit tests passed");
}

runCircuitTests().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
