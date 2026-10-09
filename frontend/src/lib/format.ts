import type { InvoiceRecord } from "../types";
import { isDemoTxHash } from "../../../shared/demo";

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

// Demo settlements reuse a `demo`-prefixed placeholder (see shared/demo.ts).
// Returning null keeps those hashes out of the Stellar explorer.
export function explorerUrl(hash: string): string | null {
  if (isDemoTxHash(hash)) {
    return null;
  }

  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
