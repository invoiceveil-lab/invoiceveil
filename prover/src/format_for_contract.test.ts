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
