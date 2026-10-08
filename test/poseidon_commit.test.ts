import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

// `PoseidonCommit` lives inside `InvoiceRange`, which exposes `commitment` as a
// public input and constrains `commitment === PoseidonCommit(amount, salt)`.
// Testing through the committed `InvoiceRange` artifacts is what pins the
// circuit's Poseidon parameters to the JavaScript `buildPoseidon` implementation
// used by `generateInvoiceProof` and the frontend.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WASM_PATH = path.join(repoRoot, "frontend", "public", "wasm", "invoice_range.wasm");
const ZKEY_PATH = path.join(repoRoot, "frontend", "public", "wasm", "invoice_range_final.zkey");

const LO_BOUND = 10_000n;
const HI_BOUND = 50_000n;
const AMOUNT = 25_000n;
const SALT = 987_654_321n;

type Poseidon = Awaited<ReturnType<typeof buildPoseidon>>;
type VerificationKey = Awaited<ReturnType<typeof snarkjs.zKey.exportVerificationKey>>;

// Mirrors `toCircuitInput` in `prover/src/prepare_signals.ts`: decimal field
// elements, with `commitment` computed the same way as `generateInvoiceProof`.
function toCircuitInput(amount: bigint, salt: bigint, commitment: string) {
  return {
    amount: amount.toString(),
    salt: salt.toString(),
    lo_bound: LO_BOUND.toString(),
    hi_bound: HI_BOUND.toString(),
    commitment,
  };
}

async function runPoseidonCommitTests() {
  console.log("=== PoseidonCommit consistency tests ===\n");

  const poseidon = await buildPoseidon();
  const vKey: VerificationKey = await snarkjs.zKey.exportVerificationKey(ZKEY_PATH);

  const commitment = poseidon.F.toString(poseidon([AMOUNT, SALT]));

  console.log("• A circomlibjs-computed commitment is accepted by the circuit");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    toCircuitInput(AMOUNT, SALT, commitment),
    WASM_PATH,
    ZKEY_PATH,
  );
  assert.deepEqual(
    publicSignals.map(String),
    [LO_BOUND.toString(), HI_BOUND.toString(), commitment],
    "public signals should expose the same commitment",
  );
  assert.equal(await snarkjs.groth16.verify(vKey, publicSignals, proof), true);

  console.log("• A mutated commitment is rejected");
  const mutated = (BigInt(commitment) + 1n).toString();
  await assert.rejects(() =>
    snarkjs.groth16.fullProve(toCircuitInput(AMOUNT, SALT, mutated), WASM_PATH, ZKEY_PATH),
  );

  console.log("• A commitment for a different salt is rejected");
  const wrongSaltCommitment = poseidon.F.toString(poseidon([AMOUNT, SALT + 1n]));
  await assert.rejects(() =>
    snarkjs.groth16.fullProve(toCircuitInput(AMOUNT, SALT, wrongSaltCommitment), WASM_PATH, ZKEY_PATH),
  );

  console.log("\n✅ PoseidonCommit consistency tests passed");
}

runPoseidonCommitTests().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
