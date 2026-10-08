import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvoiceForm, isValidStellarAddress, parseUsdToCents } from "./InvoiceForm";

// These fixtures exercise the existing format check, not StrKey checksum validation.
const account = `G${"A".repeat(55)}`;
const muxedAccount = `M${"2".repeat(68)}`;

afterEach(cleanup);

describe("isValidStellarAddress", () => {
  it.each([account, muxedAccount, ` \n${account}\t `])("accepts supported address format %s", (value) => {
    expect(isValidStellarAddress(value)).toBe(true);
  });

  it.each([
    "", `G${"A".repeat(54)}`, `G${"A".repeat(56)}`,
    `M${"A".repeat(67)}`, `M${"A".repeat(69)}`,
    account.toLowerCase(), `G${"A".repeat(54)}0`, `G${"A".repeat(54)}1`,
    `G${"A".repeat(54)}8`, `G${"A".repeat(54)}9`,
    `M${"2".repeat(67)}!`, `S${"A".repeat(55)}`, `G${"A".repeat(27)} ${"A".repeat(27)}`,
  ])("rejects unsupported address format %s", (value) => {
    expect(isValidStellarAddress(value)).toBe(false);
  });
});

describe("parseUsdToCents", () => {
  it.each([
    ["100.00", 10000n], ["0", 0n], ["0.00", 0n], ["0.01", 1n],
    ["123.45", 12345n], ["500", 50000n],
  ])("parses %s into exactly %s cents", (value, cents) => {
    expect(parseUsdToCents(value)).toBe(cents);
  });

  it.each(["-1", "-0.01", "abc", "100usd", "NaN", "Infinity", "-Infinity", "1e309"])(
    "rejects invalid USD input %s", (value) => {
      expect(parseUsdToCents(value)).toBeNull();
    },
  );
});

function fillForm(payee: string, lower = "100.00", upper = "500.00") {
  fireEvent.change(screen.getByRole("textbox", { name: /Payee Stellar address/ }), { target: { value: payee } });
  fireEvent.change(screen.getByRole("textbox", { name: "Lower bound (USD)" }), { target: { value: lower } });
  fireEvent.change(screen.getByRole("textbox", { name: "Upper bound (USD)" }), { target: { value: upper } });
  fireEvent.click(screen.getByRole("button", { name: "Register invoice" }));
}

describe("InvoiceForm submission", () => {
  it.each([account, muxedAccount])("submits trimmed %s with exact bigint bounds", async (payee) => {
    const onRegister = vi.fn().mockResolvedValue(42n);
    render(<InvoiceForm onRegister={onRegister} />);
    fillForm(` ${payee} `, "0", "100.00");

    expect(onRegister).toHaveBeenCalledExactlyOnceWith(payee, 0n, 10000n);
    expect((await screen.findByText("Invoice #42 registered for $0.00 to $100.00.")).textContent)
      .toBe("Invoice #42 registered for $0.00 to $100.00.");
    expect((screen.getByRole("textbox", { name: /Payee Stellar address/ }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Register invoice" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ["invalid", "100", "500", "Payee address is not a valid Stellar address."],
    [account, "-1", "500", "Enter valid USD amounts for both bounds."],
    [account, "100", "abc", "Enter valid USD amounts for both bounds."],
    [account, "abc", "500", "Enter valid USD amounts for both bounds."],
    [account, "100", "-1", "Enter valid USD amounts for both bounds."],
    [account, "100", "100", "The upper bound must be higher than the lower bound."],
    [account, "101", "100", "The upper bound must be higher than the lower bound."],
  ])("rejects payee=%s lower=%s upper=%s", (payee, lower, upper, error) => {
    const onRegister = vi.fn();
    render(<InvoiceForm onRegister={onRegister} />);
    fillForm(payee, lower, upper);
    expect(screen.getByText(error).textContent).toBe(error);
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("disables submission while pending and restores it after failure, then permits retry", async () => {
    let rejectRegistration!: (reason: Error) => void;
    const pending = new Promise<bigint>((_, reject) => { rejectRegistration = reject; });
    const onRegister = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(7n);
    render(<InvoiceForm onRegister={onRegister} />);
    fillForm(account);
    const pendingButton = screen.getByRole("button", { name: "Registering..." }) as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(pendingButton);
    expect(onRegister).toHaveBeenCalledTimes(1);

    await act(async () => { rejectRegistration(new Error("Registration failed")); });
    expect(screen.getByText("Registration failed").textContent).toBe("Registration failed");
    expect((screen.getByRole("button", { name: "Register invoice" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Register invoice" }));
    await screen.findByText("Invoice #7 registered for $100.00 to $500.00.");
    expect(screen.queryByText("Registration failed")).toBeNull();
    expect(onRegister).toHaveBeenCalledTimes(2);
    expect(onRegister).toHaveBeenNthCalledWith(2, account, 10000n, 50000n);
  });

  it("reports the fallback for a non-Error rejection and restores submission", async () => {
    const onRegister = vi.fn().mockRejectedValue("non-Error rejection");
    render(<InvoiceForm onRegister={onRegister} />);
    fillForm(account);
    expect((await screen.findByText("Unable to register invoice.")).textContent).toBe("Unable to register invoice.");
    expect((screen.getByRole("button", { name: "Register invoice" }) as HTMLButtonElement).disabled).toBe(false);
    expect(onRegister).toHaveBeenCalledExactlyOnceWith(account, 10000n, 50000n);
  });
});
