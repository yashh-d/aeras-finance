# Rysk Economics

What Rysk earns, where it earns it, and what a partner could expect to earn alongside it.
This is the money question. `rysk.md` is the integration question. They do not overlap.

All figures read from the DefiLlama API on **2026-08-30**. Reproduce with the commands in
"How to refresh" at the bottom. Nothing here is sourced from prose or from a search summary.

## DefiLlama carries Rysk under options, not fees

This trips people up, so it goes first.

- `/summary/fees/rysk-finance` **404s**. There is no fee adapter. Rysk appears nowhere in
  `/overview/fees`.
- `/summary/options/rysk-finance` works and is the real source. It serves two dataTypes,
  `dailyNotionalVolume` and `dailyPremiumVolume`.
- `/protocol/rysk-finance` serves TVL.

Any "Rysk lifetime fees per DefiLlama" figure is therefore not a DefiLlama figure. The
$1.49M number circulating in AI search summaries is the lifetime **notional** volume,
$1,491,991,031, with the unit wrong by a factor of 1000. It is not a fee.

## The three protocols under one parent

The parent `rysk-finance` is an aggregate of three adapters, and the split matters more than
the total does.

| | chain | premium 7d | premium 30d | premium all time |
|---|---|---|---|---|
| Rysk V1 | Arbitrum | none | none | $3,455,360 |
| **Rysk V12** | Hyperliquid L1 | **$402,554** | **$1,349,300** | **$18,735,901** |
| Rysk Premium | Hyperliquid L1, Ethereum | $0 | $4,162 | $205,091 |
| parent total | | $402,554 | $1,353,462 | $22,396,352 |

**V12 is the entire business.** It is 99.7% of trailing-30-day premium and 84% of premium ever.
V1 is dead. Rysk Premium, the vault product, has transacted $205k of premium in its life and
$0 in the last seven days.

That last row is the one to keep in mind, because Rysk Premium is the product the published
50/50 curator split belongs to. The curator revenue line is currently a design, not a revenue
stream.

## Volume

Parent aggregate.

| window | notional | premium | premium / notional |
|---|---|---|---|
| 24h | $4,395,419 | $75,868 | 1.73% |
| 7d | $44,609,580 | $402,554 | 0.90% |
| 30d | $152,137,592 | $1,353,462 | 0.89% |
| 1y | $1,281,918,606 | $18,575,865 | 1.45% |
| all time | $1,491,991,031 | $22,396,352 | 1.50% |

## The fee stack

Rysk clips **5% to 12.5% of the premium paid**, not of notional. For Rysk Premium vaults the
clip is then split evenly, 50% to the protocol and 50% to the strategy curator. Rysk's own
worked example: on a 10,000 USDC premium at a 5% fee, the total fee is 500 USDC, of which the
curator takes 250 and the protocol takes 250.

So the estimate is one multiplication:

```
protocol revenue = premium volume x take rate x 50%
```

The take rate is the only free variable, and it is a documented range rather than a single
number, which is why every figure below is a band.

## What that comes to

| premium basis | annualized | total fee at 5% | at 12.5% | protocol keeps |
|---|---|---|---|---|
| trailing 1y | $18.6m | $929k | $2.32m | **$464k to $1.16m** |
| last 30d x12 | $16.5m | $823k | $2.06m | **$412k to $1.03m** |
| August 2026 run rate | $14.3m | $717k | $1.79m | **$359k to $896k** |
| lifetime, cumulative | $22.4m | $1.12m | $2.80m | $560k to $1.40m ever |

Round number: **$400k to $1.1m a year to the protocol at current volume.**

For context on the scale, Rysk has raised $1.8M. Annual protocol revenue is on the order of
one quarter to two thirds of the money raised.

## Premium is falling while notional rises

Five consecutive months of decline off the March peak.

