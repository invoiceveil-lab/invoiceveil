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
    // Vite injects BASE_URL for the configured `base`, so the prover artifacts
    // still resolve when the app is served from a sub-path.
    const baseUrl = import.meta.env?.BASE_URL ?? "/";
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

    return {
      wasmPath: `${normalizedBase}wasm/invoice_range.wasm`,
      zkeyPath: `${normalizedBase}wasm/invoice_range_final.zkey`,
    };
  }

  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  return {
    wasmPath: path.resolve(rootDir, "circuits", "build", "invoice_range_js", "invoice_range.wasm"),
    zkeyPath: path.resolve(rootDir, "keys", "invoice_range_final.zkey"),
  };
}

function randomSalt(): bigint {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(31));
  return BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
}

export function validateInvoiceInput(input: InvoiceInput): void {
  if (input.loBound > input.hiBound) {
    throw new Error("Lower bound cannot be greater than upper bound.");
  }

  if (input.amount < input.loBound || input.amount > input.hiBound) {
    throw new Error("Invoice amount is outside the agreed contract bounds.");
  }
}

export async function generateInvoiceProof(input: InvoiceInput): Promise<InvoiceProof> {
  validateInvoiceInput(input);

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
