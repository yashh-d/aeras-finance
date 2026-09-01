"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  useCreateWallet,
  useFundWallet as useFundEvmWallet,
} from "@privy-io/react-auth";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { base, bsc, mainnet } from "viem/chains";
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
import { nativeUiAmount, type NativeHolding } from "@/lib/trustware/native";
import { stableUiAmount } from "@/lib/trustware/stables";
import { BaseReturnForm } from "./BaseReturnForm";
import { MonadFundForm } from "./MonadFundForm";
import { SendForm } from "./SendForm";
import { FundMenu, type FundOption } from "./FundMenu";
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
const EVM_FUNDING_CHAINS: Record<
  string,
  typeof mainnet | typeof bsc | typeof base
> = {
  "1": mainnet,
  "56": bsc,
  "8453": base,
};

// Marks for the tokenized-asset row in the Fund menu, drawn as an overlapping
// fan. One from each kind the catalog carries: a single stock, an index ETF,
// and gold. They stand for the class, not for a shortlist the user is picking
// from, which is why the row is one entry and not eight.
const TOKENIZED_ASSET_MARKS = [
  "/logos/tesla.png",
  "/logos/qqq.png",
  "/logos/xaut.png",
];

// Badges for native gas tokens, keyed by symbol. Symbols without an entry
// fall back to the AssetLogo monogram.
const NATIVE_LOGOS: Record<string, string> = {
  ETH: "/logos/eth.png",
  SOL: "/logos/solana.png",
  BNB: "/logos/bnb.png",
};

