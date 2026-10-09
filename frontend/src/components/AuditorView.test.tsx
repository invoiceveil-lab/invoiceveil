import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditorView } from "./AuditorView";

afterEach(cleanup);

function fillAndSubmit(salt: string, amount = "250.00") {
  fireEvent.change(screen.getByRole("textbox", { name: /Amount \(USD\)/ }), { target: { value: amount } });
  fireEvent.change(screen.getByRole("textbox", { name: /Salt \(hex\)/ }), { target: { value: salt } });
  fireEvent.click(screen.getByRole("button", { name: "Verify disclosure" }));
}

describe("AuditorView salt parsing", () => {
  it.each(["0x2a", "2a"])("parses the %s salt spelling to the same bigint", async (salt) => {
    const onVerify = vi.fn().mockResolvedValue(true);
    render(<AuditorView onVerify={onVerify} />);
    fillAndSubmit(salt);

    await screen.findByText("Confirmed - Invoice #1 amount matches commitment.");
    expect(onVerify).toHaveBeenCalledExactlyOnceWith(1n, 25000n, 42n);
  });

  it("reports a failed match without rethrowing", async () => {
    const onVerify = vi.fn().mockResolvedValue(false);
    render(<AuditorView onVerify={onVerify} />);
    fillAndSubmit("0x2a");

    expect((await screen.findByText("Amount or salt does not match the stored commitment.")).textContent).toBe(
      "Amount or salt does not match the stored commitment.",
    );
  });
});

describe("AuditorView input errors", () => {
  it("shows a caught error for an empty salt instead of crashing", async () => {
    const onVerify = vi.fn().mockResolvedValue(true);
    render(<AuditorView onVerify={onVerify} />);
    fillAndSubmit("");

    const error = await screen.findByText(/Cannot convert 0x to a BigInt/);
    expect(error.textContent).toContain("0x");
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric amount before calling onVerify", async () => {
    const onVerify = vi.fn().mockResolvedValue(true);
    render(<AuditorView onVerify={onVerify} />);
    fillAndSubmit("0x2a", "abc");

    expect((await screen.findByText("Enter a valid USD amount.")).textContent).toBe("Enter a valid USD amount.");
    expect(onVerify).not.toHaveBeenCalled();
  });
});
