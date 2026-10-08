import type { InvoiceRecord } from "./types.js";

export const STORAGE_KEY = "invoiceveil-demo-invoices";
const memoryStorage = new Map<string, string>();

function replacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? `${value.toString()}n` : value;
}

function reviver(_key: string, value: unknown) {
  if (typeof value === "string" && value.endsWith("n") && /^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }

  return value;
}

export function readInvoices(): InvoiceRecord[] {
  const raw =
    typeof window === "undefined"
      ? memoryStorage.get(STORAGE_KEY) ?? null
      : window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw, reviver) as InvoiceRecord[];
  } catch {
    return [];
  }
}

export function writeInvoices(invoices: InvoiceRecord[]): void {
  const serialized = JSON.stringify(invoices, replacer);

  if (typeof window === "undefined") {
    memoryStorage.set(STORAGE_KEY, serialized);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, serialized);
}
