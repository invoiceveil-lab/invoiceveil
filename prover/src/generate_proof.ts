import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";

import { InvoiceInput, toCircuitInput } from "./prepare_signals.js";
import { normalizePublicSignals } from "./format_for_contract.js";

type SnarkProof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
};

export interface InvoiceProof {
  proof: SnarkProof;
  publicSignals: {
    commitment: string;
    lo_bound: string;
    hi_bound: string;
  };
  rawPublicSignals: string[];
  salt: bigint;
}

async function resolveProverArtifacts(): Promise<{ wasmPath: string; zkeyPath: string }> {
  const isBrowserRuntime =
    typeof window !== "undefined" || typeof process === "undefined" || typeof process.cwd !== "function";

  if (isBrowserRuntime) {
    return {
      wasmPath: "/wasm/invoice_range.wasm",
      zkeyPath: "/wasm/invoice_range_final.zkey",
    };
  }

  const path = await import("node:path");
  const fs = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  const buildWasmPath = path.resolve(rootDir, "circuits", "build", "invoice_range_js", "invoice_range.wasm");
  const buildZkeyPath = path.resolve(rootDir, "keys", "invoice_range_final.zkey");
  const committedWasmPath = path.resolve(rootDir, "frontend", "public", "wasm", "invoice_range.wasm");
  const committedZkeyPath = path.resolve(rootDir, "frontend", "public", "wasm", "invoice_range_final.zkey");

  // `circuits/build/` and `keys/*.zkey` are gitignored, so a fresh clone only
  // ships the committed copies under frontend/public/wasm. Prefer the locally
  // built artifacts when present and otherwise fall back to the committed ones
  // so the Node e2e harness runs without a trusted setup.
  const wasmPath = fs.existsSync(buildWasmPath) ? buildWasmPath : committedWasmPath;
  const zkeyPath = fs.existsSync(buildZkeyPath) ? buildZkeyPath : committedZkeyPath;

  if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
    throw new Error(
      "Missing prover artifacts. Expected circuits/build/invoice_range_js/invoice_range.wasm and " +
        "keys/invoice_range_final.zkey, or the committed copies in frontend/public/wasm. " +
        "Run scripts/01_compile_circuit.sh and scripts/02_trusted_setup.sh to build them.",
    );
  }

  return { wasmPath, zkeyPath };
}

function randomSalt(): bigint {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(31));
  return BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
}

export async function generateInvoiceProof(input: InvoiceInput): Promise<InvoiceProof> {
  if (input.loBound > input.hiBound) {
    throw new Error("Lower bound cannot be greater than upper bound.");
  }

  if (input.amount < input.loBound || input.amount > input.hiBound) {
    throw new Error("Invoice amount is outside the agreed contract bounds.");
  }

  const salt = randomSalt();
  const poseidon = await buildPoseidon();
  const commitment = poseidon.F.toString(poseidon([input.amount, salt]));

  const circuitInput = toCircuitInput(input, salt, commitment);
  const { wasmPath, zkeyPath } = await resolveProverArtifacts();
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      wasmPath,
      zkeyPath,
    );

    return {
      proof,
      publicSignals: normalizePublicSignals(publicSignals),
      rawPublicSignals: publicSignals,
      salt,
    };
  } catch (error) {
    throw new Error(
      `Proof generation failed: ${error instanceof Error ? error.message : "unknown SnarkJS error"}`,
    );
  }
}
