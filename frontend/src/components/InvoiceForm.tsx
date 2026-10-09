import { FormEvent, useState } from "react";

import { formatMoney, parseUsdToCents } from "../lib/format";

export { parseUsdToCents };

interface InvoiceFormProps {
  onRegister: (payee: string, loBound: bigint, hiBound: bigint) => Promise<bigint>;
}

const USD_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export function parseUsdToCents(value: string): bigint | null {
  const match = USD_AMOUNT_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [whole, fraction = ""] = match[0].split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function isValidStellarAddress(address: string): boolean {
  const trimmed = address.trim();
  return /^G[A-Z2-7]{55}$/.test(trimmed) || /^M[A-Z2-7]{68}$/.test(trimmed);
}

export function InvoiceForm({ onRegister }: InvoiceFormProps) {
  const [payee, setPayee] = useState("");
  const [loBound, setLoBound] = useState("100.00");
  const [hiBound, setHiBound] = useState("500.00");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    const normalizedPayee = payee.trim();

    if (!isValidStellarAddress(normalizedPayee)) {
      setError("Payee address is not a valid Stellar address.");
      return;
    }

    const lo = parseUsdToCents(loBound);
    const hi = parseUsdToCents(hiBound);
    if (lo === null || hi === null) {
      setError("Enter valid USD amounts for both bounds.");
      return;
    }

    if (lo >= hi) {
      setError("The upper bound must be higher than the lower bound.");
      return;
    }

    setLoading(true);
    try {
      const id = await onRegister(normalizedPayee, lo, hi);
      setMessage(`Invoice #${id.toString()} registered for ${formatMoney(lo)} to ${formatMoney(hi)}.`);
      setPayee("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to register invoice.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Create invoice</p>
          <h2>Register a settlement range</h2>
        </div>
        <p className="panel-copy">The contract stores only the payee and public bounds. The negotiated amount stays private.</p>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label className="field">
          <span>Payee Stellar address</span>
          <input
            id="payee"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={payee}
            onChange={(event) => setPayee(event.target.value)}
            placeholder="G..."
            aria-invalid={error?.includes("Stellar address") ? "true" : undefined}
          />
          <small>Use the recipient public key. InvoiceVeil validates it before submission.</small>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Lower bound (USD)</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={loBound}
              onChange={(event) => setLoBound(event.target.value)}
              placeholder="100.00"
            />
          </label>

          <label className="field">
            <span>Upper bound (USD)</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={hiBound}
              onChange={(event) => setHiBound(event.target.value)}
              placeholder="500.00"
            />
          </label>
        </div>

        {error ? <p className="inline-error">{error}</p> : null}
        {message ? <p className="inline-success">{message}</p> : null}

        <button type="submit" className="primary-button" disabled={loading} aria-busy={loading}>
          {loading ? "Registering..." : "Register invoice"}
        </button>
      </form>
    </section>
  );
}
