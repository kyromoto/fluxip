import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/contract/**/*.test.ts"],
    passWithNoTests: true,
    // Integration tests share one real Redis instance and register BullMQ
    // Workers on fixed, production-named queues (by design — see queue.ts).
    // Running test files in parallel would let two files' workers race over
    // the same queue at once; each file's beforeAll/afterAll already assumes
    // exclusive ownership while it runs.
    fileParallelism: false,
  },
});
