// Demo settlements have no real Stellar transaction, so the whole app relies on
// this single helper to mint a recognisable placeholder hash. Real Stellar
// transaction hashes are 64 lowercase hex characters, so the `demo` prefix is
// what lets the UI tell the two apart (see `isDemoTxHash`).
const DEMO_HASH_PREFIX = "demo";

export function createDemoTxHash(): string {
  return `${DEMO_HASH_PREFIX}${crypto.randomUUID().replace(/-/g, "").slice(0, 48)}`;
}

export function isDemoTxHash(hash: string): boolean {
  return hash.startsWith(DEMO_HASH_PREFIX);
}
