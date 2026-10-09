import { useEffect, useRef, useState } from "react";

import type { ProgressState, ProofReadyPayload } from "../types";

type Status = "idle" | "computing" | "ready" | "error";

type WorkerMessage =
  | { type: "PROOF_PROGRESS"; payload: ProgressState }
  | { type: "PROOF_READY"; payload: ProofReadyPayload }
  | { type: "PROOF_ERROR"; payload: { message: string } };

export function useProver() {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [proof, setProof] = useState<ProofReadyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/prover.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;

      switch (message?.type) {
        case "PROOF_PROGRESS":
          setStatus("computing");
          setProgress(message.payload);
          return;

        case "PROOF_READY":
          setStatus("ready");
          setProof(message.payload);
          setError(null);
          setProgress({ step: 4, message: "Proof ready." });
          return;

        case "PROOF_ERROR":
          setStatus("error");
          setError(message.payload?.message ?? "Proof generation failed.");
          return;

        default:
          // Unknown or forward-compatible worker messages must not be treated
          // as proof failures: ignore them instead of assuming an error.
          return;
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const prove = (amount: bigint, loBound: bigint, hiBound: bigint) => {
    setStatus("computing");
    setProof(null);
    setError(null);
    setProgress({ step: 1, message: "Validating invoice bounds..." });
    workerRef.current?.postMessage({
      type: "PROVE",
      payload: {
        amount: amount.toString(),
        loBound: loBound.toString(),
        hiBound: hiBound.toString(),
      },
    });
  };

  const reset = () => {
    setStatus("idle");
    setProof(null);
    setError(null);
    setProgress(null);
  };

  return { prove, status, proof, error, progress, reset };
}
