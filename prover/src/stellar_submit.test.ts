import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { simplifyErrorMessage } from "./stellar_submit.js";

describe("simplifyErrorMessage", () => {
  test("maps UnexpectedType simulation failures", () => {
    assert.equal(
      simplifyErrorMessage(new Error("HostError: UnexpectedType: expected u64")),
      "The Soroban contract rejected the settlement payload type during simulation.",
    );
  });

  test("maps invalid zk proof failures", () => {
    assert.equal(
      simplifyErrorMessage(new Error("HostError: invalid zk proof")),
      "The Soroban contract rejected this ZK proof.",
    );
  });

  test("maps MalformedVerifyingKey failures", () => {
    assert.equal(
      simplifyErrorMessage(new Error("HostError: MalformedVerifyingKey")),
      "The on-chain verification key is malformed or does not match this proof.",
    );
  });

  test("returns short unknown errors unchanged", () => {
    assert.equal(simplifyErrorMessage(new Error("some other host failure")), "some other host failure");
  });

  test("truncates errors longer than 360 characters to exactly 363 ending in ...", () => {
    const result = simplifyErrorMessage(new Error("x".repeat(400)));
    assert.equal(result.length, 363);
    assert.equal(result, `${"x".repeat(360)}...`);
    assert.ok(result.endsWith("..."));
  });

  test("leaves a 360-character error untruncated", () => {
    const exact = "y".repeat(360);
    assert.equal(simplifyErrorMessage(new Error(exact)), exact);
  });

  test("stringifies non-Error inputs instead of throwing", () => {
    assert.equal(simplifyErrorMessage(42), "42");
    assert.equal(simplifyErrorMessage(null), "null");
    assert.equal(simplifyErrorMessage(undefined), "undefined");
    assert.equal(
      simplifyErrorMessage({ toString: () => "UnexpectedType" }),
      "The Soroban contract rejected the settlement payload type during simulation.",
    );
  });
});
