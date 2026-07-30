import { NextResponse } from "next/server";
import BN from "bn.js";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

import {
  EARN_ASSETS,
  buildEarnDepositTx,
  buildEarnRedeemAllTx,
  buildEarnWithdrawTx,
} from "@/lib/jupiter/earn";

export const dynamic = "force-dynamic";

// Temporary build-verification route. Deleted after manual verification.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const signer = searchParams.get("signer");
  const symbol = searchParams.get("symbol") ?? "USDC";
  if (!signer) return NextResponse.json({ error: "signer required" }, { status: 400 });

  const meta = EARN_ASSETS.find((a) => a.symbol === symbol);
  if (!meta) return NextResponse.json({ error: "unknown symbol" }, { status: 400 });

  const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!, "confirmed");
  const amountAtomic = new BN(10).pow(new BN(meta.decimals)); // 1.0 unit

  const out: Record<string, unknown> = { symbol: meta.symbol };
  for (const [label, build] of [
    ["deposit", () => buildEarnDepositTx({ meta, amountAtomic, signerAddress: signer, connection })],
    ["withdraw", () => buildEarnWithdrawTx({ meta, amountAtomic, signerAddress: signer, connection })],
    [
      "redeemAll",
      () =>
        buildEarnRedeemAllTx({
          meta,
          sharesAtomicAmount: amountAtomic,
          signerAddress: signer,
          connection,
        }),
    ],
  ] as const) {
    try {
      const b64 = await build();
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      const keys = tx.message.staticAccountKeys;
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      out[label] = {
        bytes: Buffer.from(b64, "base64").length,
        ixCount: tx.message.compiledInstructions.length,
        programs: [
          ...new Set(
            tx.message.compiledInstructions.map((ix) =>
              keys[ix.programIdIndex]?.toBase58(),
            ),
          ),
        ],
        payer: keys[0]?.toBase58(),
        simErr: sim.value.err ? JSON.stringify(sim.value.err) : null,
        simLogs: sim.value.logs?.slice(-6) ?? null,
        unitsConsumed: sim.value.unitsConsumed ?? null,
      };
    } catch (err) {
      out[label] = {
        buildError: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 6) : undefined,
      };
    }
  }

  return NextResponse.json({ signerChecked: new PublicKey(signer).toBase58(), ...out });
}
