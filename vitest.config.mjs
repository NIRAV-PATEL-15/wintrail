import { defineConfig } from "vitest/config";

// hash-wasm's WebAssembly is tiered up on V8 background threads; Node can deadlock while exiting with such a
// compile job pending (observed: worker main thread stuck in futex after all tests passed). Liftoff-only avoids it.
export default defineConfig({
  test: {
    pool: "forks",
    execArgv: ["--no-wasm-tier-up"],
    teardownTimeout: 5000,
  },
});
