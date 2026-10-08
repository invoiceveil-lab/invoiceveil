import { useEffect, useState } from "react";
import { buildPoseidon } from "circomlibjs";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";

import type { InvoiceRecord, InvoiceVeilMode, TxLifecycleEvent } from "../types";
import { readInvoices, writeInvoices } from "../lib/storage";
import {
  getInvoice as fetchInvoice,
  registerInvoice as registerOnChain,
  submitProofToStellar,
  verifyDisclosure as verifyOnChain,
} from "../../../prover/src/stellar_submit";

const DEFAULT_PAYER = "GDEMOINVOICEVEILPAYER000000000000000000000000000000000";
const NETWORK = "Testnet";
const MODE = (import.meta.env.VITE_INVOICEVEIL_MODE ?? "live") as InvoiceVeilMode;
const WALLET_STORAGE_KEY = "invoiceveil-wallet-address";
const HORIZON_URL = "https://horizon-testnet.stellar.org";

let walletKitInitialized = false;

function fakeHash(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 48)}`;
}

async function ensureWalletKit() {
  if (walletKitInitialized) {
    StellarWalletsKit.setNetwork(Networks.TESTNET);
    return;
  }

  StellarWalletsKit.init({
    modules: [new FreighterModule()],
    network: Networks.TESTNET,
    authModal: {
      showInstallLabel: true,
      hideUnsupportedWallets: true,
    },
  });
  StellarWalletsKit.setNetwork(Networks.TESTNET);
  walletKitInitialized = true;
}

async function recomputeCommitment(amount: bigint, salt: bigint): Promise<string> {
  const poseidon = await buildPoseidon();
  return poseidon.F.toString(poseidon([amount, salt]));
}

const HORIZON_TIMEOUT_MS = 8000;

/** Distinct balance state for an unavailable Horizon account, not a real balance. */
export const UNAVAILABLE_BALANCE = "— XLM";

/**
 * Formats a Horizon native balance with exact string math so large balances are
 * not silently rounded through Number(). Truncates (does not round) to 2 dp.
 */
export function formatXlmBalance(native: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(native.trim());
  if (!match) {
    return native;
  }

  const [, whole, fraction = ""] = match;
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

async function fetchWalletBalance(address: string): Promise<string> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), HORIZON_TIMEOUT_MS);

  try {
    const response = await fetch(`${HORIZON_URL}/accounts/${address}`, { signal: controller.signal });
    if (!response.ok) {
      return UNAVAILABLE_BALANCE;
    }

    const account = (await response.json()) as {
      balances?: Array<{ asset_type?: string; balance?: string }>;
    };
    const native = account.balances?.find((balance) => balance.asset_type === "native")?.balance;
    if (!native) {
      return "0 XLM";
    }

    return `${formatXlmBalance(native)} XLM`;
  } catch {
    return UNAVAILABLE_BALANCE;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function useStellar() {
  const [address, setAddress] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [balance, setBalance] = useState<string>("Demo");
  const [network] = useState(NETWORK);
  const [lastEvent, setLastEvent] = useState<TxLifecycleEvent | null>(null);
  const [mode] = useState<InvoiceVeilMode>(MODE);

  useEffect(() => {
    let cancelled = false;

    const bootstrapWallet = async () => {
      const saved = window.localStorage.getItem(WALLET_STORAGE_KEY);
      if (!saved) {
        if (!cancelled) {
          setIsReady(true);
        }
        return;
      }

      if (mode === "demo") {
        if (!cancelled) {
          setAddress(saved);
          setIsConnected(true);
          setBalance("Demo mode");
          setIsReady(true);
        }
        return;
      }

      try {
        await ensureWalletKit();
        StellarWalletsKit.setWallet(FREIGHTER_ID);
        const restored = await StellarWalletsKit.fetchAddress();

        if (cancelled) {
          return;
        }

        setAddress(restored.address);
        setIsConnected(true);
        setBalance(await fetchWalletBalance(restored.address));
        window.localStorage.setItem(WALLET_STORAGE_KEY, restored.address);
      } catch {
        if (!cancelled) {
          setAddress("");
          setIsConnected(false);
          setBalance("Connect wallet");
          window.localStorage.removeItem(WALLET_STORAGE_KEY);
        }
      } finally {
        if (!cancelled) {
          setIsReady(true);
        }
      }
    };

    void bootstrapWallet();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "live" || !address) {
      return;
    }

    void fetchWalletBalance(address)
      .then(setBalance)
      .catch(() => setBalance(UNAVAILABLE_BALANCE));
  }, [address, mode]);

  const signTransaction = async (xdr: string, context: { address: string; networkPassphrase: string }) => {
    await ensureWalletKit();
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      address: context.address,
      networkPassphrase: context.networkPassphrase,
    });
    return signedTxXdr;
  };

  const connect = async () => {
    if (mode === "demo") {
      const detected =
        window.localStorage.getItem(WALLET_STORAGE_KEY) ?? "GCFX7C4T74DUMMYINVOICEVEILWALLETDEMOADDRESSXXXX";
      setAddress(detected);
      setIsConnected(true);
      setBalance("Demo mode");
      window.localStorage.setItem(WALLET_STORAGE_KEY, detected);
      return;
    }

    await ensureWalletKit();

    try {
      StellarWalletsKit.setWallet(FREIGHTER_ID);
      const { address: detected } = await StellarWalletsKit.fetchAddress();
      setAddress(detected);
      setIsConnected(true);
      setBalance(await fetchWalletBalance(detected));
      window.localStorage.setItem(WALLET_STORAGE_KEY, detected);
    } catch {
      const { address: detected } = await StellarWalletsKit.authModal();
      setAddress(detected);
      setIsConnected(true);
      setBalance(await fetchWalletBalance(detected));
      window.localStorage.setItem(WALLET_STORAGE_KEY, detected);
    }
  };

  const disconnect = () => {
    setAddress("");
    setIsConnected(false);
    setBalance("Demo");
    setLastEvent(null);
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
    void StellarWalletsKit.disconnect().catch(() => undefined);
  };

  const registerInvoice = async (payee: string, loBound: bigint, hiBound: bigint): Promise<bigint> => {
    const payer = address || DEFAULT_PAYER;
    if (mode === "live" && !address) {
      throw new Error("Connect a Stellar testnet wallet before registering an invoice.");
    }

    try {
      const id = await registerOnChain(payee, loBound, hiBound, {
        payer,
        signTransaction,
        onEvent: setLastEvent,
      });
      return id;
    } catch (error) {
      if (mode === "live") {
        throw error;
      }

      const invoices = readInvoices();
      const currentMax = invoices.reduce((max, invoice) => (invoice.id > max ? invoice.id : max), 0n);
      const id = currentMax + 1n;
      const next: InvoiceRecord = {
        id,
        payer,
        payee,
        loBound,
        hiBound,
        commitment: "0x" + "0".repeat(64),
        status: "Pending",
        createdAt: new Date().toISOString(),
      };
      writeInvoices([next, ...invoices]);
      return id;
    }
  };

  const settleInvoice = async (
    invoiceId: bigint,
    payload: {
      proof: unknown;
      publicSignals: { commitment: string; lo_bound: string; hi_bound: string };
      rawPublicSignals: string[];
    },
  ): Promise<string> => {
    setLastEvent({ type: "ProofSubmitting", message: "Preparing Soroban transaction..." });
    if (mode === "live" && !address) {
      throw new Error("Connect a Stellar testnet wallet before settling an invoice.");
    }

    try {
      const txHash = await submitProofToStellar(invoiceId, payload.proof, payload.publicSignals, payload.rawPublicSignals, {
        payer: address || DEFAULT_PAYER,
        signTransaction,
        onEvent: setLastEvent,
      });
      return txHash;
    } catch (error) {
      if (mode === "live") {
        throw error;
      }

      const invoices = readInvoices();
      const txHash = fakeHash("demo");
      const updated = invoices.map((invoice) =>
        invoice.id === invoiceId
          ? {
              ...invoice,
              commitment: payload.publicSignals.commitment,
              status: "Settled" as const,
              txHash,
            }
          : invoice,
      );
      writeInvoices(updated);
      setLastEvent({ type: "TxConfirmed", message: "Demo settlement confirmed.", hash: txHash });
      return txHash;
    }
  };

  const getInvoice = async (invoiceId: bigint): Promise<InvoiceRecord | null> => {
    try {
      return await fetchInvoice(invoiceId, { viewer: address || undefined });
    } catch {
      return readInvoices().find((invoice) => invoice.id === invoiceId) ?? null;
    }
  };

  const verifyDisclosure = async (invoiceId: bigint, amount: bigint, salt: bigint): Promise<boolean> => {
    try {
      return await verifyOnChain(invoiceId, amount, salt);
    } catch {
      const invoice = await getInvoice(invoiceId);
      if (!invoice) {
        return false;
      }

      return (await recomputeCommitment(amount, salt)) === invoice.commitment;
    }
  };

  return {
    connect,
    disconnect,
    isReady,
    address,
    balance,
    network,
    mode,
    registerInvoice,
    settleInvoice,
    getInvoice,
    verifyDisclosure,
    isConnected,
    lastEvent,
  };
}
