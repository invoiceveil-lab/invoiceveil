import { explorerUrl, formatMoney, statusTone, truncateMiddle } from "../lib/format";
import type { InvoiceRecord } from "../types";

interface InvoiceListProps {
  invoices: InvoiceRecord[];
  loading: boolean;
  onRefresh: () => void;
}

export function InvoiceList({ invoices, loading, onRefresh }: InvoiceListProps) {
  if (loading) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Feed</p>
            <h2>Settlement feed</h2>
          </div>
        </div>
        <div className="skeleton-list" aria-hidden="true">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      </section>
    );
  }

  if (invoices.length === 0) {
    return (
      <section className="panel empty-state">
        <p className="eyebrow">Feed</p>
        <h2>No invoices yet</h2>
        <p>No invoices yet - create one above.</p>
        <button type="button" className="secondary-button" onClick={onRefresh}>
          Refresh feed
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Feed</p>
          <h2>Public invoice records</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Invoice ID</th>
              <th>Payee</th>
              <th>Bounds</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Commitment</th>
              <th>Stellar Tx</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => {
              const explorer = invoice.txHash ? explorerUrl(invoice.txHash) : null;

              return (
                <tr key={invoice.id.toString()}>
                  <td className="mono">#{invoice.id.toString()}</td>
                  <td className="mono">{truncateMiddle(invoice.payee, 6, 6)}</td>
                  <td>{formatMoney(invoice.loBound)} - {formatMoney(invoice.hiBound)}</td>
                  <td><span className={`status-pill ${statusTone(invoice.status)}`}>{invoice.status}</span></td>
                  <td className="zk-locked">ZK Protected</td>
                  <td className="mono">{truncateMiddle(invoice.commitment, 10, 8)}</td>
                  <td>
                    {invoice.txHash ? (
                      explorer ? (
                        <a href={explorer} target="_blank" rel="noreferrer">
                          {truncateMiddle(invoice.txHash, 8, 6)}
                        </a>
                      ) : (
                        <span className="mono muted-text" title="Demo settlement recorded locally">
                          {truncateMiddle(invoice.txHash, 8, 6)} (demo)
                        </span>
                      )
                    ) : (
                      <span className="muted-text">Pending</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {invoices.map((invoice) => (
              <tr key={invoice.id.toString()}>
                <td className="mono">#{invoice.id.toString()}</td>
                <td className="mono">{truncateMiddle(invoice.payee, 6, 6)}</td>
                <td>
                  {formatMoney(invoice.loBound)} - {formatMoney(invoice.hiBound)}
                </td>
                <td>
                  <span className={`status-pill ${statusTone(invoice.status)}`}>{invoice.status}</span>
                </td>
                <td className="zk-locked">ZK Protected</td>
                <td className="mono">{truncateMiddle(invoice.commitment, 10, 8)}</td>
                <td>
                  {invoice.txHash ? (
                    <a href={explorerUrl(invoice.txHash)} target="_blank" rel="noreferrer">
                      {truncateMiddle(invoice.txHash, 8, 6)}
                    </a>
                  ) : (
                    <span className="muted-text">Pending</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
