import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const kitMocks = vi.hoisted(() => ({
  init: vi.fn(),
  setNetwork: vi.fn(),
  setWallet: vi.fn(),
  fetchAddress: vi.fn(),
  authModal: vi.fn(),
  signTransaction: vi.fn(),
  disconnect: vi.fn(),
}));

const freighterMocks = vi.hoisted(() => ({ FreighterModule: vi.fn() }));

const submitMocks = vi.hoisted(() => ({
  getInvoice: vi.fn(),
  registerInvoice: vi.fn(),
  submitProofToStellar: vi.fn(),
  verifyDisclosure: vi.fn(),
}));

const circomMocks = vi.hoisted(() => ({ buildPoseidon: vi.fn() }));

vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({ StellarWalletsKit: kitMocks }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
  FREIGHTER_ID: "freighter",
  FreighterModule: freighterMocks.FreighterModule,
}));
vi.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  Networks: { TESTNET: "TESTNET", PUBLIC: "PUBLIC", FUTURENET: "FUTURENET" },
}));
vi.mock("circomlibjs", () => ({ buildPoseidon: circomMocks.buildPoseidon }));
vi.mock("../../../prover/src/stellar_submit", () => submitMocks);

const WALLET_KEY = "invoiceveil-wallet-address";

async function loadUseStellar() {
  vi.resetModules();
  const mod = await import("./useStellar");
  return mod.useStellar;
}

function stubHorizon() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [{ asset_type: "native", balance: "12.5" }] }),
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  window.localStorage.clear();
});

describe("useStellar demo mode", () => {
  it("never touches the wallet kit and restores the saved demo address", async () => {
    vi.stubEnv("VITE_INVOICEVEIL_MODE", "demo");
    window.localStorage.setItem(WALLET_KEY, "GDEMOADDRESS");
    const useStellar = await loadUseStellar();
    const { result } = renderHook(() => useStellar());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.mode).toBe("demo");
    expect(result.current.address).toBe("GDEMOADDRESS");

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.isConnected).toBe(true);
    expect(kitMocks.init).not.toHaveBeenCalled();
    expect(kitMocks.fetchAddress).not.toHaveBeenCalled();
    expect(kitMocks.authModal).not.toHaveBeenCalled();
    expect(kitMocks.setWallet).not.toHaveBeenCalled();
    expect(kitMocks.setNetwork).not.toHaveBeenCalled();
  });
});

describe("useStellar live mode", () => {
  it("restores a saved address through the wallet kit", async () => {
    vi.stubEnv("VITE_INVOICEVEIL_MODE", "live");
    window.localStorage.setItem(WALLET_KEY, "GSAVEDADDRESS");
    kitMocks.fetchAddress.mockResolvedValue({ address: "GRESTOREDADDRESS" });
    stubHorizon();

    const useStellar = await loadUseStellar();
    const { result } = renderHook(() => useStellar());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(kitMocks.fetchAddress).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.address).toBe("GRESTOREDADDRESS"));
    expect(result.current.isConnected).toBe(true);
    expect(window.localStorage.getItem(WALLET_KEY)).toBe("GRESTOREDADDRESS");
  });

  it("clears the stored address when the restore fails", async () => {
    vi.stubEnv("VITE_INVOICEVEIL_MODE", "live");
    window.localStorage.setItem(WALLET_KEY, "GSAVEDADDRESS");
    kitMocks.fetchAddress.mockRejectedValue(new Error("wallet locked"));
    stubHorizon();

    const useStellar = await loadUseStellar();
    const { result } = renderHook(() => useStellar());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    await waitFor(() => expect(window.localStorage.getItem(WALLET_KEY)).toBeNull());
    expect(result.current.address).toBe("");
    expect(result.current.isConnected).toBe(false);
  });

  it("throws the exact guard message when registering live without an address", async () => {
    vi.stubEnv("VITE_INVOICEVEIL_MODE", "live");
    const useStellar = await loadUseStellar();
    const { result } = renderHook(() => useStellar());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.address).toBe("");

    await expect(result.current.registerInvoice("GPAYEE", 1n, 2n)).rejects.toThrow(
      "Connect a Stellar testnet wallet before registering an invoice.",
    );
    expect(submitMocks.registerInvoice).not.toHaveBeenCalled();
  });
});
