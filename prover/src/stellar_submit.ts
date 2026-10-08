import * as StellarSdk from "@stellar/stellar-sdk";

import type { InvoiceRecord, InvoiceStatus, InvoiceVeilMode, PublicSignals, TxLifecycleEvent } from "../../shared/types.js";
import { fieldElemToBytes32, g1PointToBytes64, g2PointToBytes128 } from "./converters.js";

const CONTRACT_ID =
  import.meta.env?.VITE_CONTRACT_ID ?? "CALOHKUYNCYIPPICYZMDALGKV2V7QHADOXZGH3MIQQ5CR2WTD45OC5VI";
const RPC_URL = import.meta.env?.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  import.meta.env?.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const APP_MODE = (import.meta.env?.VITE_INVOICEVEIL_MODE ?? (typeof window === "undefined" ? "demo" : "live")) as InvoiceVeilMode;
const STORAGE_KEY = "invoiceveil-demo-invoices";
const memoryStorage = new Map<string, string>();
const ZERO_COMMITMENT = "0x" + "0".repeat(64);

type SnarkProof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
};

type WalletSigner = {
  signTransaction: (xdr: string, context: { address: string; networkPassphrase: string }) => Promise<string>;
};

export interface RegisterConfig extends WalletSigner {
  payer: string;
  onEvent?: (event: TxLifecycleEvent) => void;
}

export interface SubmitConfig extends WalletSigner {
  payer: string;
  onEvent?: (event: TxLifecycleEvent) => void;
}

export interface InvoiceLookupConfig {
  viewer?: string;
}

function replacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? `${value.toString()}n` : value;
}

function reviver(_key: string, value: unknown) {
  if (typeof value === "string" && value.endsWith("n") && /^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }

  return value;
}

function emit(callbacks: { onEvent?: (event: TxLifecycleEvent) => void }, event: TxLifecycleEvent) {
  callbacks.onEvent?.(event);
}

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function normalizeHex(input: string): string {
  return input.startsWith("0x") ? input.slice(2) : input;
}