| month | premium volume | annualized |
|---|---|---|
| 2025-07 | $152,897 | $1.8m |
| 2025-08 | $192,947 | $2.3m |
| 2025-09 | $472,096 | $5.7m |
| 2025-10 | $802,131 | $9.6m |
| 2025-11 | $1,042,376 | $12.5m |
| 2025-12 | $1,212,765 | $14.6m |
| 2026-01 | $849,330 | $10.2m |
| 2026-02 | $1,650,649 | $19.8m |
| 2026-03 | $2,962,818 | $35.6m (peak) |
| 2026-04 | $2,788,747 | $33.5m |
| 2026-05 | $2,072,900 | $24.9m |
| 2026-06 | $1,917,456 | $23.0m |
| 2026-07 | $1,615,312 | $19.4m |
| 2026-08 | $1,195,788 | $14.3m |

August is 60% below the March peak.

Notional went the other way. The 30-day annualized notional run rate is $1.85b against a
trailing-1y figure of $1.28b, so notional is up about 45% while premium is down about 11%.
Premium as a share of notional compressed from 1.45% to 0.89%.

They are writing more contracts for less money. That is vol crush, or shorter tenors, or both.
**The fee rides on premium and not on notional**, so any case built on the "$1.45b notional"
headline is pointing at the line that is not the revenue line.

## TVL, and why it is the wrong denominator

| | |
|---|---|
| latest (2026-08-30) | $52.4m |
| by chain | Hyperliquid L1 $45.6m, Ethereum $6.6m, Arbitrum $0.2m |
| 30d average | $45.5m (range $25.1m to $71.5m) |
| 90d average | $47.4m (range $23.0m to $71.5m) |
| 180d average | $51.5m |

The $71.4m figure that circulates is the peak inside the last 30 days, not a level. TVL
round-tripped from $25m to $71m and back to $52m within the month, so a growth rate measured
off a trough is meaningless here.

Estimating revenue from TVL instead of premium understates it by roughly half. Implied gross
premium yield on capital is $18.6m of trailing premium against $47.4m of 90-day average TVL,
about 39% a year. A vault-style 15% assumption is wrong because the V12 RFQ book turns capital
far faster than a vault does, and maker capital backing the book is not all captured in the
DefiLlama TVL series.

## What this means for Aeras

The number that matters to us is not Rysk's P&L, it is the curator line, and it comes with a
caveat the headline hides.

- **Rate.** A curated Rysk Premium vault pays its curator 50% of a 5% to 12.5% clip on premium.
  Against the observed ~39% gross premium yield on capital, that is roughly **0.4% to 0.9% of
  vault TVL a year** to the curator. A $5m vault is $20k to $45k a year.
- **Comparison.** Same order as a Morpho vault curator fee, and materially less per unit of
  flow than the Ondo builder code, because it is assessed on premium rather than on notional.
- **The caveat.** Rysk Premium did $0 of premium in the last seven days and $205k ever. The
  curator economics are untested at any size. The volume that exists is V12 RFQ, which is a
  different product with a different fee path.

Treat the curator line as an option on Rysk Premium finding volume, not as a revenue forecast.

## How to refresh

```bash
curl -s "https://api.llama.fi/summary/options/rysk-finance?dataType=dailyPremiumVolume"
curl -s "https://api.llama.fi/summary/options/rysk-finance?dataType=dailyNotionalVolume"
curl -s "https://api.llama.fi/overview/options?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyPremiumVolume"
curl -s "https://api.llama.fi/protocol/rysk-finance"
```

The parent summary carries `totalDataChart` as `[unixSeconds, usd]` pairs, which is where the
monthly table comes from. The overview call is the one that breaks V1, V12 and Premium apart;
the parent summary hides the split, and the split is the point.

## What is measured and what is assumed

Measured: every volume, TVL and per-protocol figure above, read from the API on 2026-08-30.

Assumed: the 5% to 12.5% take rate and the 50/50 split are Rysk's published terms, not
observed on-chain receipts. We have not verified what rate is actually charged on a live V12
fill, and V12 may not apply the Premium vault split at all. Verifying it would mean reading a
settled trade, which `scripts/rysk-check.mts` does not currently do.
