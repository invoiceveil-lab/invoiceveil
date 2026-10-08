import { useEffect, useState } from "react";

import { readInvoices } from "../../../shared/storage";
import type { InvoiceRecord } from "../types";

export function useInvoices() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    setInvoices(
      readInvoices().sort((a, b) => {
        if (a.id === b.id) {
          return 0;
        }

        return a.id > b.id ? -1 : 1;
      }),
    );
    setLoading(false);
  };

  const getById = (id: bigint) => invoices.find((invoice) => invoice.id === id);

  useEffect(() => {
    refresh();

    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { invoices, loading, refresh, getById };
}
