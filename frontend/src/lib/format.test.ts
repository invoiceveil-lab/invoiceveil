import { describe, expect, it } from "vitest";

import { explorerUrl } from "./format";

describe("explorerUrl", () => {
  it("links real Stellar transaction hashes", () => {
    const hash = "a".repeat(64);

    expect(explorerUrl(hash)).toBe(`https://stellar.expert/explorer/testnet/tx/${hash}`);
  });

  it("returns null for demo hashes so they are not rendered as explorer links", () => {
    expect(explorerUrl("demo1234567890abcdef")).toBeNull();
  });
});
