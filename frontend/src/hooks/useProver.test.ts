import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProver } from "./useProver";

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    MockWorker.instances.push(this);
  }
}

function emit(data: unknown) {
  const worker = MockWorker.instances[MockWorker.instances.length - 1];
  act(() => {
    worker.onmessage?.({ data } as MessageEvent);
  });
}

describe("useProver worker messages", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  it("ignores an unknown message type instead of reporting an error", () => {
    const { result } = renderHook(() => useProver());

    emit({ type: "SOME_FUTURE_MESSAGE" });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("does not throw for a message without a payload", () => {
    const { result } = renderHook(() => useProver());

    expect(() => emit({ type: "PROOF_ERROR" })).not.toThrow();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Proof generation failed.");
  });

  it("surfaces the message from a PROOF_ERROR message", () => {
    const { result } = renderHook(() => useProver());

    emit({ type: "PROOF_ERROR", payload: { message: "boom" } });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("boom");
  });
});
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProver } from "./useProver";

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    MockWorker.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  MockWorker.instances = [];
  vi.stubGlobal("Worker", MockWorker);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useProver", () => {
  it("updates progress when the worker reports progress", () => {
    const { result } = renderHook(() => useProver());
    const worker = MockWorker.instances[0];

    act(() => {
      worker.emit({ type: "PROOF_PROGRESS", payload: { step: 2, message: "Generating ZK proof..." } });
    });

    expect(result.current.status).toBe("computing");
    expect(result.current.progress).toEqual({ step: 2, message: "Generating ZK proof..." });
  });

  it("sets the exact ready state and final progress on PROOF_READY", () => {
    const { result } = renderHook(() => useProver());
    const worker = MockWorker.instances[0];
    const payload = {
      proof: { a: { x: "1", y: "2" } },
      publicSignals: { commitment: "0xabc", lo_bound: "100", hi_bound: "100000" },
      rawPublicSignals: ["1", "2"],
      salt: "42",
    };

    act(() => {
      worker.emit({ type: "PROOF_READY", payload });
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.proof).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toEqual({ step: 4, message: "Proof ready." });
  });

  it("does not throw when the worker posts an unknown message", () => {
    const { result } = renderHook(() => useProver());
    const worker = MockWorker.instances[0];

    expect(() => {
      act(() => {
        worker.emit({ type: "UNKNOWN" });
      });
    }).not.toThrow();

    expect(result.current.status).toBe("error");
  });

  it("surfaces a worker proof error message", () => {
    const { result } = renderHook(() => useProver());
    const worker = MockWorker.instances[0];

    act(() => {
      worker.emit({ type: "PROOF_ERROR", payload: { message: "Proof generation failed." } });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Proof generation failed.");
  });

  it("posts the stringified bounds when proving", () => {
    const { result } = renderHook(() => useProver());
    const worker = MockWorker.instances[0];

    act(() => {
      result.current.prove(25000n, 100n, 100000n);
    });

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "PROVE",
      payload: { amount: "25000", loBound: "100", hiBound: "100000" },
    });
  });

  it("terminates the worker on unmount", () => {
    const { unmount } = renderHook(() => useProver());
    const worker = MockWorker.instances[0];

    unmount();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
