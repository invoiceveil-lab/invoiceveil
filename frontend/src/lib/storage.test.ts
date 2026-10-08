import { beforeEach, describe, expect, it } from "vitest";

import { STORAGE_KEY, readInvoices, writeInvoices } from "../../../shared/storage";
import type { InvoiceRecord } from "../../../shared/types";

function invoice(id: bigint): InvoiceRecord {
  return {
    id,
    payer: "GPAYER0000000000000000000000000000000000000000000000000000",
    payee: "GPAYEE0000000000000000000000000000000000000000000000000000",
    loBound: 10000n,
    hiBound: 50000n,
    commitment: "0x" + "0".repeat(64),
    status: "Pending",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("shared invoice storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips bigint fields through the single shared implementation", () => {
    writeInvoices([invoice(7n)]);

    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"7n"');
    expect(readInvoices()).toEqual([invoice(7n)]);
  });

  it("returns an empty list for corrupt payloads", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    expect(readInvoices()).toEqual([]);
  });
});
