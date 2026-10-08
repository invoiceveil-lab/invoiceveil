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
