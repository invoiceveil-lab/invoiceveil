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
