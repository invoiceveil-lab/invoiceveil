import { FormEvent, useState } from "react";

interface AuditorViewProps {
  onVerify: (invoiceId: bigint, amount: bigint, salt: bigint) => Promise<boolean>;
  defaultInvoiceId: string;
}

export function AuditorView({ onVerify, defaultInvoiceId }: AuditorViewProps) {
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId);
  const [amount, setAmount] = useState("250.00");
  const [salt, setSalt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
      const invoice = BigInt(invoiceId);
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("Enter a valid USD amount.");
      }

      const cents = BigInt(Math.round(parsed * 100));
      const saltValue = salt.startsWith("0x") ? BigInt(salt) : BigInt(`0x${salt}`);
      const valid = await onVerify(invoice, cents, saltValue);
      setMessage(
        valid
          ? `Confirmed - Invoice #${invoiceId} amount matches commitment.`
          : "Amount or salt does not match the stored commitment.",
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to verify disclosure.");
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Audit</p>
          <h2>Selective disclosure</h2>
        </div>
        <p className="panel-copy">A view key is the amount plus salt used to recompute the original Poseidon commitment.</p>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <div className="field-row">
          <label className="field">
            <span>Invoice ID</span>
            <input type="text" inputMode="numeric" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)} />
          </label>

          <label className="field">
            <span>Amount (USD)</span>
            <input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Salt (hex)</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={salt}
            onChange={(event) => setSalt(event.target.value)}
            placeholder="0x..."
          />
          <small>No new data is revealed on-chain. This only checks the existing commitment.</small>
        </label>

        {message ? <p className="inline-success">{message}</p> : null}
        {error ? <p className="inline-error">{error}</p> : null}

        <button type="submit" className="primary-button">
          Verify disclosure
        </button>
      </form>
    </section>
  );
}
