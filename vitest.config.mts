import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests for the pure arithmetic under lib/. Everything covered here is
// deterministic and dependency-free, so the environment is plain node: no
// jsdom, no React, no network, no mocks. Integration against the live APIs
// stays in scripts/*.mts, which is a different job with different guarantees.
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json so a test can import the way the
    // app does. The modules under test use relative imports today; this keeps
    // that from becoming a reason not to test something later.
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
