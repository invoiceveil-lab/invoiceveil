import { describe, expect, it } from "vitest";

import { formatMoney, formatMoneyWhole } from "./format";

describe("formatMoney", () => {
  it("formats an integer number of cents as USD", () => {
    expect(formatMoney(25000n)).toBe("$250.00");
    expect(formatMoney(0n)).toBe("$0.00");
    expect(formatMoney(123456789n)).toBe("$1,234,567.89");
    expect(formatMoney(-25000n)).toBe("-$250.00");
  });

  it("keeps full precision for amounts above 2^53", () => {
    expect(formatMoney(9007199254740993n)).toBe("$90,071,992,547,409.93");
    expect(formatMoneyWhole(9007199254740993n)).toBe("$90,071,992,547,409");
  });
});

describe("formatMoneyWhole", () => {
  it("drops the cents part without rounding the dollars", () => {
    expect(formatMoneyWhole(25099n)).toBe("$250");
  });
});
