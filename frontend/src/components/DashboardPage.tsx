import { useMemo, useState } from "react";

import { AuditorView } from "./AuditorView";
import { InvoiceForm } from "./InvoiceForm";
import { InvoiceList } from "./InvoiceList";
import { SettleInvoice } from "./SettleInvoice";
import { useInvoices } from "../hooks/useInvoices";
import { defaultInvoiceId, truncateMiddle } from "../lib/format";
import type { InvoiceRecord, TxLifecycleEvent } from "../types";

type TabId = "overview" | "create" | "settle" | "feed" | "audit";
type IconId = "overview" | "create" | "settle" | "feed" | "audit" | "wallet" | "contract" | "arrow";

const tabs: Array<{ id: TabId; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "Workspace summary" },
  { id: "create", label: "Create invoice", description: "Register public bounds" },
  { id: "settle", label: "Settle invoice", description: "Generate and submit proof" },
  { id: "feed", label: "Invoice feed", description: "Track public records" },
  { id: "audit", label: "Audit disclosure", description: "Verify a commitment" },
];

const pageCopy: Record<TabId, { eyebrow: string; title: string; copy: string }> = {
  overview: {
    eyebrow: "Settlement workspace",
    title: "Private invoices, verifiable settlement.",
    copy: "Register contract bounds, prove the private amount locally, and settle on Stellar testnet.",
  },
  create: {
    eyebrow: "New invoice",
    title: "Register a settlement range.",
    copy: "Only the payee and agreed bounds are stored on-chain. The exact amount remains private.",
  },
  settle: {
    eyebrow: "Proof workspace",
    title: "Prove and settle an invoice.",
    copy: "Generate the Groth16 proof in your browser, then approve the Soroban transaction in your wallet.",
  },
  feed: {
    eyebrow: "On-chain activity",
    title: "Review invoice records.",
    copy: "Track registered ranges, settlement status, commitments, and Stellar transactions.",
  },
  audit: {
    eyebrow: "Selective disclosure",
    title: "Verify a private amount.",
    copy: "Use the disclosed amount and salt to verify the existing commitment without publishing new data.",
  },
};

interface DashboardPageProps {
  stellar: {
    isConnected: boolean;
    address: string;
    balance: string;
    network: string;
    mode: "demo" | "live";
    lastEvent: TxLifecycleEvent | null;
    connect: () => Promise<void>;
    disconnect: () => void;
    registerInvoice: (payee: string, loBound: bigint, hiBound: bigint) => Promise<bigint>;
    settleInvoice: (
      invoiceId: bigint,
      payload: {
        proof: unknown;
        publicSignals: { commitment: string; lo_bound: string; hi_bound: string };
        rawPublicSignals: string[];
      },
    ) => Promise<string>;
    verifyDisclosure: (invoiceId: bigint, amount: bigint, salt: bigint) => Promise<boolean>;
  };
  onDisconnectToLanding: () => void;
}

function DashboardIcon({ name }: { name: IconId }) {
  const paths: Record<IconId, JSX.Element> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    create: <><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/></>,
    settle: <><path d="M5 7h12l-3-3M19 17H7l3 3"/><path d="M17 7l-3 3M7 17l3-3"/></>,
    feed: <><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="1"/></>,
    audit: <><path d="M12 3l7 3v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></>,
    wallet: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18v16H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 7h14M15 12h5v4h-5a2 2 0 0 1 0-4z"/></>,
    contract: <><path d="M7 3h10l3 3v15H4V3z"/><path d="M8 10h8M8 14h8M8 18h5"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
  };

  return <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatVolume(invoices: InvoiceRecord[]): string {
  const total = invoices.reduce((sum, invoice) => sum + invoice.hiBound, 0n);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(total) / 100);
}

