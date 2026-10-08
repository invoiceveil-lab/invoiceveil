declare module "snarkjs";
declare module "circomlibjs";

interface ImportMetaEnv {
  readonly BASE_URL?: string;
  readonly VITE_CONTRACT_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_NETWORK_PASSPHRASE?: string;
  readonly VITE_INVOICEVEIL_MODE?: "demo" | "live";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
