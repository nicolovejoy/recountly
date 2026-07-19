import path from "node:path";
import { defineConfig } from "vitest/config";

// Pure-function unit tests + route-level integration tests (no DOM).
// Node environment keeps it fast.
export default defineConfig({
  // Route handlers import via the `@/*` alias (tsconfig paths); vitest needs
  // its own mapping to resolve them.
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    // src holds the app's pure logic; scripts holds one-off tools whose pure
    // parsers are unit-tested alongside (e.g. the journal markdown importer).
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
