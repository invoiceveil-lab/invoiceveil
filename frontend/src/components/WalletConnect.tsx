import { truncateMiddle } from "../lib/format";

interface WalletConnectProps {
  isConnected: boolean;
  address: string;
  balance: string;
  network: string;
  mode: "demo" | "live";
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
}

export function WalletConnect({
  isConnected,
  address,
  balance,
  network,
  mode,
  onConnect,
  onDisconnect,
}: WalletConnectProps) {
  return (
    <section className="wallet-status-panel" aria-label="Wallet status">
      <div className="wallet-status-copy">
        <p className="eyebrow">Wallet session</p>
        <h3>
          {isConnected
            ? "Connected and ready for testnet settlement."
            : "Connect a Stellar wallet to enter the dashboard."}
        </h3>
        <p className="header-copy">
          Live mode signs real Soroban testnet transactions. Disconnecting sends the session back to the landing page.
        </p>
      </div>

      <div className="wallet-cluster wallet-cluster-compact">
        <span className={mode === "live" ? "network-pill mode-live" : "network-pill mode-demo"}>
          {mode === "live" ? "Live mode" : "Demo mode"}
        </span>
        <span className="network-pill">{network}</span>
        {isConnected ? (
          <div className="wallet-card">
            <div>
              <p className="wallet-label">Freighter wallet</p>
              <p className="mono">{truncateMiddle(address, 6, 6)}</p>
              <p className="wallet-balance">{balance}</p>
            </div>
            <button type="button" className="secondary-button" onClick={onDisconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <button type="button" className="primary-button" onClick={onConnect}>
            Connect wallet
          </button>
        )}
      </div>
    </section>
  );
}
