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
