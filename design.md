Yes — Aeras should feel like **institutional DeFi**, not “crypto app.” The screenshot is already close: clean, white, structured, lots of breathing room, neutral palette, precise labels, and product-first controls.

Here’s the full product design direction.

# Aeras Finance product design

## Core design philosophy

Aeras Finance should feel like:

**Robinhood simplicity + Morpho precision + Apple balance sheet clarity.**

The product is financial infrastructure, so the UI should communicate:

**safe, calm, liquid, institutional, fast, transparent.**

No neon crypto gradients. No overdesigned Web3 dashboards. No glassmorphism. No cartoons. No unnecessary illustrations. The product should look like something someone would trust with tokenized equities, commodities, and collateralized lending.

The design language should be:

**minimal, white, sharp, engineered, slightly futuristic.**

## Brand feel

Aeras should visually sit between:

**consumer fintech:** Robinhood, Mercury, Ramp
**institutional markets:** Bloomberg Terminal logic, BlackRock Aladdin, Interactive Brokers
**DeFi-native:** Morpho, Kamino, Drift, Coinbase Advanced

The user should immediately understand:

“I can hold tokenized assets, borrow against them, earn yield, and manage margin safely.”

## Color system

Use the neutral palette as the foundation.

### Neutral

**Neutral 900 — `#15181A`**
Primary text, selected states, major buttons, high-confidence actions.

**Neutral 700 — `#222529`**
Secondary dark surfaces, hover states, dark gradients.

**Neutral 500 — `#383B3E`**
Body text, inactive strong labels, secondary numbers.

**Neutral 300 — `#6F7174`**
Muted labels, helper text, metadata, timestamps.

**Neutral 100 — `#9C9D9F`**
Borders, disabled text, subtle dividers.

**Neutral 0 — `#FFFFFF`**
Main background, cards, forms.

### Blue

**Blue Dark — `#2973FF`**
Primary accent. Use for active links, selected asset, positive product CTAs, loading states, focus rings.

**Blue Medium — `#5792FF`**
Hover states, secondary accents, charts.

**Blue Light — `#C4DAFF`**
Soft backgrounds, informational banners, active tabs in light mode.

### Gradients

Use rarely.

Primary gradient:

`#15181A → #222529`

Use only for:

* primary onboarding CTA
* hero section
* premium/advanced account card
* dark mode command surfaces

Do not use gradients on every button. The product should stay restrained.

## Typography

### Main font

**FK Grotesk**

Use for:

* page titles
* asset names
* balances
* buttons
* product cards
* forms
* navigation

Weights:

* Light: large balance display, calm hero copy
* Regular: body text
* Medium: labels, CTAs, asset symbols

### Monospace / label font

**FK Grotesk SemiMono**

Use for:

* wallet addresses
* token tickers
* APR / LTV / CF values
* transaction hashes
* position IDs
* oracle timestamps
* risk parameters

This is important. SemiMono gives the product the “financial terminal” feeling without making the whole product look like a dev tool.

## UI structure

The interface should be built around five main zones:

### 1. Account header

Top of the app should show:

**Aeras Finance**
email · shortened wallet address · copy
sign out

Keep it minimal like the screenshot.

Add optional status indicators:

`Solana Mainnet`
`Live · 10s`
`Oracle healthy`
`Wallet synced`

Do not clutter the header with navigation early. The current single-page structure is good for MVP.

## 2. Wallet module

This is the user’s balance sheet.

Show:

**Wallet**
Total account value
Token holdings
Funding actions

Example:

```text
WALLET
$11.10

SOL        0.016586      $1.43
USDC       0.71          $0.71
AAPLx      0.000014      $0.00
TSLAx      0.02147       $8.95
```

Actions:

```text
Fund USDC
Fund SOL
Send
```

Later add:

```text
Withdraw
Swap
Transfer
```

Design notes:

* Keep the wallet card bordered, not filled.
* Numbers should right-align.
* Token symbols should be bold.
* Token names should be muted.
* Use SemiMono for balances if possible.

## 3. Asset market grid

This is the browsing layer.

Cards should show:

```text
AAPLx
Apple
$303.24
+1.60%
```

Each card needs:

* tokenized symbol
* underlying name
* oracle or market price
* 24h change
* selected state

Selected asset state:

* `1px` or `1.5px` border in Neutral 900
* no heavy fill
* subtle elevation optional

