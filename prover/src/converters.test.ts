import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { g1PointToBytes64, g2PointToBytes128 } from "./converters.js";

const hex32 = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;

// SnarkJS exposes each Fp2 coordinate as [c0, c1]; Soroban's BN254 host
// encoding expects c1 || c0. Every block is a distinct byte so a missing swap
// cannot accidentally pass.
const piB = [
  [hex32(0x11), hex32(0x22)],
  [hex32(0x33), hex32(0x44)],
];

describe("g2PointToBytes128", () => {
  test("encodes each Fp2 coordinate as c1 || c0", () => {
    const bytes = g2PointToBytes128(piB);
    assert.equal(bytes.length, 128);
    // x = c1 || c0
    assert.equal(bytes[0], 0x22);
    assert.equal(bytes[31], 0x22);
    assert.equal(bytes[32], 0x11);
    assert.equal(bytes[63], 0x11);
    // y = c1 || c0
    assert.equal(bytes[64], 0x44);
    assert.equal(bytes[95], 0x44);
    assert.equal(bytes[96], 0x33);
    assert.equal(bytes[127], 0x33);
  });

  test("byte 0 is the SnarkJS c1 coordinate, not c0", () => {
    const bytes = g2PointToBytes128(piB);
    assert.notEqual(bytes[0], 0x11);
    assert.deepEqual(Array.from(bytes.slice(0, 32)), new Array(32).fill(0x22));
    assert.deepEqual(Array.from(bytes.slice(32, 64)), new Array(32).fill(0x11));
  });
});

describe("g1PointToBytes64", () => {
  test("concatenates x || y as two 32-byte blocks", () => {
    const bytes = g1PointToBytes64([hex32(0xaa), hex32(0xbb)]);
    assert.equal(bytes.length, 64);
    assert.deepEqual(Array.from(bytes.slice(0, 32)), new Array(32).fill(0xaa));
    assert.deepEqual(Array.from(bytes.slice(32, 64)), new Array(32).fill(0xbb));
  });

  test("left-pads short hex coordinates to 32 bytes", () => {
    const bytes = g1PointToBytes64(["0x1", "0x2"]);
    assert.equal(bytes.length, 64);
    assert.deepEqual(Array.from(bytes.slice(0, 31)), new Array(31).fill(0));
    assert.equal(bytes[31], 0x01);
    assert.deepEqual(Array.from(bytes.slice(32, 63)), new Array(31).fill(0));
    assert.equal(bytes[63], 0x02);
  });
});
