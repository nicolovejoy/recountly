import { defineConfig } from "vitest/config";

// Pure-function unit tests only (no DOM). Node environment keeps it fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
