"use client";

// The one signature Blend's SDK asks the wallet for: the SIWE message at
// sign-in. Everything on chain is sent through the raw EIP-1193 provider by
// lib/blend/execute.ts, the way every other venue signs, so there is no viem
// wallet client here or anywhere else in the app (CLAUDE.md, Privy).
//
// `personal_sign` does not depend on the wallet's active chain, so no switch
// happens here. The message goes over as UTF-8 hex, which every provider
// accepts and which is what viem's signMessage sends.

import type { EvmSigner } from "@/lib/trustware/execute";

export type { EvmSigner } from "@/lib/trustware/execute";

export async function signBlendMessage(
  evm: EvmSigner,
  message: string,
): Promise<string> {
  const provider = await evm.getProvider();
  const hex = `0x${Array.from(new TextEncoder().encode(message), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")}`;
  const signature = (await provider.request({
    method: "personal_sign",
    params: [hex, evm.address],
  })) as string;
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw new Error("The wallet returned no signature.");
  }
  return signature;
}
