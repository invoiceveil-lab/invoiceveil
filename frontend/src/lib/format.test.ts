import { describe, expect, it } from "vitest";

import { explorerUrl, formatMoney, statusTone, truncateMiddle } from "./format";

describe("formatMoney", () => {
  it("renders zero as $0.00", () => {
    expect(formatMoney(0n)).toBe("$0.00");
  });

  it("converts bigint cents into a two-decimal dollar string", () => {
    expect(formatMoney(1234n)).toBe("$12.34");
    expect(formatMoney(5n)).toBe("$0.05");
    expect(formatMoney(100000n)).toBe("$1,000.00");
  });

  it("always keeps exactly two fraction digits", () => {
    for (const cents of [0n, 100n, 25000n, 99900n]) {
      expect(formatMoney(cents)).toMatch(/\.\d{2}$/);
    }
  });
});

describe("truncateMiddle", () => {
  it("returns the value unchanged at the boundary length", () => {
    const boundary = "a".repeat(13); // head (6) + tail (4) + 3
    expect(truncateMiddle(boundary)).toBe(boundary);
  });

  it("truncates the middle one character past the boundary", () => {
    expect(truncateMiddle("abcdefghijklmn")).toBe("abcdef...klmn");
  });

  it("honours custom head and tail lengths", () => {
    const boundary = "x".repeat(11); // head (4) + tail (4) + 3
    expect(truncateMiddle(boundary, 4, 4)).toBe(boundary);
    expect(truncateMiddle("0x1234567890", 4, 4)).toBe("0x12...7890");
  });
});

describe("statusTone", () => {
  it("maps every invoice status to its tone class", () => {
    expect(statusTone("Settled")).toBe("status-settled");
    expect(statusTone("Cancelled")).toBe("status-cancelled");
    expect(statusTone("Pending")).toBe("status-pending");
  });
});

describe("explorerUrl", () => {
  it("builds the testnet transaction explorer link", () => {
    expect(explorerUrl("abc123")).toBe("https://stellar.expert/explorer/testnet/tx/abc123");
  });
});
