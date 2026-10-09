import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const prover = vi.hoisted(() => ({
  prove: vi.fn(),
  reset: vi.fn(),
  emitProof: null as ((proof: unknown) => void) | null,
}));

vi.mock("../hooks/useProver", async () => {
  const React = await import("react");
  return {
    useProver: () => {
      const [proof, setProof] = React.useState<unknown>(null);
      prover.emitProof = setProof;
      return {
        prove: prover.prove,
        status: "idle" as const,
        proof,
        error: null,
        progress: null,
        reset: prover.reset,
      };
    },
  };
});

import type { InvoiceRecord } from "../types";
import { SettleInvoice } from "./SettleInvoice";

afterEach(cleanup);

const invoice: InvoiceRecord = {
  id: 1n,
  payer: "GPAYER",
  payee: "GPAYEE",
  loBound: 10000n,
  hiBound: 50000n,
  commitment: `0x${"0".repeat(64)}`,
  status: "Pending",
  createdAt: new Date(0).toISOString(),
};

const invoiceLookup = () => invoice;

function setAmount(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /Actual amount \(private\)/ }), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Start proof flow" }));
}

describe("SettleInvoice amount validation", () => {
  it("shows the range error and never settles an out-of-range amount", () => {
    const onSettle = vi.fn();
    render(<SettleInvoice invoiceLookup={invoiceLookup} onSettle={onSettle} />);
    setAmount("1000");
    submit();

    expect(screen.getByText("Amount must stay between $100.00 and $500.00.").textContent).toBe(
      "Amount must stay between $100.00 and $500.00.",
    );
    expect(onSettle).not.toHaveBeenCalled();
    expect(prover.prove).not.toHaveBeenCalled();
  });

  it("proves the exact cents for a valid amount", () => {
    const onSettle = vi.fn();
    render(<SettleInvoice invoiceLookup={invoiceLookup} onSettle={onSettle} />);
    setAmount("250.00");
    submit();

    expect(prover.prove).toHaveBeenCalledExactlyOnceWith(25000n, 10000n, 50000n);
    expect(onSettle).not.toHaveBeenCalled();
  });
});

describe("SettleInvoice proof submission", () => {
  it("submits a completed proof to onSettle exactly once", async () => {
    const onSettle = vi.fn().mockResolvedValue("txhash");
    render(<SettleInvoice invoiceLookup={invoiceLookup} onSettle={onSettle} />);
    setAmount("250.00");
    submit();

    const readyProof = {
      proof: { pi_a: ["0x1"], pi_b: [["0x2", "0x3"]], pi_c: ["0x4"] },
      publicSignals: { commitment: "0xabc", lo_bound: "10000", hi_bound: "50000" },
      rawPublicSignals: ["10000", "50000", "0xabc"],
      salt: "5",
    };

    await act(async () => {
      prover.emitProof?.(readyProof);
    });

    expect(onSettle).toHaveBeenCalledExactlyOnceWith(1n, readyProof);
    expect((await screen.findByText(/Invoice settled. Transaction hash: txhash/)).textContent).toContain("txhash");
  });

  it("shows the rejection message when settlement fails", async () => {
    const onSettle = vi.fn().mockRejectedValue(new Error("settle_invoice simulation failed"));
    render(<SettleInvoice invoiceLookup={invoiceLookup} onSettle={onSettle} />);
    setAmount("250.00");
    submit();

    await act(async () => {
      prover.emitProof?.({
        proof: {},
        publicSignals: { commitment: "0x1", lo_bound: "10000", hi_bound: "50000" },
        rawPublicSignals: ["10000", "50000", "0x1"],
        salt: "5",
      });
    });

    expect((await screen.findByText("settle_invoice simulation failed")).textContent).toBe(
      "settle_invoice simulation failed",
    );
  });
});
