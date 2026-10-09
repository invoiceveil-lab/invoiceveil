import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { formatMoney } from "../lib/format";
import type { InvoiceRecord, TxLifecycleEvent } from "../types";
import { useProver } from "../hooks/useProver";

interface SettleInvoiceProps {
  invoiceLookup: (id: bigint) => InvoiceRecord | undefined;
  onSettle: (
    invoiceId: bigint,
    payload: {
      proof: unknown;
      publicSignals: { commitment: string; lo_bound: string; hi_bound: string };
      rawPublicSignals: string[];
    },
  ) => Promise<string>;
  txEvent?: TxLifecycleEvent | null;
}

export function SettleInvoice({ invoiceLookup, onSettle, txEvent }: SettleInvoiceProps) {
  txMessage?: string;
  txHash?: string;
  txError?: string;
}

export function SettleInvoice({ invoiceLookup, onSettle, txMessage, txHash, txError }: SettleInvoiceProps) {
  const [invoiceId, setInvoiceId] = useState("1");
  const [amount, setAmount] = useState("250.00");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const submittedProofKeyRef = useRef<string | null>(null);
  const { prove, status, proof, progress, error: proofError, reset } = useProver();
  const signatureRequested =
    txEvent?.type === "AwaitingSignature" ||
    txEvent?.type === "TxBroadcast" ||
    txEvent?.type === "TxConfirmed";
  const broadcast = txEvent?.type === "TxBroadcast" || txEvent?.type === "TxConfirmed";

  const invoice = useMemo(() => {
    try {
      return invoiceLookup(BigInt(invoiceId));
    } catch {
      return undefined;
    }
  }, [invoiceId, invoiceLookup]);

  useEffect(() => {
    if (status !== "computing") {
      return;
    }

    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!invoice) {
      setError("Enter an invoice ID that exists in the feed first.");
      return;
    }

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a valid private amount.");
      return;
    }

    const cents = BigInt(Math.round(parsed * 100));
    if (cents < invoice.loBound || cents > invoice.hiBound) {
      setError(`Amount must stay between ${formatMoney(invoice.loBound)} and ${formatMoney(invoice.hiBound)}.`);
      return;
    }

    reset();
    submittedProofKeyRef.current = null;
    prove(cents, invoice.loBound, invoice.hiBound);
  };

  useEffect(() => {
    const submit = async () => {
      if (!proof) {
        return;
      }

      const proofKey = `${invoiceId}:${proof.publicSignals.commitment}`;
      if (submittedProofKeyRef.current === proofKey) {
        return;
      }

      submittedProofKeyRef.current = proofKey;

      try {
        const hash = await onSettle(BigInt(invoiceId), proof);
        setSuccess(`Invoice settled. Transaction hash: ${hash}`);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Failed to submit settlement transaction.");
      }
    };

    void submit();
  }, [invoiceId, onSettle, proof]);

  const proofBytes = proof ? new Blob([JSON.stringify(proof.proof)]).size : 0;
  const disclosureSalt = proof?.salt ? `0x${BigInt(proof.salt).toString(16)}` : null;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Settle invoice</p>
          <h2>Generate the ZK proof in-browser</h2>
        </div>
        <p className="panel-copy">The exact amount never leaves your machine. The chain sees the proof, the bounds, and the commitment hash.</p>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <div className="field-row">
          <label className="field">
            <span>Invoice ID</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={invoiceId}
              onChange={(event) => setInvoiceId(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Actual amount (private)</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <small>This stays in your browser.</small>
          </label>
        </div>

        {invoice ? (
          <div className="subtle-card">
            <p className="mono">Invoice #{invoice.id.toString()}</p>
            <p>Allowed range: {formatMoney(invoice.loBound)} to {formatMoney(invoice.hiBound)}</p>
          </div>
        ) : (
          <div className="subtle-card">
            <p className="mono">Invoice not loaded yet.</p>
            <p>Create one first or refresh the feed.</p>
          </div>
        )}

        {error ? <p className="inline-error">{error}</p> : null}
        {proofError ? <p className="inline-error">{proofError}</p> : null}
        {txError ? <p className="inline-error">{txError}</p> : null}
        {success ? <p className="inline-success">{success}</p> : null}

        <button type="submit" className="primary-button">
          Start proof flow
        </button>
      </form>

      <div className="steps-card" aria-live="polite">
        <ol className="steps-list">
          <li className={invoice ? "step done" : "step"}>Step 1: Validate inputs</li>
          <li className={progress?.step && progress.step >= 2 ? "step done" : "step"}>Step 2: Compute commitment</li>
          <li className={progress?.step && progress.step >= 3 ? "step done" : "step"}>Step 3: Generate ZK proof</li>
          <li className={proof ? "step done" : "step"}>Step 4: Proof ready</li>
          <li className={signatureRequested ? "step done" : "step"}>Step 5: Await wallet signature</li>
          <li className={broadcast ? "step done" : "step"}>Step 6: Broadcast transaction</li>
          <li className={success ? "step done" : "step"}>Step 7: Invoice settled</li>
        </ol>

        <div className="progress-strip">
          <p>{progress?.message ?? "Ready when you are."}</p>
          {status === "computing" ? <p className="mono">{elapsed}s</p> : null}
          {proof ? <p className="mono">{proofBytes} bytes</p> : null}
        </div>
      </div>

      {proof ? (
        <div className="receipt-card">
          <p className="eyebrow">Disclosure receipt</p>
          <p className="panel-copy">Use these values in the Audit tab to verify the selective disclosure flow.</p>
          <div className="receipt-grid">
            <div>
              <span className="metric-label">Commitment</span>
              <p className="mono receipt-value">{proof.publicSignals.commitment}</p>
            </div>
            <div>
              <span className="metric-label">Salt</span>
              <p className="mono receipt-value">{disclosureSalt}</p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