Do not overuse color. Green and red should only appear on percentage change and risk warnings.

Suggested asset universe for MVP:

```text
AAPLx
TSLAx
NVDAx
METAx
GOOGLx
COINx
SPYx
QQQx
GLDx
SLVx
```

Later:

```text
MSTRx
MSFTx
AMZNx
ETHx
BTCx
USTBx
ONDOx
```

## 4. Price chart module

The screenshot currently says chart unavailable. For the real product, this section should become a clean institutional chart.

Structure:

```text
AAPLx PRICE
$303.24
+1.60%

1D  1W  1M  3M  1Y
```

Chart style:

* no heavy grid
* thin line
* selected timeframe pill in Neutral 900
* muted axis labels
* no crypto-style glowing chart
* show “Oracle price” and “Last updated” underneath

Example metadata:

```text
Oracle: Pyth
Last updated: 10s ago
Market: Open
```

If chart is unavailable, the empty state should be less harsh than red text.

Better empty state:

```text
Price history unavailable
Live oracle price is still available.
```

## 5. Borrow module

This is the most important part of Aeras.

The borrow card should be the core conversion surface.

Current structure is good:

```text
TSLAx → USDC
CF 65% · LT 75% · 2.48% APR
```

Make the card explain itself better.

Recommended layout:

```text
BORROW

TSLAx → USDC
Collateral factor 65% · Liquidation threshold 75% · 2.48% APR

Your collateral
0.0215 TSLAx · $8.96

Oracle price
$417.55

Position #465
Reused on your next borrow in this vault.
```

Inputs:

```text
Deposit TSLAx      0.0215 available   Max
[ 0.0215                      TSLAx ]

Borrow USDC        3.50 max safe       Max
[                            USDC ]
```

Risk preview:

```text
Projected LTV
0.0% / LT 75%
```

CTA states:

Disabled:

```text
Update position
```

Active:

```text
Borrow USDC
```

After borrowing:

```text
Repay
Add collateral
Withdraw collateral
```

## Product information hierarchy

The user should always know these five things:

1. **What do I own?**
2. **What is it worth?**
3. **How much can I borrow?**
4. **What is my risk?**
5. **What action can I take now?**

Every screen should support that.

## Navigation model

For MVP, keep it one-page:

```text
Wallet
Assets
Chart
Borrow
Positions
Activity
```

Later full app navigation:

```text
Portfolio
Markets
Borrow
Earn
Positions
Activity
Settings
```

Mobile bottom nav:

```text
Home
Markets
Borrow
Positions
Account
```

Desktop sidebar:

```text
Aeras

Portfolio
Markets
Borrow
Earn
Positions
Activity

Settings
```

## Key screens

### Screen 1: Portfolio

Purpose: user sees total account value and health.

Sections:

* Total balance
* Wallet holdings
* Open positions
* Borrowed amount
* Net equity
* Health factor
* Available borrow power

Example:

```text
Portfolio
$12,430.51

Net equity
$9,820.20

Borrowed
$2,610.31

Health
2.14x

Borrow power
$3,482.50
```

### Screen 2: Markets

Purpose: choose tokenized assets.

Cards:

* token
* company / asset name
* price
* 24h change
* available borrow APR
* max LTV

Example:

```text
AAPLx
Apple
$303.24
+1.60%
Borrow up to 65%
```

### Screen 3: Asset detail

Purpose: inspect an asset before depositing.

Sections:

* price
* chart
* oracle info
* available vaults
* borrow terms
* liquidity
* risk disclosures

### Screen 4: Borrow

Purpose: deposit collateral and borrow USDC.

Sections:

* selected collateral
* borrow asset
* collateral amount
* borrow amount
* projected LTV
* liquidation price
* APR
* estimated interest
* confirm transaction

### Screen 5: Positions

Purpose: manage open loans.

Each position card:

```text
TSLAx → USDC
Collateral: $8.96
Borrowed: $3.50
LTV: 39.1%
Health: 1.91x
APR: 2.48%

[Repay] [Add collateral] [Withdraw]
```

Risk color:

* Healthy: neutral / subtle blue
* Watch: amber
* Danger: red

### Screen 6: Activity

Purpose: transaction history.

Rows:

```text
Deposited TSLAx
Borrowed USDC
Repaid USDC
Withdrew collateral
Funded wallet
Sent USDC
```

Each row should include:

