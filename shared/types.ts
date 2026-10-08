export interface Bn254G1Point {
  x: string;
  y: string;
}

export interface Bn254G2Point {
  x: [string, string];
  y: [string, string];
}

export interface ContractProof {
  a: Bn254G1Point;
  b: Bn254G2Point;
  c: Bn254G1Point;
}

export interface PublicSignals {
  commitment: string;
  lo_bound: string;
  hi_bound: string;
}

export interface VerifierInputs {
  inputs: string[];
}

export type InvoiceStatus = "Pending" | "Settled" | "Cancelled";

export interface InvoiceRecord {
  id: bigint;
  payer: string;
  payee: string;
  loBound: bigint;
  hiBound: bigint;
  commitment: string;
  status: InvoiceStatus;
  txHash?: string;
  createdAt: string;
}

export interface TxLifecycleEvent {
  type: "ProofSubmitting" | "AwaitingSignature" | "TxBroadcast" | "TxConfirmed" | "TxFailed";
  message: string;
  hash?: string;
}

export type InvoiceVeilMode = "demo" | "live";
