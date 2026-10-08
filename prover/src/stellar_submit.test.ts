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
