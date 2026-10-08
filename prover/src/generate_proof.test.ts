import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { generateInvoiceProof, validateInvoiceInput } from "./generate_proof.js";

describe("validateInvoiceInput", () => {
  test("rejects loBound > hiBound with the exact message", () => {
    assert.throws(() => validateInvoiceInput({ amount: 20n, loBound: 30n, hiBound: 10n }), {
      message: "Lower bound cannot be greater than upper bound.",
    });
  });

  test("rejects an amount below the lower bound", () => {
    assert.throws(() => validateInvoiceInput({ amount: 9999n, loBound: 10000n, hiBound: 50000n }), {
      message: "Invoice amount is outside the agreed contract bounds.",
    });
  });

  test("rejects an amount above the upper bound", () => {
    assert.throws(() => validateInvoiceInput({ amount: 50001n, loBound: 10000n, hiBound: 50000n }), {
      message: "Invoice amount is outside the agreed contract bounds.",
    });
  });

  test("accepts the inclusive boundaries", () => {
    assert.doesNotThrow(() => validateInvoiceInput({ amount: 10000n, loBound: 10000n, hiBound: 50000n }));
    assert.doesNotThrow(() => validateInvoiceInput({ amount: 50000n, loBound: 10000n, hiBound: 50000n }));
    assert.doesNotThrow(() => validateInvoiceInput({ amount: 10000n, loBound: 10000n, hiBound: 10000n }));
  });
});

describe("generateInvoiceProof guards", () => {
  test("rejects out-of-range input before the prover runs", async () => {
    await assert.rejects(
      generateInvoiceProof({ amount: 9999n, loBound: 10000n, hiBound: 50000n }),
      { message: "Invoice amount is outside the agreed contract bounds." },
    );
  });

  test("rejects inverted bounds before the prover runs", async () => {
    await assert.rejects(
      generateInvoiceProof({ amount: 20n, loBound: 30n, hiBound: 10n }),
      { message: "Lower bound cannot be greater than upper bound." },
    );
  });

  test("rejected input never reaches the SnarkJS prover", async () => {
    const error = await generateInvoiceProof({ amount: 9999n, loBound: 10000n, hiBound: 50000n }).then(
      () => null,
      (reason: unknown) => reason as Error,
    );
    assert.ok(error);
    assert.equal(error.message, "Invoice amount is outside the agreed contract bounds.");
    // fullProve failures are wrapped as "Proof generation failed: ...", so an
    // unwrapped guard message proves the prover was never invoked.
    assert.equal(error.message.startsWith("Proof generation failed"), false);
  });
});
