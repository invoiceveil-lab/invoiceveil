import type { InvoiceRecord } from "../types";

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