// Gas rows drawn even at zero, because an empty one is the case worth seeing.
// Converting a holding on either chain costs an ERC-20 approval plus the route
// transaction, both paid in that chain's native token, so a wallet holding the
// stock and no gas cannot start. Trustware's scan drops a chain with a zero
// balance, so these stand in when it returns nothing for one. Monad is absent
// on purpose: MON comes from its own read.
const GAS_ROW_FALLBACKS: NativeHolding[] = [
  {
    chain: "1",
    chainLabel: "Ethereum",
    symbol: "ETH",
    decimals: 18,
    balanceAtomic: "0",
    priceId: "ethereum",
  },
  {
    chain: "56",
    chainLabel: "BNB Chain",
    symbol: "BNB",
    decimals: 18,
    balanceAtomic: "0",
    priceId: "binancecoin",
  },
  // Base pays gas in ETH, and moving USDC off it needs some. Nothing tops this
  // up automatically, so an empty row here is the whole explanation for why a
  // move to Solana will not sign.
  {
    chain: "8453",
    chainLabel: "Base",
    symbol: "ETH",
    decimals: 18,
    balanceAtomic: "0",
    priceId: "ethereum",
  },
];

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
  const [movingBase, setMovingBase] = useState(false);
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
    // Rendered in the USDC row above as a per-chain part, so it has to be in
    // the total too.
    scan.stables,
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
  // MON leads the list when it is funded. It is gas for the Monad earn venue,
  // and a Morpho deposit or withdrawal there fails outright once it runs out,
  // so a real balance is worth seeing before scrolling. At zero it drops down
  // to sit with ETH in the gas rows, where an empty wallet reads as Solana
  // first rather than opening on a chain the user may never touch. Either way
  // the row is drawn, because hiding an empty gas row hides the thing that will
  // stop the deposit.
  const monLeads = (monad.balances?.monUi ?? 0) > 0;
  const monRow = (
    <BalanceRow
      label="MON"
      sublabel="Monad"
      amount={monad.balances?.monUi ?? 0}
      decimals={4}
      usd={monPrice && monad.balances ? monad.balances.monUi * monPrice : null}
      icon={
        <AssetLogo
          xstock={{ symbol: "MON", name: "Monad", logo: "/logos/monad.png" }}
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
  // The scan's real rows, with a zero row standing in for any gas chain it
  // returned nothing for. See GAS_ROW_FALLBACKS.
  // Base holdings, pulled out of the two scans by chain id. Base is the one
  // supported chain the app has no venue on, so these exist only to size and
  // gate the move back to Solana.
  const baseUsdcAtomic =
    scan.stables.find((s) => s.chain === "8453")?.balanceAtomic ?? "0";
  const baseEthWei =
    scan.native.find((n) => n.chain === "8453")?.balanceAtomic ?? "0";
  // The scan's real rows, with a zero row standing in for any gas chain it
  // returned nothing for. See GAS_ROW_FALLBACKS.
  const nativeRows = useMemo<NativeHolding[]>(() => {
    const missing = GAS_ROW_FALLBACKS.filter(
      (f) => !scan.native.some((n) => n.chain === f.chain),
    );
    return missing.length ? [...scan.native, ...missing] : scan.native;
  }, [scan.native]);
  // One row per gas asset rather than per chain. ETH is the gas token on both
  // Ethereum and Base, and two rows both labelled ETH read as a duplicate
  // rather than as one holding in two places. The same treatment USDC already
  // gets, and correct for the same reason: the parts are one asset at one
  // price, so they sum. Keyed by symbol, because a symbol is what the duplicate
  // row shows.
  const nativeGroups = useMemo(() => {
    const bySymbol = new Map<string, NativeGroup>();
    for (const n of nativeRows) {
      const entry = bySymbol.get(n.symbol) ?? {
        symbol: n.symbol,
        priceId: n.priceId,
        parts: [],
      };
      entry.parts.push({
        key: `${n.chain}:${n.symbol}`,
        chainLabel: n.chainLabel,
        amount: nativeUiAmount(n),
      });
      bySymbol.set(n.symbol, entry);
    }
    return [...bySymbol.values()];
  }, [nativeRows]);

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

  // Tokenized assets as a row inside a chain's group, rather than a section of
  // their own.
  //
  // A deposit address does not care which token arrives: TSLAx, QQQx and XAUt0
  // land at the same address USDC does, and the only thing the user has to get
  // right is the chain. So the row sits with that chain's other assets, and the
  // fan of marks says which kind of asset it stands for without listing every
  // ticker in the registry.
  //
  // It opens the deposit sheet, NOT the Privy funding widget the USDC and ETH
  // rows open. Those rows name an asset Privy can actually sell or transfer;
  // Privy has no idea what a TSLAon is, so pointing this row at the widget gave
  // the user an onramp offering to buy ETH when they came to deposit a stock.
  // The address is the same either way, which is what made the mistake easy;
  // what differs is that the sheet names the tokens each chain accepts and says
  // they convert on deposit.
  //
  // Anything already held on that chain is promoted above it, because that is a
  // deposit the user can act on now rather than one they have to go and fund.
  function tokenizedAssetOptions(chainLabel: string): FundOption[] {
    return [
      ...scan.held
        .filter((h) => h.source.chainLabel === chainLabel)
        .map((h) => ({
          id: `equiv-${h.source.chain}-${h.source.token}`,
          label: h.source.symbol,
          hint: `${formatEquivalentAmount(
            h.balanceAtomic,
            h.source.decimals,
          )} ready to convert`,
          logo: equivalentLogo(h.source.symbol),
          onSelect: () => setDepositingStocks(true),
        })),
      {
        id: `stocks-${chainLabel}`,
        label: "Tokenized assets",
        hint: "Stocks, commodities, and more",
        logos: TOKENIZED_ASSET_MARKS,
        onSelect: () => setDepositingStocks(true),
      },
    ];
  }

  async function handleFundEvm(
    asset: "native-currency" | "USDC",
    // Ethereum unless named. BNB Chain uses it for gas, which a conversion
    // there spends on the approval and the route transaction, and Base for
    // both its USDC and the ETH that moves it.
    chain: typeof mainnet | typeof bsc | typeof base = mainnet,
  ) {
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
            ? { chain, asset: "USDC", amount: USDC_FUNDING_PREFILL }
            : { chain },
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
            {monLeads && monRow}
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
            {!monLeads && monRow}
            {nativeGroups.map((g) => (
              <NativeRow
                key={g.symbol}
                group={g}
                price={scan.nativePrices[g.priceId]}
                expanded={expandedKey === `native-${g.symbol}`}
                onToggle={() =>
                  setExpandedKey(
                    expandedKey === `native-${g.symbol}`
                      ? null
                      : `native-${g.symbol}`,
                  )
                }
              />
            ))}
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
                    // Privy's Solana funding config takes only 'native-currency'
                    // or 'USDC' and cannot name an SPL mint, so this one opens
                    // the receive address instead of the widget the two rows
                    // above use. Same destination either way.
                    ...tokenizedAssetOptions("Solana"),
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
                    ...tokenizedAssetOptions("Ethereum"),
                  ],
                },
                {
                  // BNB Chain carries registered stock equivalents, and BNB to
                  // pay for converting them: the approval and the route
                  // transaction are both charged in it, so a wallet holding the
                  // stock and no BNB cannot start.
                  chain: "BNB Chain",
                  chainLogo: "/logos/bnb.png",
                  options: [
                    {
                      id: "bsc-native",
                      label: "BNB",
                      logo: "/logos/bnb.png",
                      disabled: creatingEvm,
                      onSelect: () => handleFundEvm("native-currency", bsc),
                    },
                    ...tokenizedAssetOptions("BNB Chain"),
                  ],
                },
                {
                  // Base carries USDC and the ETH to move it, and nothing else.
                  // No tokenized-asset row: the equivalents registry has no
                  // Base entries, so a stock sent here could not be converted.
                  chain: "Base",
                  chainLogo: "/logos/base.svg",
                  options: [
                    {
                      id: "base-usdc",
                      label: "USDC",
                      logo: "/logos/usdc.png",
                      disabled: creatingEvm,
                      onSelect: () => handleFundEvm("USDC", base),
                    },
                    {
                      id: "base-native",
                      label: "ETH",
                      logo: "/logos/eth.png",
                      disabled: creatingEvm,
                      onSelect: () => handleFundEvm("native-currency", base),
                    },
                    // Offered only once there is something to move, matching
                    // how the Ondo row appears. Base holds nothing that earns,
                    // so this is the row that makes the chain worth listing.
                    ...(BigInt(baseUsdcAtomic) > 0n
                      ? [
                          {
                            id: "base-return",
                            label: "Move USDC to Solana",
                            hint: "Where it can be lent or spent",
                            logo: "/logos/solana.png",
                            onSelect: () => setMovingBase(true),
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
                      logo: "/logos/usdc.png",
                      onSelect: () => setFundingMonad(true),
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
                  chains={SOLANA_RECEIVE_CHAINS}
                  address={walletAddress}
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
                <SheetTitle>Deposit tokenized assets</SheetTitle>
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

          <Sheet open={movingBase} onOpenChange={setMovingBase}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="border-b border-white/10">
                <SheetTitle>Move USDC to Solana</SheetTitle>
                <SheetDescription>
                  Base holds no position and earns nothing here. This brings the
                  balance to Solana, where it can be lent or spent.
                </SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4 py-4">
                <BaseReturnForm
                  solanaAddress={walletAddress}
                  baseUsdcAtomic={baseUsdcAtomic}
                  baseEthWei={baseEthWei}
                  onMoved={async () => {
                    await Promise.all([onRefresh(), scan.refresh()]);
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

// A chain an address can receive on.
type ReceiveChain = {
  name: string;
  logo: string;
};

const SOLANA_RECEIVE_CHAINS: ReceiveChain[] = [
  { name: "Solana", logo: "/logos/solana.png" },
];

// The three chains the embedded EVM wallet can spend on, which is why only
// these three are named. Each is declared in Privy's supportedChains and
// carries something the app uses: registered stock equivalents on the first
// two, USDC and MON gas for Morpho earn on Monad.
const EVM_RECEIVE_CHAINS: ReceiveChain[] = [
  { name: "Ethereum", logo: "/logos/eth.png" },
  { name: "BNB Chain", logo: "/logos/bnb.png" },
  { name: "Base", logo: "/logos/base.svg" },
  { name: "Monad", logo: "/logos/monad.png" },
];

// Which chains an address serves, as a logo row rather than a sentence.
//
// This is the whole header of a receive card. Naming three chains and what each
// one is for ran to four lines a user had to read before doing the one thing
// this panel is for, and the answer they actually need is which chains reach
// this address.
function ChainRow({ chains }: { chains: ReceiveChain[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {chains.map((chain) => (
        <span
          key={chain.name}
          className="flex items-center gap-1.5 text-[11px] leading-none text-white/60"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={chain.logo}
            alt=""
            aria-hidden="true"
            className="h-4 w-4 shrink-0 rounded-full object-cover"
          />
          {chain.name}
        </span>
      ))}
    </div>
  );
}

// One receiving address: which chains reach it, the address, and a way to copy.
//
// `chains` draws the logo row; `label` is the plain-text header the deposit
// panel uses, where each card already names a single chain and a row would only
// repeat it.
function ReceiveAddress({
  label,
  chains,
  address,
  accepts,
  warning,
}: {
  label?: string;
  chains?: ReceiveChain[];
  address: string;
  accepts?: string;
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

  const copyButton = (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        {chains ? (
          <ChainRow chains={chains} />
        ) : (
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            {label}
          </div>
        )}
        {copyButton}
      </div>
      <div className="mt-1.5 break-all font-mono text-xs text-white">
        {address}
      </div>
      {accepts && <p className="mt-1.5 text-[11px] text-white/50">{accepts}</p>}
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
// Which chains it serves, and what each one is for, is EVM_RECEIVE_CHAINS.
// Assets sent on any other EVM chain arrive at this same address and then
// cannot be moved from here, so the warning says so rather than leaving it to
// be discovered. That is the one thing the logo row cannot carry, because it is
// about the chains that are absent from the row.
function EvmReceiveAddress() {
  const { address, ready } = useEmbeddedEvmWallet();
  const { createWallet } = useCreateWallet();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready || !address) {
    // Reloading would not help: an account created before this app asked for an
    // EVM wallet simply does not have one, and Privy only provisions at login.
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
        <ChainRow chains={EVM_RECEIVE_CHAINS} />
        <p className="mt-2 text-[11px] text-white/50">
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
      chains={EVM_RECEIVE_CHAINS}
      address={address}
      warning="Assets sent on any other chain reach this address but cannot be moved."
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

// A gas asset and the chains it sits on. ETH carries two parts once Base is in
// play; BNB and MON carry one each.
interface NativeGroup {
  symbol: string;
  // Coingecko id, shared by every part: it is the same asset either way.
  priceId: string;
  parts: { key: string; chainLabel: string; amount: number }[];
}

// One gas asset. Held on a single chain it renders as a plain row; held on
// several it shows the total and opens to the per-chain breakdown, the way
// UsdcRow does. The badge stays on the collapsed row, because "this is gas" is
// true of the whole group and is the reason the row is in the list at all.
function NativeRow({
  group,
  price,
  expanded,
  onToggle,
}: {
  group: NativeGroup;
  price: number | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const total = group.parts.reduce((sum, p) => sum + p.amount, 0);
  const icon = (
    <AssetLogo
      xstock={{
        symbol: group.symbol,
        name: group.symbol,
        logo: NATIVE_LOGOS[group.symbol],
      }}
      size={30}
    />
  );
  const badge = (
    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
      Gas
    </span>
  );

  if (group.parts.length === 1) {
    return (
      <BalanceRow
        label={group.symbol}
        sublabel={group.parts[0].chainLabel}
        amount={group.parts[0].amount}
        decimals={6}
        usd={price ? group.parts[0].amount * price : null}
        icon={icon}
        badge={badge}
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
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium tracking-tight text-white">
                {group.symbol}
              </span>
              {badge}
            </div>
            {/* The chains by name rather than a count. There are two, they are
                short, and naming them answers the question the row raises
                without making the user open it. */}
            <div className="text-xs text-white/50">
              {group.parts.map((p) => p.chainLabel).join(", ")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-mono text-sm tabular-nums text-white">
              {total.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </div>
            {price != null && (
              <div className="font-mono text-xs text-white/50">
                ${(total * price).toFixed(2)}
              </div>
            )}
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
              key={part.key}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white">
                  {group.symbol}
                </span>
                <span className="text-[10px] text-white/40">
                  {part.chainLabel}
                </span>
              </div>
              <span className="font-mono text-xs tabular-nums text-white">
                {part.amount.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                })}
                {price != null && (
                  <span className="ml-1.5 text-white/50">
                    ${(part.amount * price).toFixed(2)}
                  </span>
                )}
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