export function DashboardPage({ stellar, onDisconnectToLanding }: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { invoices, loading, refresh, getById } = useInvoices();
  const txHash = useMemo(() => stellar.lastEvent?.hash, [stellar.lastEvent]);
  const pendingCount = invoices.filter((invoice) => invoice.status === "Pending").length;
  const settledCount = invoices.filter((invoice) => invoice.status === "Settled").length;
  const firstInvoiceId = useMemo(() => defaultInvoiceId(invoices), [invoices]);
  const currentPage = pageCopy[activeTab];

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">
            <img src="/brand/invoiceveil-logo.png" alt="" width="42" height="42" />
          </span>
          <div><strong>InvoiceVeil</strong><span>Private settlement</span></div>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard pages">
          <p className="sidebar-label">Workspace</p>
          {tabs.map((tab) => (
            <button key={tab.id} type="button" className={tab.id === activeTab ? "sidebar-link active" : "sidebar-link"} onClick={() => setActiveTab(tab.id)} aria-current={tab.id === activeTab ? "page" : undefined}>
              <span className="sidebar-link-icon"><DashboardIcon name={tab.id} /></span>
              <span className="sidebar-link-copy"><strong>{tab.label}</strong><small>{tab.description}</small></span>
            </button>
          ))}
        </nav>

        <div className="sidebar-session">
          <div className="sidebar-session-head"><span className="connection-dot"/><span>{stellar.mode === "live" ? "Live testnet" : "Demo mode"}</span></div>
          <div className="sidebar-wallet-row"><DashboardIcon name="wallet"/><div><strong className="mono">{truncateMiddle(stellar.address, 5, 5)}</strong><span>{stellar.balance}</span></div></div>
          <button type="button" className="sidebar-disconnect" onClick={onDisconnectToLanding}>Disconnect wallet</button>
        </div>
      </aside>

      <div className="dashboard-workspace">
        <header className="workspace-header">
          <div>
            <p className="workspace-eyebrow">{currentPage.eyebrow}</p>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.copy}</p>
          </div>
          <div className="workspace-status" aria-label="Connection status">
            <span className="connection-dot"/><span>{stellar.network}</span><span className="workspace-address mono">{truncateMiddle(stellar.address, 6, 5)}</span>
          </div>
        </header>

        <main className="workspace-main">
          <section className={stellar.mode === "live" ? "status-banner live" : "status-banner demo"}>
            <span className="status-banner-icon"><DashboardIcon name={stellar.mode === "live" ? "contract" : "overview"}/></span>
            <div><strong>{stellar.mode === "live" ? "Connected to Stellar testnet" : "Local demo mode active"}</strong><p>{stellar.mode === "live" ? "Transactions require your wallet approval and are submitted to the live Soroban testnet contract." : "Actions use local fallback data and do not submit testnet transactions."}</p></div>
          </section>

          {activeTab === "overview" ? (
            <section className="overview-surface">
              <div className="overview-metrics" aria-label="Invoice metrics">
                <div><span>Pending</span><strong>{pendingCount}</strong></div>
                <div><span>Settled</span><strong>{settledCount}</strong></div>
                <div><span>Tracked bounds</span><strong>{formatVolume(invoices)}</strong></div>
                <div><span>Wallet balance</span><strong>{stellar.balance}</strong></div>
              </div>

              <div className="overview-flow">
                <div className="overview-section-heading"><div><p className="eyebrow">Settlement flow</p><h2>From agreement to verified payment</h2></div><p>Each stage keeps the negotiated amount off-chain while preserving verifiable contract constraints.</p></div>
                {tabs.slice(1).map((tab, index) => (
                  <button key={tab.id} type="button" className="flow-row" onClick={() => setActiveTab(tab.id)}>
                    <span className="flow-index">0{index + 1}</span><span className="flow-icon"><DashboardIcon name={tab.id}/></span><span className="flow-copy"><strong>{tab.label}</strong><small>{tab.description}</small></span><span className="flow-action">Open <DashboardIcon name="arrow"/></span>
                  </button>
                ))}
              </div>

              <div className="contract-strip"><DashboardIcon name="contract"/><div><span>Active Soroban contract</span><strong className="mono">CALOHKUYNCYIPPICYZMDALGKV2V7QHADOXZGH3MIQQ5CR2WTD45OC5VI</strong></div></div>
            </section>
          ) : null}
          {activeTab === "create" ? <InvoiceForm onRegister={stellar.registerInvoice} /> : null}
          {activeTab === "settle" ? <SettleInvoice invoiceLookup={getById} onSettle={stellar.settleInvoice} defaultInvoiceId={firstInvoiceId} txMessage={stellar.lastEvent?.message} txHash={txHash} /> : null}
          {activeTab === "feed" ? <InvoiceList invoices={invoices} loading={loading} onRefresh={refresh} /> : null}
          {activeTab === "audit" ? <AuditorView onVerify={stellar.verifyDisclosure} defaultInvoiceId={firstInvoiceId} /> : null}
        </main>
      </div>
    </div>
  );
}
