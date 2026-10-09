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
