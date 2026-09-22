// The chains the two embedded wallets cover, as one list both the send and the
// receive widget draw from.
//
// Receiving works on every entry, because an address is an address and nothing
// has to be signed to be paid. Sending does not: `sendEnabled` marks the chains
// with a send path today, which is Solana alone. Keeping that as a field rather
// than as two registries means the two widgets cannot drift into showing
// different chains, and the day an EVM send lands it is one flag.
//
// Every evmChainId here is declared in `supportedChains` in
// lib/privy/provider.tsx. Privy signs only on chains declared there, so an
// entry missing from that list would fail at signing rather than here.

export interface WalletChain {
  id: "solana" | "ethereum" | "base" | "bsc" | "monad";
  label: string;
  logo: string;
  // Which embedded wallet the chain belongs to. Privy provisions both on
  // login, and every EVM chain shares one 0x address.
  wallet: "solana" | "evm";
  evmChainId?: number;
  sendEnabled: boolean;
}

export const WALLET_CHAINS: WalletChain[] = [
  {
    id: "solana",
    label: "Solana",
    logo: "/logos/solana.png",
    wallet: "solana",
    sendEnabled: true,
  },
  {
    id: "ethereum",
    label: "Ethereum",
    logo: "/logos/eth.png",
    wallet: "evm",
    evmChainId: 1,
    sendEnabled: false,
  },
  {
    id: "base",
    label: "Base",
    logo: "/logos/base.svg",
    wallet: "evm",
    evmChainId: 8453,
    sendEnabled: false,
  },
  {
    id: "bsc",
    label: "BNB Chain",
    logo: "/logos/bnb.png",
    wallet: "evm",
    evmChainId: 56,
    sendEnabled: false,
  },
  {
    id: "monad",
    label: "Monad",
    logo: "/logos/monad.png",
    wallet: "evm",
    evmChainId: 143,
    sendEnabled: false,
  },
];

// Said on every EVM receive address. The four listed chains are the ones the
// embedded wallet can spend from; a token sent on any other EVM chain still
// arrives at the same address and is then stranded, which is the one thing a
// logo row cannot carry because it is about the chains that are absent.
export const EVM_RECEIVE_WARNING =
  "Assets sent on any other chain reach this address but cannot be moved.";
