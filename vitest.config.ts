import { defineConfig } from "vitest/config";

// Pure-function unit tests only (no DOM). Node environment keeps it fast.
export default defineConfig({
  test: {
    environment: "node",
    // src holds the app's pure logic; scripts holds one-off tools whose pure
    // parsers are unit-tested alongside (e.g. the journal markdown importer).
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
