import type { NextConfig } from "next";

// Security headers, and in particular a Content Security Policy.
//
// The policy matters more here than in a typical app because of one line in
// lib/privy/provider.tsx: `showWalletUIs: false`. There is no per-transaction
// wallet confirmation, by design, so a script that reaches the embedded wallet
// signs silently with nothing prompting the user. The CSP is what stops a
// script getting there, and `connect-src` is what stops it sending anything
// out if it does.
//
// **Shipped in report-only mode.** A wrong policy breaks login outright rather
// than degrading, and the Privy modal, WalletConnect and the funding sheet each
// pull in origins that are easier to observe than to predict. Set
// CSP_ENFORCE=1 to switch to the enforcing header once the browser console is
// clean through login, a swap, a hedge and the first-position funding flow.

// The browser talks to the Solana RPC directly (lib/solana/balances.ts opens
// the Connection, lib/privy/provider.tsx opens a subscription over ws), so its
// origin has to be in connect-src on both schemes.
//
// There are two endpoints, not one. The primary serves every read; the fallback
// serves getProgramAccounts (lib/solana/program-accounts.ts) and every
// websocket subscription (lib/privy/provider.tsx), neither of which the primary
// will answer. Both are reached from the browser, so both belong here.
//
// Only the origin goes in the header. Alchemy, Helius and Triton all carry the
// API key in the path or query, and CSP source expressions are matched on
// origin anyway, so stripping it here keeps the key out of a response header
// without costing anything.
function solanaRpcOrigins(): string[] {
  const origins = new Set<string>();
  for (const raw of [
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL,
  ]) {
    if (!raw) continue;
    try {
      const { origin, host } = new URL(raw);
      origins.add(origin);
      origins.add(`wss://${host}`);
    } catch {
      // A malformed URL contributes nothing rather than failing the build. The
      // app throws on its own if the primary is unusable.
    }
  }
  return [...origins];
}

// Baseline is Privy's own recommendation
// (docs.privy.io/security/implementation-guide/content-security-policy),
// extended for the two things this app does that theirs does not assume.
//
// Re-check it against that page on every Privy SDK upgrade. Privy warns that
// the required origins move between versions, and the failure mode is a login
// modal that renders blank rather than an error anyone would notice in CI.
function contentSecurityPolicy(): string {
  const rpc = solanaRpcOrigins();

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // 'wasm-unsafe-eval' is for the Lighter signer. lib/lighter/signer.ts
    // instantiates public/lighter/main.wasm, and WebAssembly.instantiate is
    // blocked by any restrictive script-src without it. Dropping this does not
    // fail loudly: the hedge and Perps tabs stop being able to sign while the
    // rest of the app keeps working.
    //
    // 'unsafe-inline' is for Next itself, which inlines the RSC payload
    // bootstrap as <script>self.__next_f.push(...)</script>. Removing it means
    // a per-request nonce, which means middleware. That is deliberately not
    // done yet: the Next version in package.json carries a middleware bypass
    // advisory, so the nonce work belongs after that bump rather than before
    // it. Note that 'unsafe-inline' still forbids loading script from another
    // origin, and connect-src below still forbids sending anything to one, so
    // the exfiltration half of the policy is unaffected by this concession.
    // s3.tradingview.com serves the advanced-chart embed script that
    // components/TradingViewChart.tsx inserts; the chart itself is an iframe
    // from the widget origins in frame-src below. Nothing else on the page
    // talks to TradingView, so connect-src is unchanged.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      "https://challenges.cloudflare.com",
      "https://s3.tradingview.com",
    ],

    // Tailwind and the Base UI components set style attributes at runtime.
    "style-src": ["'self'", "'unsafe-inline'"],

    // Every logo in this repo is self-hosted on purpose (see the note at the
    // top of lib/tokens/logos.ts), so no remote image origin is needed. blob:
    // covers the QR code the receive widget renders.
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],

    "frame-src": [
      "https://auth.privy.io",
      "https://verify.walletconnect.com",
      "https://verify.walletconnect.org",
      "https://challenges.cloudflare.com",
      "https://s.tradingview.com",
      "https://www.tradingview-widget.com",
      "https://www.tradingview.com",
    ],
    "child-src": [
      "https://auth.privy.io",
      "https://verify.walletconnect.com",
      "https://verify.walletconnect.org",
    ],

    // 'self' covers every third-party API, because they are all reached
    // through our own route handlers so the keys stay server-side. The two
    // exceptions are Privy's own infrastructure and the Solana RPC, which the
    // browser holds a connection to directly.
    //
    // WalletConnect and walletlink are here because the login modal offers
    // those connectors (appearance.walletList in lib/privy/provider.tsx). They
    // are only used by a user signing in with an external wallet.
    "connect-src": [
      "'self'",
      "https://auth.privy.io",
      "https://*.rpc.privy.systems",
      "https://explorer-api.walletconnect.com",
      "wss://relay.walletconnect.com",
      "wss://relay.walletconnect.org",
      "wss://www.walletlink.org",
      ...rpc,
    ],

    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],

    // Nothing embeds this app. Clickjacking a wallet UI whose transactions
    // carry no confirmation modal is worth closing off explicitly.
    "frame-ancestors": ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

const nextConfig: NextConfig = {
  // Hide the on-screen Next.js dev tools indicator (the floating "N" badge that
  // turns red on build/runtime errors). Dev-only UI; off for presentations.
  devIndicators: false,

  async headers() {
    const csp = contentSecurityPolicy();
    const enforce = process.env.CSP_ENFORCE === "1";

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: enforce
              ? "Content-Security-Policy"
              : "Content-Security-Policy-Report-Only",
            value: csp,
          },
          // Referrer is suppressed cross-origin. Wallet addresses and asset
          // symbols show up in this app's paths and query strings, and there is
          // no third party that needs to be told which page a user came from.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Redundant with frame-ancestors above, and kept for browsers that
          // enforce only the older header.
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
