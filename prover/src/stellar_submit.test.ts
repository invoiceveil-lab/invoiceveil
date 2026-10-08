import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as StellarSdk from "@stellar/stellar-sdk";

import { settleInvoiceArgs } from "./stellar_submit.js";

const CONTRACT_ID = "CALOHKUYNCYIPPICYZMDALGKV2V7QHADOXZGH3MIQQ5CR2WTD45OC5VI";
// Deterministic StrKey account (Keypair.fromRawEd25519Seed of 0x01); no network.
const PAYER = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";

const hex32 = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;

const snarkProof = {
  pi_a: [hex32(0x01), hex32(0x02)],
  pi_b: [
    [hex32(0x11), hex32(0x22)],
    [hex32(0x33), hex32(0x44)],
  ],
  pi_c: [hex32(0x03), hex32(0x04)],
};

const signals = { commitment: hex32(0xab), lo_bound: "10000", hi_bound: "50000" };
const rawPublicSignals = ["10000", "50000", signals.commitment];

function decodeSettleInvoiceArgs(): StellarSdk.xdr.ScVal[] {
  const contract = new StellarSdk.Contract(CONTRACT_ID);
  const operation = contract.call(
    "settle_invoice",
    ...settleInvoiceArgs(PAYER, 7n, snarkProof, signals, rawPublicSignals),
  );
  const decoded = StellarSdk.xdr.Operation.fromXDR(operation.toXDR());
  return decoded.body().invokeHostFunctionOp().hostFunction().invokeContract().args();
}

function entryMap(scv: StellarSdk.xdr.ScVal): Map<string, StellarSdk.xdr.ScVal> {
  const entries = scv.map() ?? [];
  return new Map(entries.map((entry) => [entry.key().sym()!.toString(), entry.val()]));
}

describe("settle_invoice ScVal encoding", () => {
  test("encodes the contract arguments in order", () => {
    const args = decodeSettleInvoiceArgs();
    // The contract signature is (payer, id, proof, signals, verifier_inputs).
    assert.equal(args.length, 5);
    assert.deepEqual(
      args.map((arg) => arg.switch().name),
      ["scvAddress", "scvU64", "scvMap", "scvMap", "scvMap"],
    );
    assert.deepEqual(StellarSdk.scValToNative(args[0]), PAYER);
    assert.deepEqual(StellarSdk.scValToNative(args[1]), 7n);
  });

  test("encodes the proof as an a/b/c map with the Soroban G2 byte order", () => {
    const proof = entryMap(decodeSettleInvoiceArgs()[2]);
    assert.deepEqual([...proof.keys()].sort(), ["a", "b", "c"]);
    assert.equal(proof.get("a")!.switch().name, "scvBytes");
    assert.equal(proof.get("a")!.bytes()!.length, 64);
    assert.equal(proof.get("c")!.bytes()!.length, 64);
    assert.equal(proof.get("b")!.bytes()!.length, 128);

    // Each Fp2 coordinate is c1 || c0: byte 0 is pi_b[0][1], not pi_b[0][0].
    const b = Buffer.from(proof.get("b")!.bytes()!);
    assert.equal(b[0], 0x22);
    assert.equal(b[32], 0x11);
    assert.equal(b[64], 0x44);
    assert.equal(b[96], 0x33);
  });

  test("encodes the signals map with exactly the contract's field set", () => {
    const signalsScv = entryMap(decodeSettleInvoiceArgs()[3]);
    // A missing or extra field would change this sorted key set.
    assert.deepEqual([...signalsScv.keys()].sort(), ["commitment", "hi_bound", "lo_bound"]);

    assert.equal(signalsScv.get("lo_bound")!.switch().name, "scvU64");
    assert.equal(signalsScv.get("hi_bound")!.switch().name, "scvU64");
    assert.deepEqual(StellarSdk.scValToNative(signalsScv.get("lo_bound")!), 10000n);
    assert.deepEqual(StellarSdk.scValToNative(signalsScv.get("hi_bound")!), 50000n);

    const commitment = signalsScv.get("commitment")!;
    assert.equal(commitment.switch().name, "scvBytes");
    assert.equal(Buffer.from(commitment.bytes()!).toString("hex"), "ab".repeat(32));
  });

  test("encodes verifier inputs as a u256 field-element vector", () => {
    const verifier = entryMap(decodeSettleInvoiceArgs()[4]);
    assert.deepEqual([...verifier.keys()], ["inputs"]);

    const inputs = verifier.get("inputs")!;
    assert.equal(inputs.switch().name, "scvVec");
    const elements = inputs.vec() ?? [];
    assert.equal(elements.length, 3);
    for (const element of elements) {
      // A regression to i128/i64 would change this switch away from scvU256.
      assert.equal(element.switch().name, "scvU256");
    }
    assert.deepEqual(
      elements.map((element) => StellarSdk.scValToNative(element)),
      [10000n, 50000n, BigInt(signals.commitment)],
    );
  });
});