function fieldElementToDecimalString(value: string | Uint8Array): string {
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      return value;
    }

    return BigInt(`0x${normalizeHex(value)}`).toString();
  }

  const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex}`).toString();
}

function commitmentBytesToDecimal(value: unknown): string {
  if (value instanceof Uint8Array) {
    return fieldElementToDecimalString(value);
  }

  if (typeof value === "string") {
    return fieldElementToDecimalString(value);
  }

  return ZERO_COMMITMENT;
}

function coerceStatus(value: unknown): InvoiceStatus {
  if (typeof value === "string") {
    if (value === "Pending" || value === "Settled" || value === "Cancelled") {
      return value;
    }

    const normalized = value.toLowerCase();
    if (normalized === "pending") {
      return "Pending";
    }

    if (normalized === "settled") {
      return "Settled";
    }

    if (normalized === "cancelled" || normalized === "canceled") {
      return "Cancelled";
    }
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length > 0) {
      return coerceStatus(keys[0]);
    }
  }

  return "Pending";
}

function bigintFromUnknown(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  if (typeof value === "string") {
    return /^\d+$/.test(value) ? BigInt(value) : BigInt(`0x${normalizeHex(value)}`);
  }

  throw new Error("Unable to decode bigint value from Soroban response.");
}

function readInvoices(): InvoiceRecord[] {
  const raw =
    typeof window === "undefined"
      ? memoryStorage.get(STORAGE_KEY) ?? null
      : window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw, reviver) as InvoiceRecord[];
  } catch {
    return [];
  }
}

function writeInvoices(invoices: InvoiceRecord[]) {
  const serialized = JSON.stringify(invoices, replacer);

  if (typeof window === "undefined") {
    memoryStorage.set(STORAGE_KEY, serialized);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, serialized);
}

function upsertInvoice(invoice: InvoiceRecord) {
  const invoices = readInvoices().filter((item) => item.id !== invoice.id);
  writeInvoices([invoice, ...invoices].sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1)));
}

function updateCachedInvoice(invoiceId: bigint, updater: (invoice: InvoiceRecord) => InvoiceRecord): InvoiceRecord | null {
  const invoices = readInvoices();
  const current = invoices.find((invoice) => invoice.id === invoiceId);
  if (!current) {
    return null;
  }

  const updated = updater(current);
  writeInvoices(invoices.map((invoice) => (invoice.id === invoiceId ? updated : invoice)));
  return updated;
}

function formatProofForContract(proof: SnarkProof) {
  return {
    a: g1PointToBytes64(proof.pi_a.slice(0, 2)),
    b: g2PointToBytes128(proof.pi_b),
    c: g1PointToBytes64(proof.pi_c.slice(0, 2)),
  };
}

function formatSignalsForContract(signals: PublicSignals) {
  return {
    commitment: fieldElemToBytes32(signals.commitment),
    lo_bound: BigInt(signals.lo_bound),
    hi_bound: BigInt(signals.hi_bound),
  };
}

function formatVerifierInputs(publicSignals: string[]) {
  return {
    inputs: publicSignals.map((signal) => BigInt(signal)),
  };
}

function simplifyErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("UnexpectedType")) {
    return "The Soroban contract rejected the settlement payload type during simulation.";
  }

  if (message.includes("invalid zk proof")) {
    return "The Soroban contract rejected this ZK proof.";
  }

  if (message.includes("MalformedVerifyingKey")) {
    return "The on-chain verification key is malformed or does not match this proof.";
  }

  return message.length > 360 ? `${message.slice(0, 360)}...` : message;
}

function mapEntry(key: string, value: StellarSdk.xdr.ScVal) {
  return new StellarSdk.xdr.ScMapEntry({
    key: StellarSdk.nativeToScVal(key, { type: "symbol" }),
    val: value,
  });
}

function structToScVal(entries: Array<[string, StellarSdk.xdr.ScVal]>) {
  return StellarSdk.xdr.scvSortedMap(entries.map(([key, value]) => mapEntry(key, value)));
}

function proofToScVal(proof: ReturnType<typeof formatProofForContract>) {
  return structToScVal([
    ["a", StellarSdk.nativeToScVal(proof.a)],
    ["b", StellarSdk.nativeToScVal(proof.b)],
    ["c", StellarSdk.nativeToScVal(proof.c)],
  ]);
}

function signalsToScVal(signals: ReturnType<typeof formatSignalsForContract>) {
  return structToScVal([
    ["commitment", StellarSdk.nativeToScVal(signals.commitment)],
    ["hi_bound", StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString(signals.hi_bound.toString()))],
    ["lo_bound", StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString(signals.lo_bound.toString()))],
  ]);
}

function verifierInputsToScVal(verifierInputs: ReturnType<typeof formatVerifierInputs>) {
  return structToScVal([
    [
      "inputs",
      StellarSdk.xdr.ScVal.scvVec(
        verifierInputs.inputs.map((input) => StellarSdk.nativeToScVal(input, { type: "u256" })),
      ),
    ],
  ]);
}

function decodeScVal(value: unknown): unknown {
  if (!value) {
    return null;
  }

  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    (typeof value === "string" && !/^[A-Za-z0-9+/=]+$/.test(value))
  ) {
    return value;
  }

  if (typeof value === "string") {
    try {
      return StellarSdk.scValToNative(StellarSdk.xdr.ScVal.fromXDR(value, "base64"));
    } catch {
      return value;
    }
  }

  try {
    return StellarSdk.scValToNative(value as StellarSdk.xdr.ScVal);
  } catch {
    return value;
  }
}

function decodeSimulationValue(simulation: unknown): unknown {
  if (!simulation || typeof simulation !== "object") {
    return null;
  }

  const candidate =
    (simulation as { result?: { retval?: unknown } }).result?.retval ??
    (simulation as { result?: { returnValue?: unknown } }).result?.returnValue ??
    (simulation as { returnValue?: unknown }).returnValue;

  return decodeScVal(candidate);
}

function decodeTransactionValue(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    return null;
  }

  const candidate = (response as { returnValue?: unknown }).returnValue;
  return decodeScVal(candidate);
}

function mapInvoiceRecord(value: unknown): InvoiceRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const invoice = value as Record<string, unknown>;
  const id = bigintFromUnknown(invoice.id);
  const payer = String(invoice.payer ?? "");
  const payee = String(invoice.payee ?? "");
  const loBound = bigintFromUnknown(invoice.lo_bound ?? invoice.loBound ?? 0);
  const hiBound = bigintFromUnknown(invoice.hi_bound ?? invoice.hiBound ?? 0);
  const status = coerceStatus(invoice.status);
  const commitment = status === "Pending" ? ZERO_COMMITMENT : commitmentBytesToDecimal(invoice.commitment);

  return {
    id,
    payer,
    payee,
    loBound,
    hiBound,
    commitment,
    status,
    createdAt: new Date().toISOString(),
  };
}

function simulationErrorMessage(simulation: unknown): string | null {
  if (!simulation || typeof simulation !== "object") {
    return null;
  }

  const error = (simulation as { error?: string }).error;
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return null;
}

async function waitForTransaction(server: StellarSdk.rpc.Server, hash: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await server.getTransaction(hash);
    if (response.status === "SUCCESS") {
      return response;
    }

    if (response.status === "FAILED") {
      throw new Error(`Soroban transaction failed on-chain for hash ${hash}.`);
    }

    await delay(1500);
  }

  throw new Error(`Timed out waiting for Soroban confirmation for transaction ${hash}.`);
}

async function signAndSendTransaction(
  server: StellarSdk.rpc.Server,
  assembled: StellarSdk.Transaction,
  signer: WalletSigner,
  address: string,
  callbacks: { onEvent?: (event: TxLifecycleEvent) => void },
) {
  emit(callbacks, { type: "TxBroadcast", message: "Awaiting wallet signature..." });

  const signedTxXdr = await signer.signTransaction(assembled.toXDR(), {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE) as StellarSdk.Transaction;
  const sendResult = await server.sendTransaction(signedTx);

  if (sendResult.status !== "PENDING" && sendResult.status !== "DUPLICATE") {
    throw new Error(`Soroban submit failed: ${JSON.stringify(sendResult)}`);
  }

  const txHash = sendResult.hash ?? signedTx.hash().toString("hex");
  emit(callbacks, { type: "TxBroadcast", message: "Transaction broadcast to Stellar testnet.", hash: txHash });

  const receipt = await waitForTransaction(server, txHash);
  emit(callbacks, { type: "TxConfirmed", message: "Transaction confirmed on Stellar testnet.", hash: txHash });

  return { hash: txHash, receipt };
}

function requireViewer(viewer?: string): string {
  if (viewer) {
    return viewer;
  }

  throw new Error("A connected Stellar address is required for live contract reads.");
}

export async function registerInvoice(
  payee: string,
  loBound: bigint,
  hiBound: bigint,
  config: RegisterConfig,
): Promise<bigint> {
  if (APP_MODE === "demo") {
    const invoices = readInvoices();
    const currentMax = invoices.reduce((max, invoice) => (invoice.id > max ? invoice.id : max), 0n);
    const id = currentMax + 1n;
    upsertInvoice({
      id,
      payer: config.payer,
      payee,
      loBound,
      hiBound,
      commitment: ZERO_COMMITMENT,
      status: "Pending",
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  emit(config, { type: "ProofSubmitting", message: "Preparing live register_invoice transaction..." });

  const server = new StellarSdk.rpc.Server(RPC_URL);
  const account = await server.getAccount(config.payer);
  const contract = new StellarSdk.Contract(CONTRACT_ID);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "register_invoice",
        StellarSdk.Address.fromString(config.payer).toScVal(),
        StellarSdk.Address.fromString(payee).toScVal(),
        StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString(loBound.toString())),
        StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString(hiBound.toString())),
      ),
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  const simError = simulationErrorMessage(simulation);
  if (simError) {
    throw new Error(`register_invoice simulation failed: ${simError}`);
  }

  const expectedId = bigintFromUnknown(decodeSimulationValue(simulation));
  const assembled = StellarSdk.rpc.assembleTransaction(tx, simulation).build();
  const { hash, receipt } = await signAndSendTransaction(server, assembled, config, config.payer, config);
  const receiptId = decodeTransactionValue(receipt);
  const invoiceId = receiptId == null ? expectedId : bigintFromUnknown(receiptId);
  const liveInvoice = await getInvoice(invoiceId, { viewer: config.payer }).catch(() => null);

  upsertInvoice(
    liveInvoice ?? {
      id: invoiceId,
      payer: config.payer,
      payee,
      loBound,
      hiBound,
      commitment: ZERO_COMMITMENT,
      status: "Pending",
      txHash: hash,
      createdAt: new Date().toISOString(),
    },
  );

  return invoiceId;
}

export async function submitProofToStellar(
  invoiceId: bigint,
  proof: unknown,
  signals: PublicSignals,
  rawPublicSignals: string[],
  config: SubmitConfig,
): Promise<string> {
  const formattedProof = formatProofForContract(proof as SnarkProof);
  const verifierInputs = formatVerifierInputs(rawPublicSignals);

  if (APP_MODE === "demo") {
    const txHash = `demo${crypto.randomUUID().replace(/-/g, "").slice(0, 48)}`;
    const updated =
      updateCachedInvoice(invoiceId, (invoice) => ({
        ...invoice,
        commitment: signals.commitment,
        status: "Settled",
        txHash,
      })) ??
      null;

    if (!updated) {
      upsertInvoice({
        id: invoiceId,
        payer: config.payer,
        payee: "",
        loBound: BigInt(signals.lo_bound),
        hiBound: BigInt(signals.hi_bound),
        commitment: signals.commitment,
        status: "Settled",
        txHash,
        createdAt: new Date().toISOString(),
      });
    }

    emit(config, { type: "TxBroadcast", message: "Demo settlement recorded locally.", hash: txHash });
    emit(config, { type: "TxConfirmed", message: "Demo settlement confirmed.", hash: txHash });
    return txHash;
  }

  emit(config, { type: "ProofSubmitting", message: "Preparing live Soroban settlement transaction..." });

  const server = new StellarSdk.rpc.Server(RPC_URL);
  const account = await server.getAccount(config.payer);
  const contract = new StellarSdk.Contract(CONTRACT_ID);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "settle_invoice",
        StellarSdk.Address.fromString(config.payer).toScVal(),
        StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString(invoiceId.toString())),
        proofToScVal(formattedProof),
        signalsToScVal(formatSignalsForContract(signals)),
        verifierInputsToScVal(verifierInputs),
      ),
    )
    .setTimeout(30)
    .build();

  emit(config, { type: "ProofSubmitting", message: "Simulating Soroban settlement..." });
  const simulation = await server.simulateTransaction(tx);
  const simError = simulationErrorMessage(simulation);
  if (simError) {
    throw new Error(`settle_invoice simulation failed: ${simplifyErrorMessage(simError)}`);
  }

  const assembled = StellarSdk.rpc.assembleTransaction(tx, simulation).build();
  const { hash } = await signAndSendTransaction(server, assembled, config, config.payer, config);
  const liveInvoice = await getInvoice(invoiceId, { viewer: config.payer }).catch(() => null);

  if (liveInvoice) {
    upsertInvoice({ ...liveInvoice, txHash: hash });
  } else {
    updateCachedInvoice(invoiceId, (invoice) => ({
      ...invoice,
      commitment: signals.commitment,
      status: "Settled",
      txHash: hash,
    }));
  }

  return hash;
}

export async function verifyDisclosure(invoiceId: bigint, amount: bigint, salt: bigint): Promise<boolean> {
  const invoice = await getInvoice(invoiceId).catch(() => null);
  if (!invoice) {
    return false;
  }

  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  const commitment = poseidon.F.toString(poseidon([amount, salt]));
  return commitment === invoice.commitment;
}

export async function getInvoice(invoiceId: bigint, config?: InvoiceLookupConfig): Promise<InvoiceRecord | null> {
  if (APP_MODE === "demo") {
    return readInvoices().find((invoice) => invoice.id === invoiceId) ?? null;
  }

  const viewer = requireViewer(config?.viewer);
  const server = new StellarSdk.rpc.Server(RPC_URL);
  const account = await server.getAccount(viewer);
  const contract = new StellarSdk.Contract(CONTRACT_ID);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_invoice", StellarSdk.nativeToScVal(invoiceId, { type: "u64" })))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  const simError = simulationErrorMessage(simulation);
  if (simError) {
    throw new Error(`get_invoice simulation failed: ${simError}`);
  }

  const decoded = decodeSimulationValue(simulation);
  const invoice = mapInvoiceRecord(decoded);
  if (!invoice) {
    return null;
  }

  const cached = readInvoices().find((item) => item.id === invoice.id);
  const merged: InvoiceRecord = {
    ...invoice,
    createdAt: cached?.createdAt ?? new Date().toISOString(),
    txHash: cached?.txHash,
  };
  upsertInvoice(merged);
  return merged;
}
