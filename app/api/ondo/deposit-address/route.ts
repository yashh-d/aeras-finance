import { NextResponse } from "next/server";

import { collateralBySymbol, creditableCollateral } from "@/lib/ondo/collateral";
import { ONDO_DEPOSIT_NETWORK } from "@/lib/ondo/constants";
import { buildCatalog, collateralAssets } from "@/lib/ondo/markets";
import {
  ondoAccount,
  ondoContracts,
  ondoMarkets,
  ondoProvisionAddress,
} from "@/lib/ondo/server";
import { OndoSessionMissing, requireOndoSession } from "@/lib/ondo/session";

export const dynamic = "force-dynamic";

// Provisions the address the funding leg pays into.
//
// The address Ondo returns is permanently bound to the account, so this is
// safe to call more than once and the answer is worth caching on the caller's
// side rather than re-requesting per deposit.
//
// The symbol is checked against the live token config before it is sent, and
// that check is the whole point of this route rather than a formality.
//
// **Ondo will provision a deposit address for an asset it does not credit.**
// Measured 2026-08-25: `provision_address` returns a real, valid address for
// TSLAon, which is not accepted collateral. It only rejects a symbol Ondo has
// never heard of. So a successful provision proves nothing about margin, and a
// user who bridges into one of those addresses gets a credited balance of zero.
// The token config is the gate.
//
// The network is pinned to Ethereum for the same class of reason: the request
// schema still advertises solana and avalanche, and Solana answers
// service_unavailable rather than invalid_network, so the enum value exists
// while the deposit path does not.
export async function POST(request: Request) {
  let session;
  try {
    session = await requireOndoSession();
  } catch (err) {
    if (err instanceof OndoSessionMissing) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  let payload: { symbol?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { symbol } = payload;
  if (typeof symbol !== "string" || symbol.length === 0) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  try {
    const [markets, contracts] = await Promise.all([ondoMarkets(), ondoContracts()]);
    const collateral = creditableCollateral(
      collateralAssets(markets),
      buildCatalog(markets, contracts),
    );
    const asset = collateralBySymbol(collateral, symbol);

    if (!asset) {
      return NextResponse.json(
        {
          error: `Ondo does not credit ${symbol} as margin on ${ONDO_DEPOSIT_NETWORK}. A deposit address would be issued for it and the deposit would earn no margin.`,
          reason: "unsupported-collateral",
        },
        { status: 409 },
      );
    }

    const account = await ondoAccount(session.token);
    const provisioned = await ondoProvisionAddress(session.token, {
      symbol,
      network: ONDO_DEPOSIT_NETWORK,
      deposit_destination: { id: account.accountID, wallet: "margin" },
    });

    return NextResponse.json({
      ...provisioned,
      // The token the deposit has to be made in, read from Ondo's own config
      // rather than from our registry, so a funding leg cannot send the right
      // asset to the right address at the wrong contract.
      contractAddress: asset.contractAddress,
      decimals: asset.decimals,
      haircut: asset.haircut,
      capTokens: asset.capTokens,
      markPriceUsd: asset.markPriceUsd,
      // False for GLDon and SLVon: Ondo has no GLD or SLV market to mark them
      // against, so the credited value is only knowable after they land.
      priceable: asset.priceable,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
