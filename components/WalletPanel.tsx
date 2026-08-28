"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  useCreateWallet,
  useFundWallet as useFundEvmWallet,
} from "@privy-io/react-auth";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { bsc, mainnet } from "viem/chains";
import { SOL_MINT } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { AssetLogo } from "@/components/AssetLogo";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  groupHoldings,
  totalPortfolioUsd,
  type HoldingGroup,
} from "@/lib/solana/holdings";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { depositableChains } from "@/lib/trustware/equivalents";
import { collateralTicker, marketLogo } from "@/lib/tokens/market-logos";
import { ondoHoldingUiAmount } from "@/lib/trustware/ondo-holdings";
import { useOndoCollateral } from "@/lib/ondo/use-ondo-collateral";
import { useOndoUnwind } from "@/lib/ondo/use-ondo-unwind";
import { OndoUnwindCard } from "@/components/OndoUnwindCard";
import { unwindTargetFor } from "@/lib/ondo/unwind";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import { useLighterBalance } from "@/lib/lighter/use-lighter-balance";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import type { SolanaSigner } from "@/lib/morpho/fund";
import { useMonadBalances } from "@/lib/morpho/use-monad-balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import { nativeUiAmount } from "@/lib/trustware/native";
import { stableUiAmount } from "@/lib/trustware/stables";
import { MonadFundForm } from "./MonadFundForm";
import { SendForm } from "./SendForm";
import { FundMenu } from "./FundMenu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Privy's EVM funding config requires an amount whenever an asset is named, so
// USDC needs a starting figure. It is a prefill the user edits in the funding
// UI, not a fixed charge.
const USDC_FUNDING_PREFILL = "25";

// Trustware chain ids to the viem chains Privy funds on. Only chains declared
// in Privy's supportedChains can appear here: the registry may list a token on
// a chain the wallet cannot fund, and that has to fail loudly rather than open
// a widget pointed at the wrong network.
const EVM_FUNDING_CHAINS: Record<string, typeof mainnet | typeof bsc> = {
  "1": mainnet,
  "56": bsc,
};

// Badges for native gas tokens, keyed by symbol. Symbols without an entry
// fall back to the AssetLogo monogram.
const NATIVE_LOGOS: Record<string, string> = {
  ETH: "/logos/eth.png",
  SOL: "/logos/solana.png",
  BNB: "/logos/bnb.png",
};

