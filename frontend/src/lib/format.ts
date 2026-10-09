import type { InvoiceRecord } from "../types";
import { isDemoTxHash } from "../../../shared/demo";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeDollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function currencyParts(formatter: Intl.NumberFormat): { symbol: string; decimal: string } {
  const parts = formatter.formatToParts(0);
  return {
    symbol: parts.find((part) => part.type === "currency")?.value ?? "$",
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
  };
}

/** Group a non-negative integer's decimal digits ("1234567" -> "1,234,567"). */
function groupDigits(value: bigint): string {
  const digits = value.toString();
  let grouped = "";

  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) {
      grouped += ",";
    }

    grouped += digits[index];
  }

  return grouped;
}

function formatCents(cents: bigint, fractionDigits: 0 | 2): string {
  const value = BigInt(cents);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;

  const { symbol, decimal } = fractionDigits === 2
    ? currencyParts(currencyFormatter)
    : currencyParts(wholeDollarFormatter);
  const grouped = groupDigits(whole);
  const sign = negative ? "-" : "";

  if (fractionDigits === 0) {
    return `${sign}${symbol}${grouped}`;
  }

  return `${sign}${symbol}${grouped}${decimal}${fraction.toString().padStart(2, "0")}`;
}

/**
 * Format an integer number of cents as USD without ever converting the amount to
 * a JS `number`, so values above 2^53 keep full precision.
 */
export function formatMoney(cents: bigint): string {
  return formatCents(cents, 2);
}

/** Format an integer number of cents as whole USD (the cents part is truncated). */
export function formatMoneyWhole(cents: bigint): string {
  return formatCents(cents, 0);
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

// Demo settlements reuse a `demo`-prefixed placeholder (see shared/demo.ts).
// Returning null keeps those hashes out of the Stellar explorer.
export function explorerUrl(hash: string): string | null {
  if (isDemoTxHash(hash)) {
    return null;
  }

  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

/** First invoice ID minted by the contract (1-based: `next_id` increments then returns). */
export const FIRST_INVOICE_ID = 1n;

/**
 * Default invoice ID for the settle and audit forms: the lowest ID currently
 * in the feed, falling back to the contract's first ID on an empty feed.
 */
export function defaultInvoiceId(invoices: InvoiceRecord[]): string {
  const first = invoices.reduce<bigint | null>(
    (min, invoice) => (min === null || invoice.id < min ? invoice.id : min),
    null,
  );
  return (first ?? FIRST_INVOICE_ID).toString();
}
