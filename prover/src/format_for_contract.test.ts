import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ContractProof } from "../../shared/types.js";
import { formatProofForContract } from "./format_for_contract.js";

const snarkProof = {
  pi_a: ["0x1", "0x2", "0x3"],
  pi_b: [
    ["0x11", "0x22"],
    ["0x33", "0x44"],
  ],
  pi_c: ["0x4", "0x5", "0x6"],
};

describe("formatProofForContract", () => {
  test("produces the ContractProof shape with all six coordinates", () => {
    const result: ContractProof = formatProofForContract(snarkProof);
    assert.deepEqual(Object.keys(result).sort(), ["a", "b", "c"]);
    assert.deepEqual(result.a, { x: "0x1", y: "0x2" });
    assert.deepEqual(result.c, { x: "0x4", y: "0x5" });
    assert.deepEqual(Object.keys(result.b).sort(), ["x", "y"]);
    assert.equal(result.a.x, snarkProof.pi_a[0]);
    assert.equal(result.a.y, snarkProof.pi_a[1]);
    assert.equal(result.c.x, snarkProof.pi_c[0]);
    assert.equal(result.c.y, snarkProof.pi_c[1]);
  });

  test("swaps each G2 coordinate positionally (c1 || c0)", () => {
    const result = formatProofForContract(snarkProof);
    assert.deepEqual(result.b.x, ["0x22", "0x11"]);
    assert.deepEqual(result.b.y, ["0x44", "0x33"]);
    assert.equal(result.b.x[0], snarkProof.pi_b[0][1]);
    assert.equal(result.b.x[1], snarkProof.pi_b[0][0]);
    assert.equal(result.b.y[0], snarkProof.pi_b[1][1]);
    assert.equal(result.b.y[1], snarkProof.pi_b[1][0]);
  });
});
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatVerifierInputs, normalizePublicSignals } from "./format_for_contract.js";

// The circuit declares `component main { public [lo_bound, hi_bound, commitment] }`,
// so SnarkJS emits publicSignals in exactly that order.
describe("normalizePublicSignals", () => {
  test("maps the circuit-declared order onto named fields", () => {
    const result = normalizePublicSignals(["1000", "5000", "0xabc"]);
    assert.deepEqual(result, { commitment: "0xabc", lo_bound: "1000", hi_bound: "5000" });
    assert.equal(result.lo_bound, "1000");
    assert.equal(result.hi_bound, "5000");
    assert.equal(result.commitment, "0xabc");
  });

  test("fails if any two public signals are swapped", () => {
    const ordered = normalizePublicSignals(["1000", "5000", "0xabc"]);
    const swapped = normalizePublicSignals(["5000", "1000", "0xabc"]);
    assert.notDeepEqual(ordered, swapped);
    assert.equal(swapped.lo_bound, "5000");
    assert.equal(swapped.hi_bound, "1000");
  });
});

describe("formatVerifierInputs", () => {
  test("returns the raw array unchanged and in order", () => {
    const raw = ["1000", "5000", "0xabc"];
    assert.deepEqual(formatVerifierInputs(raw).inputs, raw);
  });

  test("preserves the caller's order and does not alias the input array", () => {
    const raw = ["5000", "1000", "0xabc"];
    const out = formatVerifierInputs(raw);
    assert.deepEqual(out.inputs, raw);
    out.inputs.push("extra");
    assert.deepEqual(raw, ["5000", "1000", "0xabc"]);
  });
});