export function WalletPanel({
  walletAddress,
  balances,
  balancesError,
  balancesRefreshing,
  prices,
  scan,
  onSent,
  onRefresh,
}: {
  walletAddress: string;
  balances: AccountBalances | null;
  balancesError: string | null;
  balancesRefreshing: boolean;
  prices: JupiterPriceMap | null;
  // Cross-chain holdings and native balances, scanned once by the page so both
  // the header total and these rows read from the same snapshot.
  scan: WalletScan;
  onSent: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  // Expanded by default so holdings are visible as soon as they load. This panel
  // remounts on section navigation; deriving the initial state from `balances`
  // left it collapsed (hiding every row) whenever it mounted after balances had
  // already loaded. Users can still collapse it manually.
  const [open, setOpen] = useState(true);
  // Which equity group is showing its breakdown. One at a time.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [fundingMonad, setFundingMonad] = useState(false);
  const [movingOndo, setMovingOndo] = useState(false);
  const [depositingStocks, setDepositingStocks] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const { fundWallet } = useFundWallet({
    onUserExited: () => {
      onSent();
    },
  });
  const { fundWallet: fundEvmWallet } = useFundEvmWallet();
  const { createWallet: createEvmWallet } = useCreateWallet();
  const [creatingEvm, setCreatingEvm] = useState(false);
  const { address: evmAddress } = useEmbeddedEvmWallet();
  // Every chain a tokenized stock can be deposited from. EVM chains route
  // through Privy's funding widget like USDC and ETH do; Solana falls back to
  // its address, because Privy's Solana funding config takes only
  // 'native-currency' or 'USDC' and cannot name an SPL mint.
  const depositChains = useMemo(() => depositableChains(), []);
  // Monad balances live in the embedded EVM wallet, outside both the Solana
  // read and the Trustware scan, so they get their own read. USDC counts at
  // par and MON at the native price feed's rate (missing price -> no USD
  // figure on the row and no MON value in the total).
  const monad = useMonadBalances(evmAddress);
  // Margin on Lighter's L2, keyed by the embedded EVM wallet that owns the
  // account. Not a wallet balance: it left the wallet when it was deposited,
  // but it is still the user's money and belongs in the account total.
  const lighter = useLighterBalance(evmAddress);
  // Only fetched when something is actually stranded on Ethereum, so the common
  // case costs no extra request.
  const ondoCatalog = useOndoCollateral(scan.ondo.length > 0);
  const unwind = useOndoUnwind({
    collateral: ondoCatalog.collateral,
    solanaAddress: walletAddress,
    enabled: scan.ondo.length > 0,
    onDelivered: () => void onRefresh(),
  });
  const monadUsdc = monad.balances?.usdcUi ?? 0;
  const monPrice = scan.nativePrices["monad"];
  const monadUsd = monadUsdc + (monad.balances?.monUi ?? 0) * (monPrice ?? 0);
  // Signer for the Monad Fund flow's Solana source leg.
  const sendSolanaTx = useSendSolanaTxBase64();
  const solanaSigner = useMemo<SolanaSigner>(
    () => ({ address: walletAddress, signAndSendBase64: sendSolanaTx }),
    [walletAddress, sendSolanaTx],
  );

  const solanaTotalUsd = totalPortfolioUsd(
    balances,
    prices,
    scan.held,
    scan.native,
    scan.nativePrices,
    scan.ondo,
  );
  // Mirrors the header total in app/app/page.tsx: a missing Lighter read
  // counts as 0, so the total can only understate.
  const offSolanaUsd = monadUsd + (lighter.usd ?? 0);
  const totalUsd =
    solanaTotalUsd != null
      ? solanaTotalUsd + offSolanaUsd
      : offSolanaUsd > 0
        ? offSolanaUsd
        : null;
  // One row per equity, not per mint. TSLAx and TSLAon are the same Tesla
  // position, so they collapse into a single line that opens to show the parts.
  const groups = groupHoldings(balances, prices, scan.held);
  // Same rule for dollars: one USDC row totalled across chains, opening to the
  // per-chain breakdown. Solana always shows (it is the primary wallet); other
  // chains appear once they hold something.
  const usdcParts = [
    { key: "solana", chainLabel: "Solana", amount: balances?.usdc ?? 0 },
    ...(monadUsdc > 0.000001
      ? [{ key: "monad", chainLabel: "Monad", amount: monadUsdc }]
      : []),
    ...scan.stables
      .filter((s) => stableUiAmount(s) > 0)
      .map((s) => ({
        key: s.chain,
        chainLabel: s.chainLabel,
        amount: stableUiAmount(s),
      })),
  ];
  const hasIndirectHolding = groups.some((g) => g.parts.some((p) => !p.direct));

  async function handleFund(asset: "native-currency" | "USDC") {
    setFundError(null);
    try {
      await fundWallet({
        address: walletAddress,
        options: { asset },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFundError(msg);
      console.error("[fundWallet]", err);
    }
  }


  // Funding the EVM wallet is a separate hook from the Solana one: the root
  // export funds EVM wallets, the /solana subpath funds Solana wallets. The
  // chain has to be named explicitly, and Privy's EVM config requires an amount
  // whenever an asset is specified, so USDC carries a prefill the user can edit
  // in the funding UI while ETH uses the open-ended native flow.
  // Open Privy's funding widget for a whole chain rather than one token.
  //
  // Naming an asset here would be theatre: an ERC-20 deposit lands on the same
  // 0x address whatever the token, so the destination and the QR are identical.
  // It only changed the widget's caption, which is what made the old per-token
  // grid sixteen buttons for two addresses.
  async function handleFundEvmChain(chainId: string, chainLabel: string) {
    setFundError(null);
    const chain = EVM_FUNDING_CHAINS[chainId];
    if (!chain) {
      setFundError(`This wallet cannot fund on ${chainLabel}.`);
      return;
    }
    try {
      let address = evmAddress;
      if (!address) {
        setCreatingEvm(true);
        address = (await createEvmWallet())?.address;
      }
      if (!address) {
        throw new Error(
          "Could not create an Ethereum wallet for this account.",
        );
      }
      await fundEvmWallet({ address, options: { chain } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFundError(msg);
      console.error("[fundWallet evm chain]", err);
    } finally {
      setCreatingEvm(false);
    }
  }

  async function handleFundEvm(asset: "native-currency" | "USDC") {
    setFundError(null);
    try {
      // Privy provisions embedded wallets at login, and only for users who do
      // not already have one. An account created before this app asked for an
      // EVM wallet therefore has only the Solana one, and no amount of
      // reloading changes that. Create it on demand instead.
      let address = evmAddress;
      if (!address) {
        setCreatingEvm(true);
        const created = await createEvmWallet();
        address = created?.address;
      }
      if (!address) {
        throw new Error(
          "Could not create an Ethereum wallet for this account.",
        );
      }
      await fundEvmWallet({
        address,
        options:
          asset === "USDC"
            ? { chain: mainnet, asset: "USDC", amount: USDC_FUNDING_PREFILL }
            : { chain: mainnet },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFundError(msg);
      console.error("[fundWallet evm]", err);
    } finally {
      setCreatingEvm(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex w-full items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Balances
          {totalUsd != null && (
            <span className="ml-2 font-mono text-white/60 normal-case tracking-normal">
              · ${totalUsd.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-3 text-xs text-white/50">
          <button
            type="button"
            onClick={() => {
              onRefresh();
              monad.refresh();
              lighter.refresh();
            }}
            disabled={balancesRefreshing}
            className="underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
          >
            {balancesRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="hover:text-white"
          >
            {open ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {balancesError && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
          Balance fetch interrupted. {balancesError}
        </p>
      )}

      {open && balances && (
        <>
          <div>
            {/* MON leads the list. It is gas for the Monad earn venue, and a
                Morpho deposit or withdrawal there fails outright once it runs
                out, so it is the one balance worth seeing before scrolling. */}
            {monad.balances && monad.balances.monUi > 0 && (
              <BalanceRow
                label="MON"
                sublabel="Monad"
                amount={monad.balances.monUi}
                decimals={4}
                usd={monPrice ? monad.balances.monUi * monPrice : null}
                icon={
                  <AssetLogo
                    xstock={{
                      symbol: "MON",
                      name: "Monad",
                      logo: "/logos/monad.png",
                    }}
                    size={30}
                  />
                }
                badge={
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                    Gas
                  </span>
                }
              />
            )}
            <BalanceRow
              label="SOL"
              sublabel="Solana"
              amount={balances.sol}
              decimals={6}
              usd={
                prices?.[SOL_MINT]?.usdPrice
                  ? balances.sol * prices[SOL_MINT].usdPrice
                  : null
              }
              icon={
                <AssetLogo
                  xstock={{
                    symbol: "SOL",
                    name: "Solana",
                    logo: "/logos/solana.png",
                  }}
                  size={30}
                />
              }
            />
            <UsdcRow
              parts={usdcParts}
              expanded={expandedKey === "usdc"}
              onToggle={() =>
                setExpandedKey(expandedKey === "usdc" ? null : "usdc")
              }
            />
            {/* Margin held on Lighter, right after the wallet's dollars since
                it is dollar denominated. Total account value, so the figure
                moves with open positions' PnL, not just deposits. */}
            {lighter.usd != null && lighter.usd > 0 && (
              <BalanceRow
                label="Lighter"
                sublabel="Perps margin"
                amount={lighter.usd}
                decimals={2}
                usd={lighter.usd}
                icon={
                  <AssetLogo
                    xstock={{
                      symbol: "L",
                      name: "Lighter",
                      logo: "/logos/lighter.png",
                    }}
                    size={30}
                  />
                }
                badge={
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                    Perps
                  </span>
                }
              />
            )}
            {groups.map((group) => (
              <HoldingRow
                key={group.key}
                group={group}
                expanded={expandedKey === group.key}
                onToggle={() =>
                  setExpandedKey(expandedKey === group.key ? null : group.key)
                }
              />
            ))}
            {scan.native.map((n) => {
              const amount = nativeUiAmount(n);
              const price = scan.nativePrices[n.priceId];
              return (
                <BalanceRow
                  key={`${n.chain}:${n.symbol}`}
                  label={n.symbol}
                  sublabel={n.chainLabel}
                  amount={amount}
                  decimals={6}
                  usd={price ? amount * price : null}
                  icon={
                    <AssetLogo
                      xstock={{
                        symbol: n.symbol,
                        name: n.chainLabel,
                        logo: NATIVE_LOGOS[n.symbol],
                      }}
                      size={30}
                    />
                  }
                  badge={
                    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                      Gas
                    </span>
                  }
                />
              );
            })}
            {/* Ondo collateral withdrawn to the Ethereum wallet.
                Priced off the matching xStock, since SPCXon and SPCXx track the
                same underlying and the Solana mint is what this app has a price
                for. Rows appear only after a Perps withdrawal, so this is
                normally empty. */}
            {scan.ondo.map((o) => {
              const amount = ondoHoldingUiAmount(o);
              const target = unwindTargetFor(o.symbol);
              const price = target
                ? prices?.[target.mint]?.usdPrice
                : undefined;
              return (
                <BalanceRow
                  key={`ondo:${o.contractAddress}`}
                  label={o.symbol}
                  sublabel="Ethereum"
                  amount={amount}
                  decimals={6}
                  usd={price ? amount * price : null}
                  icon={
                    <AssetLogo
                      xstock={{
                        symbol: o.symbol,
                        name: o.symbol,
                        logo: target
                          ? XSTOCKS.find((x) => x.mint === target.mint)?.logo
                          : undefined,
                      }}
                      size={30}
                    />
                  }
                  badge={
                    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                      Ondo
                    </span>
                  }
                />
              );
            })}
            {balances.usdc === 0 &&
              balances.sol === 0 &&
              scan.native.length === 0 &&
              monadUsdc === 0 &&
              (lighter.usd ?? 0) === 0 &&
              groups.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-white/50">
                  No balances yet. Fund USDC or SOL to start.
                </div>
              )}
          </div>

          {hasIndirectHolding && (
            <p className="px-3.5 text-[11px] text-white/50">
              Ondo tokens are a different mint from the xStocks this app trades.
              Deposit one as collateral in Borrow and it converts first.
            </p>
          )}

          {/* Three actions, not eight. Fund carries the chain/asset matrix in
              a menu so the panel reads as a wallet rather than a control board;
              Receive and Send were already single destinations. */}
          <div className="grid grid-cols-3 gap-2">
            <FundMenu
              busyLabel={creatingEvm ? "Setting up…" : null}
              groups={[
                {
                  chain: "Solana",
                  chainLogo: "/logos/solana.png",
                  options: [
                    {
                      id: "sol-usdc",
                      label: "USDC",
                      logo: "/logos/usdc.png",
                      onSelect: () => handleFund("USDC"),
                    },
                    {
                      id: "sol-native",
                      label: "SOL",
                      logo: "/logos/solana.png",
                      onSelect: () => handleFund("native-currency"),
                    },
                  ],
                },
                {
                  chain: "Ethereum",
                  chainLogo: "/logos/eth.png",
                  options: [
                    {
                      id: "eth-usdc",
                      label: "USDC",
                      logo: "/logos/usdc.png",
                      disabled: creatingEvm,
                      onSelect: () => handleFundEvm("USDC"),
                    },
                    {
                      id: "eth-native",
                      label: "ETH",
                      logo: "/logos/eth.png",
                      disabled: creatingEvm,
                      onSelect: () => handleFundEvm("native-currency"),
                    },
                    // Only when an Ondo token is actually stranded there. An
                    // Ondo asset belongs on Solana unless it is posted as margin
                    // on Ondo Perps, so it is offered where the balance shows.
                    ...(scan.ondo.length > 0
                      ? [
                          {
                            id: "eth-ondo",
                            label: "Move Ondo to Solana",
                            hint: "Converts to the Solana mint",
                            logo: "/logos/ondo.png",
                            onSelect: () => setMovingOndo(true),
                          },
                        ]
                      : []),
                  ],
                },
                {
                  // Monad has no Privy funding provider, so its Fund flow moves
                  // USDC from the Solana wallet through Trustware. Gas arrives
                  // automatically on the way in.
                  chain: "Monad",
                  chainLogo: "/logos/monad.png",
                  options: [
                    {
                      id: "monad-usdc",
                      label: "USDC",
                      hint: "Moved from Solana",
                      logo: "/logos/usdc.png",
                      onSelect: () => setFundingMonad(true),
                    },
                  ],
                },
                // Grouped by asset class rather than by chain, unlike the three
                // above. The registry carries eight tickers across three
                // chains; listing those as chain/asset pairs would be nineteen
                // rows for a menu that is meant to read as a wallet. One row
                // covers it, and anything the user already holds is promoted
                // beside it because that is a deposit they can act on now.
                {
                  chain: "Tokenized stocks",
                  chainLogo: "/logos/ondo.png",
                  options: [
                    ...scan.held.map((h) => ({
                      id: `equiv-${h.source.chain}-${h.source.token}`,
                      label: `${h.source.symbol} on ${h.source.chainLabel}`,
                      hint: `${formatEquivalentAmount(
                        h.balanceAtomic,
                        h.source.decimals,
                      )} ready to convert`,
                      logo: equivalentLogo(h.source.symbol),
                      onSelect: () => setDepositingStocks(true),
                    })),
                    {
                      id: "stocks-deposit",
                      label: scan.held.length
                        ? "Deposit another"
                        : "Deposit tokenized stocks",
                      hint: depositableChains()
                        .map((c) => c.chainLabel)
                        .join(", "),
                      onSelect: () => setDepositingStocks(true),
                    },
                  ],
                },
              ]}
            />
            <ActionButton onClick={() => setReceiving(true)}>
              Receive
            </ActionButton>
            <ActionButton onClick={() => setSending(true)}>Send</ActionButton>
          </div>
          {fundError && (
            <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
              Funding unavailable. {fundError}
            </p>
          )}

          <Sheet open={receiving} onOpenChange={setReceiving}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="border-b border-white/10">
                <SheetTitle>Receive tokens</SheetTitle>
                <SheetDescription>
                  Two wallets, one account. Send each asset to the address for
                  the chain it lives on.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 overflow-y-auto px-4 py-4">
                <ReceiveAddress
                  label="Solana"
                  address={walletAddress}
                  accepts="SOL, USDC, xStocks, and Ondo's Solana tokens."
                />
                <EvmReceiveAddress />
              </div>
            </SheetContent>
          </Sheet>

          {/* Tokenized stocks arriving from another chain.
              Picking the ticker here rather than in the Fund menu is what keeps
              that menu at one row instead of eleven chain/asset pairs. The EVM
              rows open the same Privy funding widget USDC and ETH use, named
              for the token; Solana falls back to its address because Privy's
              Solana funding config takes only 'native-currency' or 'USDC'. */}
          <Sheet open={depositingStocks} onOpenChange={setDepositingStocks}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="border-b border-white/10">
                <SheetTitle>Deposit tokenized stocks</SheetTitle>
                <SheetDescription>
                  Pick what you are sending. It arrives in the wallet you
                  already have, and converts to the Solana version when you
                  deposit it as collateral in Borrow.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 overflow-y-auto px-4 py-4">
                {scan.held.length > 0 && (
                  <div className="rounded-xl border border-aeras-blue/30 bg-aeras-blue/15 px-3.5 py-3">
                    <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
                      Already in your wallet
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {scan.held.map((h) => (
                        <li
                          key={`${h.source.chain}-${h.source.token}`}
                          className="flex items-baseline justify-between gap-3 text-xs"
                        >
                          <span className="text-white">
                            {h.source.symbol}
                            <span className="text-white/45">
                              {" "}
                              on {h.source.chainLabel}
                            </span>
                          </span>
                          <span className="font-mono tabular-nums text-white/70">
                            {formatEquivalentAmount(
                              h.balanceAtomic,
                              h.source.decimals,
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-white/50">
                      Deposit one as collateral in Borrow and it converts first.
                    </p>
                  </div>
                )}

                {depositChains.map((c) => (
                  <div key={c.chain}>
                    <div className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
                      {c.chainLabel}
                    </div>
                    {c.kind === "evm" ? (
                      // One address per chain, not one button per token.
                      //
                      // A receive address does not care which token arrives:
                      // every asset on a chain lands at the same address. The
                      // per-token grid came from the Privy funding widget, which
                      // does need a token named, and wrongly implied the user had
                      // to pick the exact one before sending from elsewhere.
                      // Accepted tokens are listed as a hint instead, the way the
                      // Solana row already did it.
                      <div className="space-y-2">
                        <ReceiveAddress
                          label={`Send to your ${c.chainLabel} address`}
                          address={evmAddress ?? ""}
                          accepts={c.assets.map((a) => a.symbol).join(", ")}
                        />
                        {/* The same Privy widget as before, scoped to the chain
                            rather than to a ticker. Sending from another wallet
                            uses the address above; this is for buying or
                            transferring in through Privy. */}
                        <button
                          type="button"
                          disabled={creatingEvm}
                          onClick={() =>
                            handleFundEvmChain(c.chain, c.chainLabel)
                          }
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white transition-colors hover:border-white/25 hover:bg-white/10 disabled:opacity-40"
                        >
                          {creatingEvm
                            ? "Setting up…"
                            : `Fund on ${c.chainLabel} with Privy`}
                        </button>
                      </div>
                    ) : (
                      // Privy's Solana funding config cannot name an SPL mint,
                      // so this one stays an address. Same wallet either way.
                      <ReceiveAddress
                        label={`Send to your Solana address`}
                        address={walletAddress}
                        accepts={c.assets.map((a) => a.symbol).join(", ")}
                      />
                    )}
                  </div>
                ))}

                {/* Naming what is NOT accepted matters more here than in the
                    plain Receive panel: these tokens exist on chains the
                    registry deliberately holds out, and one sent to this
                    address on Arbitrum or HyperEVM is stuck. */}
                <p className="px-1 text-[11px] text-white/45">
                  Only these chains. The same token on another chain reaches
                  your address but cannot be converted or moved.
                </p>
                {scan.error && (
                  <p className="px-1 text-[11px] text-white/45">
                    Could not read your balances on every chain, so this list
                    may be incomplete.
                  </p>
                )}
              </div>
            </SheetContent>
          </Sheet>

          {/* Ondo collateral going home.
              Ethereum is a waypoint for these tokens, never a destination: on
              Solana the same asset trades on Jupiter and works everywhere else
              in the app, while on Ethereum it does nothing at all. */}
          <Sheet open={movingOndo} onOpenChange={setMovingOndo}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="border-b border-white/10">
                <SheetTitle>Move to Solana</SheetTitle>
                <SheetDescription>
                  Converts an Ondo token withdrawn from Perps into its Solana
                  version, where it can be traded and lent.
                </SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4 py-4">
                <OndoUnwindCard unwind={unwind} />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={fundingMonad} onOpenChange={setFundingMonad}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="border-b border-white/10">
                <SheetTitle>Move USDC</SheetTitle>
                <SheetDescription>
                  Converts USDC between your Solana wallet and your Monad
                  wallet, in either direction.
                </SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4 py-4">
                <MonadFundForm
                  solanaAddress={walletAddress}
                  solanaUsdcAtomic={balances.usdcAtomic}
                  monadUsdcAtomic={monad.balances?.usdcAtomic ?? "0"}
                  monBalanceAtomic={monad.balances?.monAtomic ?? "0"}
                  solanaSigner={solanaSigner}
                  onFunded={async () => {
                    await Promise.all([onRefresh(), monad.refresh()]);
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={sending} onOpenChange={setSending}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="border-b border-white/10">
                <SheetTitle>Send tokens</SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  From {walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}
                </SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4 pb-4">
                <SendForm
                  walletAddress={walletAddress}
                  balances={balances}
                  prices={prices}
                  onClose={() => setSending(false)}
                  onSent={() => {
                    onSent();
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15"
    >
      {children}
    </button>
  );
}

function BalanceRow({
  label,
  sublabel,
  amount,
  decimals,
  usd,
  icon,
  badge,
}: {
  label: string;
  sublabel: string;
  amount: number;
  decimals: number;
  usd: number | null;
  icon?: ReactNode;
  // Optional tag beside the symbol, used to mark a holding the app cannot
  // trade or deposit as it stands.
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        {icon}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium tracking-tight text-white">
              {label}
            </span>
            {badge}
          </div>
          <div className="text-xs text-white/50">{sublabel}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm tabular-nums text-white">
          {amount.toLocaleString(undefined, {
            maximumFractionDigits: decimals,
          })}
        </div>
        {usd != null && (
          <div className="font-mono text-xs text-white/50">
            ${usd.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  );
}

// One receiving address, with what it accepts and a way to copy it.
// Logo for a convertible ticker. `collateralTicker` strips Ondo's "on" suffix;
// Backed's xStocks carry a trailing "x" instead, so that comes off first. Both
// are registry naming conventions, not guesses at arbitrary symbols.
function equivalentLogo(symbol: string): string | undefined {
  const base = symbol.endsWith("x")
    ? symbol.slice(0, -1)
    : collateralTicker(symbol);
  return marketLogo(base);
}

// Atomic units to a short display figure. These are equity balances, so two
// decimals is enough, but a dust balance should not render as "0.00" and read
// as nothing.
function formatEquivalentAmount(atomic: string, decimals: number): string {
  const value = Number(atomic) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0";
  if (value > 0 && value < 0.01) return "<0.01";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function ReceiveAddress({
  label,
  address,
  accepts,
  warning,
}: {
  label: string;
  address: string;
  accepts: string;
  warning?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked. The address is on screen either way.
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          {label}
        </div>
        <button
          type="button"
          onClick={copy}
          className="text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="mt-1.5 break-all font-mono text-xs text-white">
        {address}
      </div>
      <p className="mt-1.5 text-[11px] text-white/50">{accepts}</p>
      {warning && (
        <p className="mt-1 text-[11px] text-aeras-warning">{warning}</p>
      )}
    </div>
  );
}

// The EVM half of receiving.
//
// Privy provisions an embedded EVM wallet alongside the Solana one, and it is
// the same 0x address on every EVM chain. Nothing surfaced it before, so the
// cross-chain deposit path the borrow flow already supports had no way to be
// funded.
//
// Only Ethereum, BNB Chain, and Monad are named, because those are the chains
// the app can actually spend from: they are declared in Privy's
// supportedChains, and each carries something the app uses (registered
// equivalents on the first two, USDC and MON gas for Morpho earn on Monad).
// Assets sent on any other EVM chain arrive at this same address and then
// cannot be moved from here, so the warning says so rather than leaving it to
// be discovered.
// Copy is overridable because two panels need this same address with different
// framing: the general Receive panel names every chain the wallet can spend on,
// while the tokenized-stock deposit panel names only the chains that convert.
// The create-on-demand flow below is the reason they share a component rather
// than each rendering their own ReceiveAddress.
function EvmReceiveAddress({
  label = "Ethereum, BNB Chain, and Monad",
  accepts = "Tokenized stocks on Ethereum or BNB Chain (Borrow converts them to the Solana version first), and USDC on Monad for Morpho earn deposits. Earn deposits also fund this wallet automatically from Solana USDC.",
  warning = "Only these three chains. Assets sent on another EVM chain reach this address but cannot be used or moved.",
}: {
  label?: string;
  accepts?: string;
  warning?: string;
} = {}) {
  const { address, ready } = useEmbeddedEvmWallet();
  const { createWallet } = useCreateWallet();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready || !address) {
    // Reloading would not help: an account created before this app asked for an
    // EVM wallet simply does not have one, and Privy only provisions at login.
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Ethereum, BNB Chain, and Monad
        </div>
        <p className="mt-1.5 text-[11px] text-white/50">
          This account has no Ethereum wallet yet. Creating one takes a moment
          and needs no signature.
        </p>
        <button
          type="button"
          disabled={creating}
          onClick={async () => {
            setError(null);
            setCreating(true);
            try {
              await createWallet();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setCreating(false);
            }
          }}
          className="mt-2 w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:border-white/25 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create Ethereum wallet"}
        </button>
        {error && (
          <p className="mt-1.5 text-[11px] text-aeras-negative">{error}</p>
        )}
      </div>
    );
  }

  return (
    <ReceiveAddress
      label={label}
      address={address}
      accepts={accepts}
      warning={warning}
    />
  );
}

// The account's dollars as one row. USDC held on a single chain renders plain;
// spread across chains it shows the total and opens to the per-chain
// breakdown, mirroring how HoldingRow treats an equity held through several
// mints. All parts are the same dollar, so the total is a plain sum.
function UsdcRow({
  parts,
  expanded,
  onToggle,
}: {
  parts: { key: string; chainLabel: string; amount: number }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const total = parts.reduce((sum, p) => sum + p.amount, 0);
  const icon = (
    <AssetLogo
      xstock={{ symbol: "USDC", name: "USD Coin", logo: "/logos/usdc.png" }}
      size={30}
    />
  );

  if (parts.length === 1) {
    return (
      <BalanceRow
        label="USDC"
        sublabel="US Dollar"
        amount={parts[0].amount}
        decimals={2}
        usd={parts[0].amount}
        icon={icon}
      />
    );
  }

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-white/5"
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <div>
            <div className="text-sm font-medium tracking-tight text-white">
              USDC
            </div>
            <div className="text-xs text-white/50">
              US Dollar · {parts.length} chains
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-mono text-sm tabular-nums text-white">
              ${total.toFixed(2)}
            </div>
            <div className="font-mono text-xs text-white/50">
              {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-white/40 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>
      {expanded && (
        <div className="border-t border-white/5 bg-black/20 px-3.5 py-1">
          {parts.map((part) => (
            <div
              key={part.key}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white">USDC</span>
                <span className="text-[10px] text-white/40">
                  {part.chainLabel}
                </span>
              </div>
              <span className="font-mono text-xs tabular-nums text-white">
                {part.amount.toFixed(2)}
                <span className="ml-1.5 text-white/50">
                  ${part.amount.toFixed(2)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One equity. A position held through a single mint renders as a plain row; one
// held through several shows the combined value and opens to the breakdown.
function HoldingRow({
  group,
  expanded,
  onToggle,
}: {
  group: HoldingGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const single = group.parts.length === 1;
  const icon = (
    <AssetLogo
      xstock={{ symbol: group.symbol, name: group.name, logo: group.logo }}
      size={30}
    />
  );

  if (single) {
    const part = group.parts[0];
    return (
      <BalanceRow
        label={part.name}
        sublabel={part.direct ? part.symbol : `${part.symbol} · Ondo`}
        amount={part.amount}
        decimals={6}
        usd={part.usd}
        icon={icon}
        badge={
          part.direct ? undefined : (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
              {part.convertible ? "Converts on deposit" : "Not supported"}
            </span>
          )
        }
      />
    );
  }

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-white/5"
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <div>
            <div className="text-sm font-medium tracking-tight text-white">
              {group.name}
            </div>
            <div className="text-xs text-white/50">
              {group.symbol} · {group.parts.length} tokens
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-mono text-sm tabular-nums text-white">
              {group.usd != null ? `$${group.usd.toFixed(2)}` : "—"}
            </div>
            <div className="font-mono text-xs text-white/50">
              {group.amount.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}
            </div>
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-white/40 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>
      {expanded && (
        <div className="border-t border-white/5 bg-black/20 px-3.5 py-1">
          {group.parts.map((part) => (
            <div
              key={part.mint}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white">
                  {part.symbol}
                </span>
                <span className="text-[10px] text-white/40">
                  {part.chainLabel}
                </span>
                {!part.direct && (
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                    {part.convertible ? "Converts on deposit" : "Not supported"}
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono text-xs tabular-nums text-white">
                  {part.usd != null ? `$${part.usd.toFixed(2)}` : "—"}
                </div>
                <div className="font-mono text-[11px] text-white/50">
                  {part.amount.toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
