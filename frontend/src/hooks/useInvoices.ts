import { useEffect, useState } from "react";

import { readInvoices } from "../lib/storage";
import { getInvoice as fetchOnChainInvoice } from "../../../prover/src/stellar_submit";
import type { InvoiceRecord, InvoiceVeilMode } from "../types";

const MODE = (import.meta.env.VITE_INVOICEVEIL_MODE ?? "live") as InvoiceVeilMode;
const WALLET_STORAGE_KEY = "invoiceveil-wallet-address";

function sortInvoices(invoices: InvoiceRecord[]): InvoiceRecord[] {
  return [...invoices].sort((a, b) => {
    if (a.id === b.id) {
      return 0;
    }

    return a.id > b.id ? -1 : 1;
  });
}

function currentViewer(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage.getItem(WALLET_STORAGE_KEY) ?? undefined;
}

export function useInvoices() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const cached = readInvoices();

    try {
      if (MODE !== "live") {
        setInvoices(sortInvoices(cached));
        return;
      }

      // In live mode the local cache only holds IDs this browser has seen, so
      // hydrate each known ID from the contract and fall back to the cached
      // record when a read fails.
      const viewer = currentViewer();
      const hydrated = await Promise.all(
        cached.map(async (invoice) => {
          try {
            const onChain = await fetchOnChainInvoice(invoice.id, { viewer });
            return onChain ?? invoice;
          } catch {
            return invoice;
          }
        }),
      );

      setInvoices(sortInvoices(hydrated));
    } catch {
      setInvoices(sortInvoices(cached));
    } finally {
      setLoading(false);
    }
  };

  const getById = (id: bigint) => invoices.find((invoice) => invoice.id === id);

  useEffect(() => {
    void refresh();

    const onStorage = () => {
      void refresh();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
    };
    // refresh is intentionally run once on mount and on cross-tab storage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { invoices, loading, refresh, getById };
}
