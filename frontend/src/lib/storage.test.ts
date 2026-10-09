import { beforeEach, describe, expect, it } from "vitest";

import type { InvoiceRecord } from "../types";
import { readInvoices, writeInvoices } from "./storage";

const STORAGE_KEY = "invoiceveil-demo-invoices";

function makeRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 7n,
    payer: "GPAYER000000000000000000000000000000000000000000000000000",
    payee: "GPAYEE000000000000000000000000000000000000000000000000000",
    loBound: 100n,
    hiBound: 500n,
    commitment: "0xdeadbeef",
    status: "Pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Serialise a record as raw JSON so bigints arrive as their wire form ("7n"). */
function rawRecord(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "7n",
    payer: "GPAYER000000000000000000000000000000000000000000000000000",
    payee: "GPAYEE000000000000000000000000000000000000000000000000000",
    loBound: "100n",
    hiBound: "500n",
    commitment: "0xdeadbeef",
    status: "Pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("readInvoices / writeInvoices bigint round-trip", () => {
  it("restores id, loBound and hiBound as bigints", () => {
    writeInvoices([makeRecord()]);

    const restored = readInvoices();
    expect(restored).toHaveLength(1);
    expect(typeof restored[0].id).toBe("bigint");
    expect(restored[0].id).toBe(7n);
    expect(typeof restored[0].loBound).toBe("bigint");
    expect(restored[0].loBound).toBe(100n);
    expect(restored[0].hiBound).toBe(500n);
    expect(restored[0].commitment).toBe("0xdeadbeef");
    expect(restored[0].status).toBe("Pending");
  });

  it("round-trips negative bigints", () => {
    writeInvoices([makeRecord({ id: -42n, loBound: -500n, hiBound: -1n })]);

    const [restored] = readInvoices();
    expect(restored.id).toBe(-42n);
    expect(restored.loBound).toBe(-500n);
    expect(restored.hiBound).toBe(-1n);
  });

  it("accepts a stored zero-padded bigint such as 001n", () => {
    window.localStorage.setItem(STORAGE_KEY, `[${rawRecord({ id: "001n", loBound: "0000n" })}]`);

    const [restored] = readInvoices();
    expect(typeof restored.id).toBe("bigint");
    expect(restored.id).toBe(1n);
    expect(restored.loBound).toBe(0n);
  });

  it("leaves a malformed bigint-like value as a string instead of throwing", () => {
    window.localStorage.setItem(STORAGE_KEY, `[${rawRecord({ id: "12x" })}]`);

    const [restored] = readInvoices();
    expect(restored.id).toBe("12x");
  });

  it("returns an empty array for a corrupt JSON payload", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");

    expect(() => readInvoices()).not.toThrow();
    expect(readInvoices()).toEqual([]);
  });

  it("returns an empty array when nothing is stored", () => {
    expect(readInvoices()).toEqual([]);
  });
});
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