* timestamp
* amount
* token
* status
* transaction hash

## Component system

### Cards

Default:

```css
background: #FFFFFF;
border: 1px solid rgba(21, 24, 26, 0.12);
border-radius: 16px;
```

Selected:

```css
border: 1.5px solid #15181A;
```

Hover:

```css
border-color: #6F7174;
```

### Buttons

Primary:

* background `#15181A`
* text `#FFFFFF`
* border-radius `12px` or `14px`
* medium weight

Secondary:

* background `#FFFFFF`
* border `#DADCE0` or neutral 100 with opacity
* text `#15181A`

Disabled:

* background `#9C9D9F`
* text white
* cursor disabled

Danger:

* only for liquidation warnings, repay urgency, or destructive actions

### Inputs

Use large, calm financial inputs.

```text
[ 0.0215                         TSLAx ]
```

Rules:

* label above input
* available balance on right
* token symbol inside input on right
* Max button near available amount
* border neutral 100
* focus ring blue light / blue dark

### Pills

Use for:

* timeframes
* selected markets
* risk states
* chain status

Selected:

```css
background: #15181A;
color: #FFFFFF;
```

Unselected:

```css
background: transparent;
color: #6F7174;
```

## Data states

You need polished states for every major module.

### Loading

Use skeleton rows, not spinners everywhere.

```text
Wallet loading...
```

Better:

* skeleton balance
* skeleton asset rows
* shimmer optional, very subtle

### Empty state

Example:

```text
No open positions
Deposit tokenized assets to borrow USDC.
```

### Error state

Avoid harsh red unless money is at risk.

Bad:

```text
Chart unavailable
```

Better:

```text
Price history unavailable
Live oracle price is still available.
```

### Risk warning

Use clear, non-alarming language.

```text
Your projected LTV is close to the liquidation threshold. Add collateral or reduce the borrow amount.
```

## Copy style

Aeras should use plain, precise financial language.

Avoid:

* “unlock your financial future”
* “revolutionary”
* “degen”
* “ape”
* “insane yield”
* “seamless DeFi experience”

Use:

* “Borrow USDC”
* “Deposit collateral”
* “Projected LTV”
* “Liquidation threshold”
* “Available borrow”
* “Oracle price”
* “Position health”

The copy should feel like a brokerage account, not a crypto landing page.

## Risk language

For tokenized assets and lending, risk clarity is part of the design.

Always show:

* collateral factor
* liquidation threshold
* APR
* oracle price
* projected LTV
* liquidation price
* max safe borrow
* borrow utilization
* health factor

Example:

```text
Max safe borrow
$3.50

Liquidation threshold
75%

Projected liquidation price
$312.41
```

## MVP product flow

The first clean flow should be:

1. User connects wallet / signs in.
2. User funds SOL or USDC.
3. User buys or receives tokenized asset.
4. User selects asset.
5. User deposits asset as collateral.
6. User borrows USDC.
7. User monitors position health.
8. User repays or adds collateral.

The product should make this feel like a normal margin account.

## Best MVP layout based on your screenshot

Keep the current stacked layout:

```text
Header
Wallet
Asset Grid
Price Chart
Borrow Card
Positions
Activity
```

This is good because it lets users understand the full product without navigating.

For the demo, I would polish the existing screen instead of adding more pages.

## Immediate UI fixes from the screenshot

The current screen is already strong, but I’d change these:

1. **Make the chart empty state more polished.**
   Replace red “Chart unavailable” with a neutral empty state.

2. **Make the wallet card slightly tighter.**
   Good structure, but balances could align better.

3. **Add clearer borrow preview fields.**
   The borrow card needs liquidation price, health factor, and estimated interest.

4. **Make selected asset state more subtle.**
   The black border is good, but maybe slightly less thick.

5. **Make CTA disabled reason visible.**
   If “Update position” is disabled, say why.

Example:

```text
Enter a borrow amount to continue.
```

6. **Add “Positions” below borrow.**
   This makes it feel like a real lending app, not just a form.

## Final design direction

Aeras Finance should feel like:

```text
A clean institutional lending terminal for tokenized assets.
```

The visual system should be mostly white and neutral, with blue used sparingly for active states and information. The product should prioritize balance sheet clarity, collateral safety, and fast borrowing. The screenshot is a good foundation — now the next step is making it feel more complete by adding chart polish, risk previews, position management, and cleaner empty states.
