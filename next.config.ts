import type { NextConfig } from "next";

import { describeRpc, resolveSolanaRpcUrl } from "./lib/solana/rpc-url";

// Pick the Solana RPC once, at config load, from whatever the environment
// holds. A Helius credential under any HELIUS-named variable beats
// NEXT_PUBLIC_SOLANA_RPC_URL; see lib/solana/rpc-url.ts for why. Values under
// `env` are inlined into both bundles after the .env.local NEXT_PUBLIC_ set,
// so this is what the two read sites (lib/privy/provider.tsx and
// lib/solana/balances.ts) actually see.
const rpc = resolveSolanaRpcUrl(process.env);
if (rpc) {
  console.log(describeRpc(rpc));
}

const nextConfig: NextConfig = {
  // Hide the on-screen Next.js dev tools indicator (the floating "N" badge that
  // turns red on build/runtime errors). Dev-only UI; off for presentations.
  devIndicators: false,
  env: rpc ? { NEXT_PUBLIC_SOLANA_RPC_URL: rpc.url } : {},
};

export default nextConfig;
