import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { toCircuitInput, type CircuitInput } from "./prepare_signals.js";

describe("toCircuitInput", () => {
  test("returns exactly the circuit signal keys", () => {
    const result = toCircuitInput({ amount: 25000n, loBound: 10000n, hiBound: 50000n }, 42n, "0xdead");
    assert.deepEqual(result, {
      amount: "25000",
      salt: "42",
      lo_bound: "10000",
      hi_bound: "50000",
      commitment: "0xdead",
    });
    // The key set must match circuits/invoice_range.circom; a rename on either
    // side of the boundary breaks proving silently.
    assert.deepEqual(Object.keys(result), ["amount", "salt", "lo_bound", "hi_bound", "commitment"]);
  });

  test("serializes every numeric field as a decimal string", () => {
    const result: CircuitInput = toCircuitInput({ amount: 7n, loBound: 0n, hiBound: 9n }, 0n, "0x0");
    for (const value of Object.values(result)) {
      assert.equal(typeof value, "string");
    }
    assert.equal(result.amount, "7");
    assert.equal(result.lo_bound, "0");
    assert.equal(result.salt, "0");
    // A leaked bigint would surface as "7n"; the payload must be pure strings.
    assert.equal(JSON.stringify(result).includes('n"'), false);
  });

  test("passes the commitment through unchanged", () => {
    const commitment = "0x0123456789abcdef";
    assert.equal(toCircuitInput({ amount: 1n, loBound: 0n, hiBound: 2n }, 3n, commitment).commitment, commitment);
  });
});
