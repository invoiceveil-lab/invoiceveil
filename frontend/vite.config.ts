import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `base` can be overridden for sub-path deployments, for example
// VITE_BASE_PATH=/invoiceveil/. Vite exposes the resolved value to the app as
// `import.meta.env.BASE_URL`, which the prover worker uses to locate its wasm
// and zkey artifacts.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? "/",
  build: { outDir: "build" },
});
