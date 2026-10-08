import type { InvoiceRecord } from "../types";

const USD_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

/**
 * Parses a user-entered USD amount into exact cents using a strict decimal
 * grammar. Empty strings, scientific notation, hex, signs, and surrounding
 * whitespace are rejected so the amount proved and stored matches exactly what
 * the user typed.
 */
export function parseUsdToCents(value: string): bigint | null {
  const match = USD_AMOUNT_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [whole, fraction = ""] = match[0].split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function formatMoney(cents: bigint): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

export function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function statusTone(status: InvoiceRecord["status"]): string {
  switch (status) {
    case "Settled":
      return "status-settled";
    case "Cancelled":
      return "status-cancelled";
    default:
      return "status-pending";
  }
}

export function explorerUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
