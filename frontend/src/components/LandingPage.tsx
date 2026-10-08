interface LandingPageProps {
  mode: "demo" | "live";
  isConnecting: boolean;
  isConnected: boolean;
  onConnectWallet: () => Promise<void>;
  onOpenDashboard: () => void;
}

export function LandingPage({ mode, isConnecting, isConnected, onConnectWallet, onOpenDashboard }: LandingPageProps) {
  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <div className="landing-brand">
          <span className="landing-brand-mark">
            <img src="/brand/invoiceveil-logo.png" alt="" width="42" height="42" />
          </span>
          <div>
            <strong>InvoiceVeil</strong>
            <span>Confidential B2B settlement on Stellar</span>
          </div>
        </div>

        <nav className="landing-links" aria-label="Landing sections">
          <a href="#features">Features</a>
          <a href="#flow">Flow</a>
          <a href="#architecture">Architecture</a>
        </nav>

        {isConnected ? (
          <button type="button" className="primary-button" onClick={onOpenDashboard}>
            Open dashboard
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            onClick={() => void onConnectWallet()}
            disabled={isConnecting}
          >
            {isConnecting ? "Connecting..." : "Connect wallet"}
          </button>
        )}
      </header>

      <main>
        <section className="landing-hero">
          <div>
            <p className="landing-eyebrow">{mode === "live" ? "Stellar testnet is active" : "Demo mode available"}</p>
            <h1>Private invoice settlement on Stellar, with ZK controlling the settlement path.</h1>
            <p className="landing-copy">
              InvoiceVeil lets a business send a USDC payment on Stellar and prove the invoice amount satisfies a
              privately agreed contract bound without revealing the actual amount on-chain.
            </p>

            <div className="landing-actions">
              {isConnected ? (
                <button type="button" className="primary-button" onClick={onOpenDashboard}>
                  Launch dashboard
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void onConnectWallet()}
                  disabled={isConnecting}
                >
                  {isConnecting ? "Connecting wallet..." : "Connect testnet wallet"}
                </button>
              )}
              <a className="secondary-button landing-link-button" href="#flow">
                See the settlement flow
              </a>
            </div>

            <ul className="landing-signal-list">
              <li>Groth16 verification sits in the settlement path, not beside it.</li>
              <li>Poseidon commitments hide the exact invoice amount from the public feed.</li>
              <li>Live mode uses real Stellar Wallet Kit connection and Soroban testnet transactions.</li>
            </ul>
          </div>

          <aside className="landing-visual">
            <div className="landing-visual-head">
              <strong>Invoice preview</strong>
              <span>Proof, not amount</span>
            </div>

            <div className="landing-proof-card">
              <p className="metric-label">Invoice #018</p>
              <h2>$10,000 to $50,000</h2>
              <p>
                The contract stores payer, payee, bounds, commitment, and settlement state. The private amount never
                becomes public chain data.
              </p>
            </div>

            <div className="landing-step-list">
              <div className="landing-step-item">
                <strong>1. Register public bounds</strong>
                <span>On Soroban</span>
              </div>
              <div className="landing-step-item">
                <strong>2. Generate proof locally</strong>
                <span>In the browser</span>
              </div>
              <div className="landing-step-item">
                <strong>3. Verify before settlement</strong>
                <span>Wallet-signed</span>
              </div>
              <div className="landing-step-item">
                <strong>4. Reveal only the commitment</strong>
                <span>ZK protected</span>
              </div>
            </div>
          </aside>
        </section>

        <section className="landing-stack" id="features">
          <article className="landing-strip">
            <strong>Exact amount stays private</strong>
            <p>The feed shows settlement state and commitment, not the raw invoice amount.</p>
          </article>
          <article className="landing-strip">
            <strong>ZK is load-bearing</strong>
            <p>
              Settlement is supposed to pass only when the proof verifies and the bounds match the registered invoice.
            </p>
          </article>
          <article className="landing-strip">
            <strong>Auditor path exists</strong>
            <p>
              Amount plus salt can be shared privately later to confirm the commitment without changing chain
              visibility.
            </p>
          </article>
          <article className="landing-strip">
            <strong>Built for Stellar</strong>
            <p>The project is centered on Soroban, Stellar Wallets Kit, and testnet transaction flow.</p>
          </article>
        </section>

        <section className="landing-section" id="flow">
          <div className="landing-section-head">
            <p className="landing-eyebrow">End-to-end flow</p>
            <h2>From invoice registration to private settlement in four steps.</h2>
            <p>
              The app is intentionally narrow: register invoice bounds, generate a browser proof, verify on Soroban, and
              keep the public feed commercially safe.
            </p>
          </div>

          <div className="landing-timeline">
            <article className="landing-stage">
              <p className="metric-label">Step 01</p>
              <h3>Register invoice bounds</h3>
              <p>The payer stores payee plus `lo_bound` and `hi_bound` on-chain.</p>
            </article>
            <article className="landing-stage">
              <p className="metric-label">Step 02</p>
              <h3>Pick the actual amount privately</h3>
              <p>The buyer decides the invoice amount locally and generates a salt for the commitment.</p>
            </article>
            <article className="landing-stage">
              <p className="metric-label">Step 03</p>
              <h3>Generate the Groth16 proof</h3>
              <p>The browser proves the amount is in range and bound to the commitment.</p>
            </article>
            <article className="landing-stage">
              <p className="metric-label">Step 04</p>
              <h3>Submit and settle on Stellar</h3>
              <p>The connected wallet signs the Soroban transaction and the invoice becomes settled.</p>
            </article>
          </div>
        </section>

        <section className="landing-section" id="architecture">
          <div className="landing-section-head">
            <p className="landing-eyebrow">Architecture</p>
            <h2>One product, four moving parts.</h2>
          </div>

          <div className="landing-architecture-list">
            <article className="landing-architecture-item">
              <h3>Circom circuit</h3>
              <p>Proves `lo_bound ≤ amount ≤ hi_bound` and ties the amount to `Poseidon(amount, salt)`.</p>
            </article>
            <article className="landing-architecture-item">
              <h3>Browser prover</h3>
              <p>Generates the witness and proof locally so private inputs do not leave the client.</p>
            </article>
            <article className="landing-architecture-item">
              <h3>Soroban contract</h3>
              <p>Stores invoice state and verifies the Groth16 proof before allowing settlement.</p>
            </article>
            <article className="landing-architecture-item">
              <h3>Dashboard app</h3>
              <p>
                Handles wallet connection, invoice registration, settlement, feed visibility, and audit disclosure UX.
              </p>
            </article>
          </div>
        </section>

        <section className="landing-cta">
          <div>
            <h2>Launch the testnet dashboard and run the full flow.</h2>
            <p>
              Use a funded Stellar testnet wallet, create an invoice, generate the proof, and submit the settlement
              transaction.
            </p>
          </div>
          {isConnected ? (
            <button type="button" className="primary-button" onClick={onOpenDashboard}>
              Continue to dashboard
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => void onConnectWallet()}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect wallet to continue"}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
