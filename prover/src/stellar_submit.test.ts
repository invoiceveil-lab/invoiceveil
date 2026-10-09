import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type * as StellarSdk from "@stellar/stellar-sdk";

import { waitForTransaction } from "./stellar_submit.js";

type TxStatus = "NOT_FOUND" | "SUCCESS" | "FAILED";

function stubServer(statuses: TxStatus[]): { server: StellarSdk.rpc.Server; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const server = {
    async getTransaction(hash: string) {
      calls.push(hash);
      const status = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return { status };
    },
  } as unknown as StellarSdk.rpc.Server;
  return { server, calls };
}

const HASH = "abc123hash";

describe("waitForTransaction", () => {
  test("resolves once the transaction succeeds", async () => {
    const { server, calls } = stubServer(["NOT_FOUND", "SUCCESS"]);
    const receipt = await waitForTransaction(server, HASH, { delayMs: 0 });
    assert.equal(receipt.status, "SUCCESS");
    assert.deepEqual(calls, [HASH, HASH]);
  });

  test("throws a FAILED error that includes the transaction hash", async () => {
    const { server, calls } = stubServer(["FAILED"]);
    await assert.rejects(waitForTransaction(server, HASH, { delayMs: 0 }), {
      message: `Soroban transaction failed on-chain for hash ${HASH}.`,
    });
    assert.deepEqual(calls, [HASH]);
  });

  test("polls exactly 25 times before timing out", async () => {
    const { server, calls } = stubServer(["NOT_FOUND"]);
    await assert.rejects(waitForTransaction(server, HASH, { delayMs: 0 }), {
      message: `Timed out waiting for Soroban confirmation for transaction ${HASH}.`,
    });
    // Pins the retry budget: an off-by-one would change this count.
    assert.equal(calls.length, 25);
    assert.ok(calls.every((hash) => hash === HASH));
  });
});
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { coerceStatus, mapInvoiceRecord } from "./stellar_submit.js";

const ZERO_COMMITMENT = `0x${"0".repeat(64)}`;

describe("coerceStatus", () => {
  test("passes through canonical status strings", () => {
    assert.equal(coerceStatus("Pending"), "Pending");
    assert.equal(coerceStatus("Settled"), "Settled");
    assert.equal(coerceStatus("Cancelled"), "Cancelled");
  });

  test("maps both the Cancelled and canceled spellings", () => {
    assert.equal(coerceStatus("cancelled"), "Cancelled");
    assert.equal(coerceStatus("canceled"), "Cancelled");
    assert.equal(coerceStatus("CANCELED"), "Cancelled");
  });

  test("decodes a Soroban enum object", () => {
    assert.equal(coerceStatus({ Settled: null }), "Settled");
    assert.equal(coerceStatus({ Pending: {} }), "Pending");
  });

  test("defaults unknown values to Pending", () => {
    assert.equal(coerceStatus("weird"), "Pending");
    assert.equal(coerceStatus(undefined), "Pending");
    assert.equal(coerceStatus(42), "Pending");
    assert.equal(coerceStatus({}), "Pending");
  });
});

describe("mapInvoiceRecord", () => {
  test("decodes a full snake_case record", () => {
    const record = mapInvoiceRecord({
      id: 7n,
      payer: "GPAYER",
      payee: "GPAYEE",
      lo_bound: 10000n,
      hi_bound: 50000n,
      commitment: "42",
      status: "Settled",
    });
    assert.ok(record);
    assert.equal(record.id, 7n);
    assert.equal(record.payer, "GPAYER");
    assert.equal(record.payee, "GPAYEE");
    assert.equal(record.loBound, 10000n);
    assert.equal(record.hiBound, 50000n);
    assert.equal(record.commitment, "42");
    assert.equal(record.status, "Settled");
    assert.equal(Number.isNaN(Date.parse(record.createdAt)), false);
  });

  test("accepts camelCase keys and hex commitments", () => {
    const record = mapInvoiceRecord({
      id: "9",
      payer: "GPAYER",
      payee: "GPAYEE",
      loBound: 1000n,
      hiBound: 5000n,
      commitment: "0x10",
      status: "Settled",
    });
    assert.ok(record);
    assert.equal(record.id, 9n);
    assert.equal(record.loBound, 1000n);
    assert.equal(record.hiBound, 5000n);
    assert.equal(record.commitment, "16");
  });

  test("forces a pending invoice commitment to ZERO_COMMITMENT", () => {
    const record = mapInvoiceRecord({
      id: 1n,
      payer: "P",
      payee: "Q",
      lo_bound: 0n,
      hi_bound: 0n,
      commitment: "12345",
      status: "Pending",
    });
    assert.ok(record);
    assert.equal(record.commitment, ZERO_COMMITMENT);
    assert.equal(record.status, "Pending");
  });

  test("returns null for non-object input", () => {
    assert.equal(mapInvoiceRecord(null), null);
    assert.equal(mapInvoiceRecord(undefined), null);
    assert.equal(mapInvoiceRecord("invoice"), null);
    assert.equal(mapInvoiceRecord(42), null);
  });
});
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
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as StellarSdk from "@stellar/stellar-sdk";

import { registerInvoiceArgs } from "./stellar_submit.js";

const CONTRACT_ID = "CALOHKUYNCYIPPICYZMDALGKV2V7QHADOXZGH3MIQQ5CR2WTD45OC5VI";
// Deterministic StrKey accounts (Keypair.fromRawEd25519Seed of 0x01/0x02), so
// the test needs no network and no random key generation.
const PAYER = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
const PAYEE = "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U";

function decodeRegisterInvoiceArgs(): StellarSdk.xdr.ScVal[] {
  const contract = new StellarSdk.Contract(CONTRACT_ID);
  const operation = contract.call("register_invoice", ...registerInvoiceArgs(PAYER, PAYEE, 10000n, 50000n));
  const decoded = StellarSdk.xdr.Operation.fromXDR(operation.toXDR());
  const invoke = decoded.body().invokeHostFunctionOp();
  return invoke.hostFunction().invokeContract().args();
}

describe("register_invoice ScVal encoding", () => {
  test("encodes (payer, payee, lo_bound, hi_bound) positionally", () => {
    const args = decodeRegisterInvoiceArgs();
    assert.equal(args.length, 4);
    assert.equal(StellarSdk.scValToNative(args[0]), PAYER);
    assert.equal(StellarSdk.scValToNative(args[1]), PAYEE);
    assert.equal(StellarSdk.scValToNative(args[2]), 10000n);
    assert.equal(StellarSdk.scValToNative(args[3]), 50000n);
  });

  test("uses Address for the accounts and u64 for the bounds", () => {
    const args = decodeRegisterInvoiceArgs();
    assert.equal(args[0].switch().name, "scvAddress");
    assert.equal(args[1].switch().name, "scvAddress");
    assert.equal(args[2].switch().name, "scvU64");
    assert.equal(args[3].switch().name, "scvU64");
    // A regression that encoded the bounds as strings would change the switch.
    assert.notEqual(args[2].switch().name, "scvString");
  });

  test("invokes the register_invoice contract function", () => {
    const contract = new StellarSdk.Contract(CONTRACT_ID);
    const operation = contract.call("register_invoice", ...registerInvoiceArgs(PAYER, PAYEE, 1n, 2n));
    const invoke = operation.body().invokeHostFunctionOp().hostFunction().invokeContract();
    assert.equal(StellarSdk.Address.fromScAddress(invoke.contractAddress()).toString(), CONTRACT_ID);
    assert.equal(invoke.functionName().toString(), "register_invoice");
  });
});
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
