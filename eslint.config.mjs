import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // TradingView's own type definitions, vendored verbatim.
    "lib/charts/vendor/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, not ours. public/lighter/wasm_exec.js is the Go toolchain's
    // own WASM bridge, shipped beside the lighter main.wasm it loads. Linting
    // generated third-party output produces findings nobody can act on without
    // diverging from upstream.
    "public/**",
  ]),
]);

export default eslintConfig;
