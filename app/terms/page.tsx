import type { Metadata } from "next";
import Link from "next/link";

import {
  Caps,
  Contents,
  H2,
  H3,
  LegalPage,
  List,
  P,
} from "@/components/legal/prose";
import { COMPANY, PRIVACY_PATH, TERMS_VERSION } from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: "Terms of Service | Aeras",
  description: `Terms of Service for the Aeras interface, operated by ${COMPANY.legalName}.`,
};

// The Terms of Service. A server component with no client state: the text is
// the deliverable, and the page exists so the Privy login modal, the waitlist
// form and the landing footer have one canonical URL to point at.
//
// Style notes for anyone editing the text: defined terms are capitalised on
// first use and used consistently after; the clauses a court will look at
// hardest (assumption of risk, disclaimers, limitation of liability, release,
// arbitration and class waiver) are set in capitals or bold so they are
// conspicuous, which is what makes them enforceable rather than decorative.

const C = COMPANY;

const TOC: Array<[string, string]> = [
  ["acceptance", "1. Acceptance of these Terms"],
  ["eligibility", "2. Eligibility"],
  ["nature", "3. What Aeras Is and Is Not"],
  ["wallets", "4. Wallets, Keys and Custody"],
  ["third-parties", "5. Third-Party Protocols and Services"],
  ["tokenized-assets", "6. Tokenized Assets"],
  ["risks", "7. Assumption of Risk"],
  ["no-advice", "8. No Advice; No Fiduciary Relationship"],
  ["fees", "9. Fees, Network Costs and Pricing"],
  ["transactions", "10. Transactions Are Final"],
  ["compliance", "11. Compliance, Sanctions and Taxes"],
  ["conduct", "12. Prohibited Conduct"],
  ["access", "13. Access, Availability and Changes"],
  ["ip", "14. Intellectual Property and License"],
  ["privacy", "15. Privacy"],
  ["disclaimers", "16. Disclaimer of Warranties"],
  ["liability", "17. Limitation of Liability"],
  ["indemnification", "18. Indemnification"],
  ["release", "19. Release"],
  ["arbitration", "20. Dispute Resolution and Binding Arbitration"],
  ["law", "21. Governing Law and Venue"],
  ["general", "22. General Provisions"],
  ["contact", "23. Contact"],
];

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={TERMS_VERSION} brand={C.shortName}>
      <div className="mt-8 rounded-md border border-neutral-200 bg-neutral-50 p-5 text-sm leading-6 text-neutral-800">
        <p className="font-semibold">Please read these Terms carefully.</p>
        <p className="mt-2">
          They govern your use of the {C.shortName} interface and contain
          provisions that affect your legal rights, including an assumption of
          risk (Section 7), a disclaimer of warranties (Section 16), a
          limitation of liability (Section 17), a release (Section 19), and an
          agreement to resolve disputes by binding individual arbitration with a
          class action and jury trial waiver (Section 20). By creating an
          account, requesting access, or using the Services you agree to them.
          If you do not agree, do not use the Services.
        </p>
      </div>

      <Contents entries={TOC} />

      {/* 1 */}
      <H2 id="acceptance">1. Acceptance of these Terms</H2>
      <P>
        These Terms of Service (the “<strong>Terms</strong>”) are a
        binding agreement between you (“<strong>you</strong>” or
        “<strong>User</strong>”) and {C.legalName}, a{" "}
        {C.stateOfIncorporation} corporation (“
        <strong>{C.shortName}</strong>,” “<strong>we</strong>,”
        “<strong>us</strong>” or “<strong>our</strong>”).
        They govern your access to and use of the website at {C.domain} and its
        subdomains, the {C.shortName} web application, the application
        programming interfaces we expose, and any related software, content,
        tools and features we make available (together, the “
        <strong>Services</strong>”).
      </P>
      <P>
        You accept these Terms by doing any of the following: submitting the
        access request form; signing in or creating an account, including
        through an email address, a social login, or a connected wallet;
        clicking a button or checking a box that references these Terms; or
        otherwise accessing or using the Services. Each of these is an
        electronic signature to these Terms with the same force as a signature
        in ink. If you use the Services on behalf of an entity, you represent
        that you are authorized to bind it, and “you” includes that
        entity.
      </P>
      <P>
        We may revise these Terms at any time by posting the revised version at
        this address and updating the “Last updated” date. Material
        changes will be indicated at sign-in or by notice within the Services.
        Your continued use of the Services after a revision takes effect is
        acceptance of the revised Terms. If you do not agree to a revision, your
        only remedy is to stop using the Services and, where applicable, close
        your positions and withdraw your assets, which you can do at any time.
        Changes to Section 20 (Dispute Resolution) do not apply to a dispute of
        which we received written notice before the change took effect.
      </P>
      <P>
        These Terms incorporate by reference our{" "}
        <Link href={PRIVACY_PATH} className="underline underline-offset-4">
          Privacy Policy
        </Link>{" "}
        and any supplemental terms, disclosures or risk notices we present to you within
        the Services for a particular feature, asset, venue or chain (“
        <strong>Supplemental Terms</strong>”). If Supplemental Terms
        conflict with these Terms, the Supplemental Terms control for that
        feature only.
      </P>

      {/* 2 */}
      <H2 id="eligibility">2. Eligibility</H2>
      <P>By using the Services you represent and warrant, on each day you use them, that:</P>
      <List
        items={[
          <>You are at least 18 years old and have the legal capacity to enter into a binding contract.</>,
          <>
            You are not a resident, citizen or national of, located in, incorporated in, or otherwise subject to the laws of, any jurisdiction that is the subject of comprehensive sanctions administered by the United States, the United Kingdom, the European Union or the United Nations, which as of the date above include Cuba, Iran, North Korea, Syria and the Crimea, Donetsk and Luhansk regions of Ukraine, or any other jurisdiction in which use of the Services would be unlawful (each a “<strong>Restricted Jurisdiction</strong>”).
          </>,
          <>
            You are not, and do not act on behalf of, a person or entity named on the U.S. Treasury Department’s Specially Designated Nationals and Blocked Persons List, the Consolidated Sanctions List, or any equivalent list maintained by any government (a “<strong>Sanctioned Person</strong>”), and you are not owned or controlled by a Sanctioned Person.
          </>,
          <>You have not previously been suspended or removed from the Services and are not using the Services on behalf of anyone who has.</>,
          <>
            You satisfy every eligibility requirement imposed by the issuer, protocol, venue or counterparty of any Digital Asset (defined in Section 6) you acquire, hold, lend, borrow against or otherwise interact with through the Services, including any requirement that you not be a “U.S. person” within the meaning of Regulation S under the U.S. Securities Act of 1933 where the asset is offered in reliance on it, and you will not use the Services to acquire any Digital Asset you are not eligible to hold.
          </>,
          <>Your use of the Services does not violate any law, regulation or contractual obligation applicable to you, and all funds and Digital Assets you use with the Services are lawfully yours and were lawfully obtained.</>,
          <>You will not use a virtual private network, proxy, or any other means to conceal your location or to circumvent any geographic, jurisdictional or eligibility restriction implemented by us or by any third party whose protocol or service the interface reaches.</>,
        ]}
      />
      <P>
        Some features, assets and venues are unavailable in some jurisdictions,
        including the United States, and we may restrict, block or reverse
        access to any feature by jurisdiction, at any time, based on any signal
        available to us, including the network location of your requests. Our
        implementation of any restriction is a courtesy and not an undertaking:
        you, and not we, are responsible for determining whether your use of any
        feature is lawful for you.
      </P>
      <P>
        Access to the Services is currently limited to users we approve from a
        waitlist. Approval is at our sole discretion, may be revoked at any time,
        and is not a representation about you or about the Services.
      </P>

      {/* 3 */}
      <H2 id="nature">3. What {C.shortName} Is and Is Not</H2>
      <P>
        <strong>{C.shortName} is software.</strong> The Services are a
        user interface that displays information read from public blockchains
        and third-party data sources and that helps you construct transactions
        which you then authorize and which are then executed by autonomous
        smart contracts and third-party protocols on public blockchain networks
        that we do not own, operate or control. When you buy a tokenized asset,
        lend it, borrow against it, stake, provide liquidity, hedge, convert
        between chains or take any other action through the interface, the
        counterparty to that transaction is the relevant protocol or its other
        users, never {C.shortName}.
      </P>
      <P>
        <strong>{C.shortName} is not:</strong>
      </P>
      <List
        items={[
          <>a bank, trust company, money transmitter, money services business, payment processor or other financial institution;</>,
          <>a broker, dealer, investment adviser, commodity trading advisor, futures commission merchant, introducing broker, transfer agent, clearing agency or exchange, and it is not registered as any of these with the U.S. Securities and Exchange Commission, the U.S. Commodity Futures Trading Commission, FINRA, the NFA or any other regulator in any jurisdiction;</>,
          <>a custodian of your funds, Digital Assets or private keys (see Section 4);</>,
          <>the issuer, sponsor, underwriter, market maker, liquidity provider or guarantor of any Digital Asset, tokenized equity, stablecoin, yield, interest rate, or protocol;</>,
          <>a party to, or a guarantor of, any smart contract, loan, deposit, liquidity position, perpetual contract, portfolio strategy or other arrangement you enter through the interface;</>,
          <>a fiduciary, agent, trustee or adviser to you in any capacity.</>,
        ]}
      />
      <P>
        Words used in the interface such as “account,”
        “deposit,” “earn,” “yield,”
        “APY,” “borrow,” “vault,”
        “portfolio,” “position” and “card”
        are descriptive labels for on-chain states and third-party products.
        They do not indicate a deposit account, a bank product, a security, an
        insured product, a guaranteed return, or any relationship of trust or
        custody with {C.shortName}. Nothing you hold through the Services is
        insured by the Federal Deposit Insurance Corporation, the Securities
        Investor Protection Corporation or any other public or private
        insurance scheme.
      </P>

      {/* 4 */}
      <H2 id="wallets">4. Wallets, Keys and Custody</H2>
      <P>
        <strong>We never hold your keys.</strong> When you sign in, embedded
        wallets on the Solana network and on Ethereum-compatible networks are
        provisioned for you by Privy, Inc. (“<strong>Privy</strong>”),
        an independent third-party wallet infrastructure provider, under
        Privy’s own terms of service and privacy policy. Key material for
        those wallets is generated and secured by Privy’s systems and by
        your own authentication device or session; it is never generated,
        stored, transmitted to, held by, or recoverable by {C.shortName}.
        {" "}{C.shortName} cannot access your wallets, move your assets, sign on your
        behalf, reverse a transaction, freeze or recover assets, or restore
        access to a wallet you have lost the ability to authenticate to.
      </P>
      <P>
        If you sign in with an external wallet you already control, that wallet
        is a login credential and a source of funds. Positions and balances the
        interface shows belong to your embedded wallets, and the same limits on
        our access apply to both.
      </P>
      <P>
        You are solely responsible for the security of the email account, social
        login, passkey, device, seed phrase, private key and any other
        credential through which your wallets can be reached, and for every
        transaction authorized from them, whether or not you intended it. If
        you lose access to your credentials, or someone else obtains them, you
        may permanently lose all of your assets, and we will have no liability
        for that loss and no ability to remedy it.
      </P>
      <P>
        To let transactions that consist of several on-chain steps read as one
        action, the interface may request signatures from your embedded wallets
        without presenting a separate wallet confirmation window for each step.
        Each such action is previewed in the interface before you start it. By
        starting an action you authorize every signature it requires, and you
        accept that an action which has begun may be partially completed if a
        later step fails, is rejected by a network, or is interrupted, leaving
        assets on an intermediate chain or in an intermediate state that you
        will need to resolve yourself using the tools the interface provides.
      </P>

      {/* 5 */}
      <H2 id="third-parties">5. Third-Party Protocols and Services</H2>
      <P>
        The Services are a thin layer over software and services that belong to
        others (“<strong>Third-Party Services</strong>”). These
        include, without limitation and as they change from time to time: wallet
        infrastructure (Privy); the Solana, Ethereum, BNB Chain, Base, Monad and
        Robinhood Chain networks and their validators and sequencers; swap
        routing and trigger orders (Jupiter); lending, borrowing and vault
        protocols (Kamino, Jupiter Lend, Morpho, Aave, Blend, FastLane shMONAD);
        liquidity protocols (Uniswap); managed portfolio infrastructure (Glider)
        and the model portfolios it runs (Bitwise); perpetual futures venues
        (Lighter, Ondo Global Markets); cross-chain routing and bridging
        (Trustware and the bridges and solvers it routes through); tokenized
        asset issuers (Backed Finance for xStocks, Ondo Finance, Coinbase,
        Paxos, Tether and others); card issuance and processing (Rain); fiat
        funding providers (MoonPay, Coinbase and others offered through Privy);
        oracles, indexers, RPC providers and market data providers (Alchemy,
        Helius, Chainlink, CoinGecko, Nasdaq, TradingView and others); and
        infrastructure and hosting (Vercel, Supabase).
      </P>
      <P>
        We do not own, operate, control, audit, endorse, or assume any
        responsibility for any Third-Party Service. Each is governed by its own
        terms, which you agree to be bound by when you use it through the
        interface, and each may impose its own eligibility requirements, fees,
        limits, delays, lock-ups, cooldowns, slashing, liquidation rules, and
        geographic restrictions, and may pause, upgrade, fork, deprecate, or
        shut down at any time without notice to us or to you. Smart contracts
        may be immutable and may contain defects we cannot detect or fix.
        Interest rates, yields, fee rates, collateral factors, liquidation
        thresholds, oracle prices and campaign incentives displayed in the
        interface are read from Third-Party Services, may be stale, inaccurate
        or manipulated, and may change at any moment, including between when
        you preview an action and when it executes.
      </P>
      <Caps>
        You acknowledge that {C.shortName} has no ability to, and does not,
        guarantee the performance, security, solvency, availability, legality
        or continued existence of any Third-Party Service, and that your sole
        recourse for any loss arising from a Third-Party Service is against
        that Third Party.
      </Caps>

      {/* 6 */}
      <H2 id="tokenized-assets">6. Tokenized Assets</H2>
      <P>
        “<strong>Digital Assets</strong>” means cryptocurrencies,
        stablecoins, tokenized representations of equities, funds, commodities,
        treasuries or other real-world assets, liquid staking tokens, vault
        shares, liquidity position tokens, and any other blockchain-based token
        or position, in each case as made available through the interface.
      </P>
      <H3>Tokenized equities and other tokenized real-world assets</H3>
      <P>
        Tokenized stocks (including xStocks issued by Backed Finance, tokens
        issued by Ondo Finance, and tokenized stocks issued by Coinbase),
        tokenized funds, and tokenized commodities are issued by third parties
        under their own legal structures, prospectuses, terms and eligibility
        rules. <strong>A tokenized stock is not the stock.</strong> Holding one
        does not make you a shareholder of the underlying company and does not
        give you voting rights, the right to attend meetings, the right to
        receive dividends directly from the issuer of the underlying security,
        rights in a bankruptcy of the underlying company, or any other right of
        a shareholder. Whatever economic exposure the token carries depends
        entirely on the issuer’s structure, its solvency, its custodian,
        its ability and willingness to honor redemptions, and the law of the
        jurisdiction it operates in. Tokenized gold and other commodity tokens
        depend in the same way on the issuer holding and safeguarding the
        physical metal.
      </P>
      <P>
        Many of these assets are offered only to persons outside the United
        States, in reliance on Regulation S or similar exemptions, and their
        issuers may impose know-your-customer, transfer, and redemption
        restrictions at the issuer level even where the token trades freely on
        decentralized exchanges. We are not the issuer, we do not perform the
        issuer’s eligibility checks, and we make no representation that
        you are eligible to hold any asset or that any asset is a lawful
        security, commodity or other instrument in your jurisdiction. You are
        responsible for reading each issuer’s terms and confirming your
        own eligibility before acquiring an asset.
      </P>
      <H3>Stablecoins</H3>
      <P>
        Stablecoins such as USDC, USDT and USDG are issued by third parties and
        depend on those issuers’ reserves, redemption practices and
        regulatory standing. A stablecoin may lose its peg, be frozen at the
        contract level by its issuer, or become unredeemable. We do not issue
        or back any stablecoin.
      </P>
      <H3>Displayed prices and values</H3>
      <P>
        Prices, balances, portfolio values, performance figures, historical
        returns, compound annual growth rates, and rates of return shown in the
        interface are computed from third-party data and on-chain reads, are
        provided for information only, may be delayed or wrong, and are not an
        offer to buy or sell at any price. Backtested or model performance is
        hypothetical, does not reflect actual trading, and is not a guarantee
        of future results. Past performance of any asset, strategy or venue is
        not indicative of future performance.
      </P>

      {/* 7 */}
      <H2 id="risks">7. Assumption of Risk</H2>
      <Caps>
        You acknowledge that the use of Digital Assets, blockchain networks,
        smart contracts, decentralized protocols, leverage, derivatives and
        cross-chain bridges involves significant risk, including the risk of
        the total and permanent loss of everything you commit to them. You
        accept and assume every such risk, whether or not it is listed below,
        and agree that {C.shortName} bears none of it.
      </Caps>
      <P>Without limiting the foregoing, you understand and accept the following risks:</P>
      <List
        items={[
          <><strong>Market risk.</strong> Digital Assets are volatile. The value of any asset, including a tokenized equity, may fall to zero. Prices on decentralized venues may differ from prices on traditional exchanges, may gap, and may be illiquid, especially outside the trading hours of the underlying market.</>,
          <><strong>Liquidation risk.</strong> If you borrow against collateral, a fall in the collateral’s price, a rise in the borrowed asset’s price, accrued interest, an oracle update, or a change in the protocol’s risk parameters may cause some or all of your collateral to be sold by the protocol or by third-party liquidators, at a discount, without notice, and with no ability for you or us to stop it. Leveraged strategies multiply this risk. Health figures, liquidation prices and “safe” ratios shown in the interface are estimates computed from third-party inputs and are not guarantees.</>,
          <><strong>Smart contract and protocol risk.</strong> Any protocol may contain bugs, be exploited, be drained, be governed badly, change its parameters, be upgraded in ways that harm you, pause withdrawals, or fail entirely. Audits reduce but do not eliminate this risk.</>,
          <><strong>Counterparty and issuer risk.</strong> Issuers of tokenized assets and stablecoins, portfolio managers, perpetual futures venues, vault curators and bridge operators may become insolvent, be sanctioned, be shut down by a regulator, refuse redemptions, freeze tokens, or act dishonestly.</>,
          <><strong>Yield and rate risk.</strong> Every rate shown is variable, read live from a third-party protocol, and may fall to zero or turn negative at any time. Incentive campaigns, boosts and rewards are discretionary, may be reduced or ended without notice by the party offering them, and may be paid in tokens that have no value. Certain venues expose your deposit to first loss on the protocol’s bad debt in exchange for a higher rate.</>,
          <><strong>Liquidity and lock-up risk.</strong> Some positions cannot be exited instantly. Vaults may lack the liquidity to honor a withdrawal; staking venues may impose cooldowns, queues or exit fees; liquidity pools may be exited only at the then-current price; portfolio strategies may take time to liquidate. A venue that allowed instant exit yesterday may not today.</>,
          <><strong>Impermanent loss.</strong> Providing liquidity to an automated market maker exposes you to both assets in the pair and may leave you with less value than if you had simply held them.</>,
          <><strong>Derivatives risk.</strong> Perpetual futures are leveraged instruments. You may lose more than your margin, be liquidated in seconds, pay or receive funding rates that change continuously, and be unable to close a position when you want to. A “hedge” opened through the interface may not perfectly offset the position it was sized against.</>,
          <><strong>Cross-chain and bridge risk.</strong> Moving assets between networks relies on third-party bridges and solvers. Transfers may be delayed, may complete on one leg and fail on another, may deliver less than quoted, may deliver a different token than expected, or may lose assets entirely. Assets delivered to a network where you hold no gas token may be stranded until you fund gas.</>,
          <><strong>Network risk.</strong> Blockchain networks may be congested, halt, reorganize, fork or be attacked. Transactions may fail after fees are paid, be delayed, be front-run, or execute at a worse price than previewed. Transaction fees, priority fees and slippage are paid by you and are not refundable.</>,
          <><strong>Oracle and data risk.</strong> Protocols price assets from oracles that may be stale, manipulated or wrong, causing liquidations or mispriced trades. The information the interface displays comes from indexers and data providers that may be down, delayed or inaccurate.</>,
          <><strong>Key and credential risk.</strong> Loss of, or unauthorized access to, the credentials that control your wallets means loss of your assets, with no recourse to us, to Privy, or to anyone (see Section 4).</>,
          <><strong>Regulatory risk.</strong> The legal treatment of Digital Assets, tokenized securities, stablecoins, decentralized lending and derivatives is uncertain and changing in every jurisdiction. New laws, enforcement actions or interpretations may make an asset or activity unlawful, may restrict or prohibit the Services or a Third-Party Service in your jurisdiction, may impose tax or reporting obligations on you, or may require assets to be frozen or surrendered.</>,
          <><strong>Software risk.</strong> The Services are provided in an early stage of development and may contain errors, including errors in the figures, previews and estimates they display and in the transactions they construct. You are responsible for reviewing every action before you authorize it.</>,
          <><strong>Tax risk.</strong> Transactions through the Services, including swaps, deposits, withdrawals, bridge transfers, rebalances and liquidations, may be taxable events. We do not provide tax advice, tax reporting, or cost-basis tracking.</>,
        ]}
      />
      <P>
        You represent that you have the knowledge and experience to evaluate
        the merits and risks of the transactions you enter through the
        Services, that you have sought whatever independent professional advice
        you consider necessary, that you are using only funds you can afford to
        lose entirely, and that you are not relying on any statement by{" "}
        {C.shortName} or its personnel in deciding to transact.
      </P>

      {/* 8 */}
      <H2 id="no-advice">8. No Advice; No Fiduciary Relationship</H2>
      <P>
        Nothing in the Services, on our website, in our documentation, in our
        communications, or in any content the interface displays (including
        rankings, “best rate” figures, default selections, named
        strategies and their descriptions, model portfolios, news, earnings
        data, analyst figures, or educational material) is investment, legal,
        tax, accounting or financial advice, a recommendation, an offer to sell
        or a solicitation of an offer to buy any security, commodity, derivative
        or other instrument, or an endorsement of any asset, protocol or
        strategy. Any strategy the interface names or lets you assemble is a
        preset of on-chain actions you choose to run, not a recommendation that
        you run it, and its outcome is entirely your responsibility.
      </P>
      <P>
        You alone decide whether any transaction is appropriate for you. We owe
        you no fiduciary duty, duty of care, duty of best execution, duty of
        suitability, or any other duty beyond those expressly stated in these
        Terms, and you agree that no such duty arises from your use of the
        Services, from any feature that defaults, ranks or highlights an
        option, or from any communication with us.
      </P>

      {/* 9 */}
      <H2 id="fees">9. Fees, Network Costs and Pricing</H2>
      <P>
        We may charge fees for the Services, and we may change them at any time
        by displaying the new fee within the interface before you authorize the
        action it applies to. In addition, and regardless of any fee we charge,
        you are responsible for all network transaction fees, priority fees,
        account rent, gas on every chain a transaction touches, bridge and
        solver fees, protocol fees, swap fees, price impact and slippage, and
        any fee charged by a Third-Party Service. Estimates of these costs
        shown in the interface are estimates only. We may receive
        compensation from Third-Party Services in connection with your
        activity, including referral, builder, integrator or affiliate fees,
        and you consent to our receipt of that compensation.
      </P>
      <P>
        Where a first transaction at a venue requires on-chain accounts to be
        created, the interface may, with your authorization, sell a small amount
        of your assets to cover that cost or open a third-party funding flow.
        Any fiat funding is provided by the third party you select under its own
        terms, fees and identity checks, and we are not a party to it.
      </P>

      {/* 10 */}
      <H2 id="transactions">10. Transactions Are Final</H2>
      <P>
        Every transaction you authorize is broadcast to a public blockchain and,
        once confirmed, is irreversible. We cannot cancel, reverse, refund,
        modify, expedite or recover any transaction or any asset sent to a wrong
        address, an unsupported network, a contract that does not accept it, or
        an address you no longer control. Amounts, destinations, chains and
        counterparties are your responsibility to verify before you authorize.
        We are not responsible for any transaction that executes at a price,
        rate, fee or outcome different from a preview or estimate.
      </P>
      <P>
        The interface may record the state of your positions and in-progress
        multi-step actions so that they can be resumed after an interruption.
        That record is a convenience: the blockchain is the only authoritative
        record of what you hold and owe, and where the two differ, the chain
        controls.
      </P>

      {/* 11 */}
      <H2 id="compliance">11. Compliance, Sanctions and Taxes</H2>
      <P>
        You are solely responsible for complying with all laws that apply to
        you, including securities, commodities, banking, money transmission,
        consumer protection, sanctions, export control, anti-money laundering,
        counter-terrorist financing, privacy and tax laws, and for obtaining any
        license, registration or approval your use of the Services requires.
      </P>
      <P>
        We may, but are not obliged to, screen wallet addresses, network
        locations and identities against sanctions lists and risk indicators,
        and we may restrict, suspend or terminate access, refuse to construct a
        transaction, or report activity to a competent authority where we
        believe in good faith that doing so is required by law or appropriate
        to manage legal, regulatory or reputational risk, without notice and
        without liability to you. Because we do not custody assets, any such
        restriction limits your use of the interface but does not restrict your
        ability to access your wallets by other means.
      </P>
      <P>
        You are solely responsible for determining what taxes apply to your
        transactions and for reporting and paying them. We do not withhold
        taxes, issue tax forms, or track your cost basis, and we may be required
        to disclose your activity to tax authorities.
      </P>

      {/* 12 */}
      <H2 id="conduct">12. Prohibited Conduct</H2>
      <P>You agree that you will not, and will not assist or permit anyone else to:</P>
      <List
        items={[
          <>use the Services in violation of any law, regulation, sanction, or these Terms, or for money laundering, terrorist financing, fraud, tax evasion, or any other illegal purpose;</>,
          <>use the Services from a Restricted Jurisdiction, while a Sanctioned Person, or to transact with a Sanctioned Person, or circumvent any geographic or eligibility restriction;</>,
          <>engage in market manipulation of any kind, including wash trading, spoofing, layering, front-running, pump-and-dump schemes, or exploiting an oracle, pricing or incentive mechanism;</>,
          <>exploit, or attempt to exploit, any bug, defect or unintended behavior in the Services or any Third-Party Service, including any error in a displayed figure, quote, rate or estimate, rather than reporting it to us;</>,
          <>interfere with, disrupt, overload, or attempt to gain unauthorized access to the Services, our servers, our API keys, our rate limits, or any account or wallet that is not yours, or probe, scan or test the vulnerability of any system without our written permission;</>,
          <>scrape, crawl, harvest or systematically extract data from the Services, or use the Services or our APIs to build a competing product, other than as permitted by a written agreement with us;</>,
          <>reverse engineer, decompile, disassemble or otherwise attempt to derive the source code of any part of the Services that is not published under an open-source license;</>,
          <>use any automated means, bot, script or software to access the Services in a way that we have not expressly permitted;</>,
          <>impersonate any person or entity, misrepresent your affiliation with any person or entity, or provide false, inaccurate or misleading information, including about your identity, location or eligibility;</>,
          <>upload or transmit any virus, malicious code or harmful content, or infringe any intellectual property, privacy or other right of any person;</>,
          <>use the Services to provide services to third parties, hold assets for third parties, or act as an intermediary, without our written agreement;</>,
          <>encourage or enable any other person to do any of the above.</>,
        ]}
      />
      <P>
        We may investigate any suspected violation, may suspend or terminate
        your access for any violation or suspected violation without notice,
        and may cooperate with law enforcement and regulators.
      </P>

      {/* 13 */}
      <H2 id="access">13. Access, Availability and Changes</H2>
      <P>
        The Services are provided in a beta form and are under continuous
        development. We may add, change, suspend, remove or discontinue any
        feature, asset, venue, chain, strategy or the entire Services at any
        time, with or without notice, and we have no obligation to maintain,
        support, update or continue to offer any of them. We may set and change
        limits on transaction sizes, frequencies, and features.
      </P>
      <P>
        We may suspend or terminate your access to the Services at any time, for
        any reason or no reason, with or without notice, including if we believe
        you have violated these Terms, if required by law, if a Third-Party
        Service or a regulator requires it, or if we discontinue the Services.
        You may stop using the Services at any time. Because we do not custody
        your assets, termination of your access to the interface does not
        affect your ownership of or ability to reach your assets by other
        means, including directly through the relevant protocol, an exported
        key, or Privy’s own recovery tools, and you are responsible for
        doing so. Sections that by their nature should survive termination,
        including Sections 3 through 12 and 14 through 23, survive.
      </P>

      {/* 14 */}
      <H2 id="ip">14. Intellectual Property and License</H2>
      <P>
        The Services, including all software, code, designs, text, graphics,
        logos, trademarks, data compilations and other content we provide, are
        owned by {C.shortName} or its licensors and are protected by copyright,
        trademark and other laws. Except for any component we make available
        under an open-source license, which is governed by that license, we
        grant you a limited, revocable, non-exclusive, non-transferable,
        non-sublicensable license to access and use the Services for your own
        personal or internal business purposes in accordance with these Terms.
        All rights not expressly granted are reserved. “Aeras” and
        our logos are our trademarks; third-party names and logos shown in the
        interface belong to their owners and are used only to identify the
        assets and integrations they refer to, without implying endorsement.
      </P>
      <P>
        If you send us feedback, suggestions or ideas, you grant us a
        perpetual, irrevocable, worldwide, royalty-free license to use them for
        any purpose without obligation to you.
      </P>

      {/* 15 */}
      <H2 id="privacy">15. Privacy</H2>
      <P>
        Our{" "}
        <Link href={PRIVACY_PATH} className="underline underline-offset-4">
          Privacy Policy
        </Link>{" "}
        describes what information we collect, how we use it and with whom we
        share it, and is incorporated into these Terms. You
        acknowledge that blockchain transactions are public, permanent and
        traceable, that your wallet addresses and everything they do are
        visible to anyone, and that we cannot delete or anonymize on-chain data.
        You acknowledge that Third-Party Services collect and process your
        information under their own policies, and that we may share information
        about you with Third-Party Services as needed to provide the Services
        and with authorities where required by law.
      </P>

      {/* 16 */}
      <H2 id="disclaimers">16. Disclaimer of Warranties</H2>
      <Caps>
        The Services, and all information, content, software, tools, Digital
        Assets and Third-Party Services made available through them, are
        provided “as is,” “as available” and “with
        all faults,” without warranty of any kind. To the fullest extent
        permitted by law, {C.shortName} and its affiliates, and their respective
        officers, directors, employees, contractors, agents, licensors,
        suppliers and service providers (the “<strong>{C.shortName}{" "}
        Parties</strong>”) expressly disclaim all warranties, whether
        express, implied, statutory or otherwise, including any warranty of
        merchantability, fitness for a particular purpose, title,
        non-infringement, accuracy, quiet enjoyment, and any warranty arising
        from course of dealing, usage or trade.
      </Caps>
      <Caps>
        Without limiting the foregoing, the {C.shortName} Parties make no
        warranty or representation that the Services will meet your
        requirements; will be available, uninterrupted, timely, secure or
        error-free; that any information, figure, price, rate, estimate,
        preview, balance or position displayed will be accurate, complete,
        current or reliable; that any transaction will execute, execute at any
        particular price or time, or produce any particular result; that any
        Digital Asset will retain any value, remain transferable, or remain
        redeemable; that any Third-Party Service will perform, remain
        available, or remain solvent; that any defect will be corrected; or
        that the Services or the servers that make them available are free of
        viruses or other harmful components.
      </Caps>
      <P>
        Some jurisdictions do not allow the exclusion of certain warranties, so
        some of the above exclusions may not apply to you. In that case the
        warranties are limited to the minimum scope and duration the law
        requires.
      </P>

      {/* 17 */}
      <H2 id="liability">17. Limitation of Liability</H2>
      <Caps>
        To the fullest extent permitted by applicable law, in no event will any
        of the {C.shortName} Parties be liable to you or to any third party for
        any indirect, incidental, special, consequential, exemplary or punitive
        damages, or for any loss of profits, revenue, business, goodwill,
        opportunity, data, or Digital Assets, or for any diminution in value,
        cost of substitute goods or services, or any loss arising from any of
        the risks described in Section 7, arising out of or in connection with
        these Terms or the Services, however caused and under any theory of
        liability, whether in contract, tort (including negligence), strict
        liability, statute or otherwise, even if a {C.shortName} Party has been
        advised of the possibility of such damages and even if a limited remedy
        fails of its essential purpose.
      </Caps>
      <Caps>
        Without limiting the foregoing, the {C.shortName} Parties will have no
        liability whatsoever for: (a) any act, omission, failure, insolvency,
        exploit, or unavailability of any blockchain network or Third-Party
        Service; (b) any loss, theft, unauthorized use or compromise of your
        credentials, devices or wallets; (c) any transaction you authorize,
        including any that executes at a different price, rate, fee or outcome
        than previewed; (d) any liquidation, slashing, lock-up, cooldown, fee,
        or refusal of a withdrawal by any protocol; (e) any error, delay or
        inaccuracy in any information, figure or estimate displayed; (f) any
        change in the value, transferability, redeemability, legality or
        regulatory treatment of any Digital Asset; (g) any suspension,
        restriction or termination of your access to the Services; (h) any
        event beyond our reasonable control; or (i) any act or omission of any
        other user or any third party.
      </Caps>
      <Caps>
        To the fullest extent permitted by law, the total aggregate liability
        of the {C.shortName} Parties to you for all claims arising out of or
        relating to these Terms or the Services, from whatever cause and under
        whatever theory, will not exceed the greater of (i) one hundred U.S.
        dollars (US$100) and (ii) the total fees you paid directly to{" "}
        {C.shortName} (excluding network fees, protocol fees and fees paid to
        Third-Party Services) for the Services in the twelve (12) months
        immediately before the event giving rise to the claim.
      </Caps>
      <P>
        The limitations in this Section are fundamental elements of the basis
        of the bargain between you and {C.shortName}, and the Services would not
        be provided without them. Some jurisdictions do not allow the exclusion
        or limitation of certain damages, so some of the above may not apply to
        you; in that case the liability of the {C.shortName} Parties is limited
        to the fullest extent the law permits. Nothing in these Terms limits
        liability that cannot be limited by law, including liability for fraud
        or for death or personal injury caused by negligence where such law
        applies.
      </P>

      {/* 18 */}
      <H2 id="indemnification">18. Indemnification</H2>
      <P>
        To the fullest extent permitted by law, you agree to defend, indemnify
        and hold harmless the {C.shortName} Parties from and against any and all
        claims, demands, actions, investigations, damages, losses, liabilities,
        judgments, settlements, penalties, fines, costs and expenses (including
        reasonable attorneys’ fees and costs) arising out of or relating
        to: (a) your access to or use of the Services; (b) any transaction you
        authorize or any Digital Asset you acquire, hold, lend, borrow against,
        or transfer through the Services; (c) your breach or alleged breach of
        these Terms, including any representation in Section 2; (d) your
        violation of any law, regulation or third-party right; (e) any tax
        obligation arising from your activity; (f) your negligence or willful
        misconduct; or (g) any dispute between you and any Third-Party Service
        or other user. We may assume the exclusive defense and control of any
        matter subject to indemnification by you, at your expense, and you
        agree to cooperate with our defense and not to settle any such matter
        without our prior written consent.
      </P>

      {/* 19 */}
      <H2 id="release">19. Release</H2>
      <P>
        To the fullest extent permitted by law, you release, and forever
        discharge, the {C.shortName} Parties from any and all past, present and
        future claims, demands, liabilities and damages of every kind, known or
        unknown, suspected or unsuspected, disclosed or undisclosed, arising out
        of or in any way connected with any dispute you have with any
        Third-Party Service, any other user, any blockchain network, any
        Digital Asset or its issuer, or any of the risks described in Section 7.
      </P>
      <P>
        If you are a California resident, you waive California Civil Code
        Section 1542, which says: “A general release does not extend to
        claims that the creditor or releasing party does not know or suspect to
        exist in his or her favor at the time of executing the release and
        that, if known by him or her, would have materially affected his or her
        settlement with the debtor or released party.” If you are a
        resident of another jurisdiction, you waive any comparable statute or
        doctrine.
      </P>

      {/* 20 */}
      <H2 id="arbitration">20. Dispute Resolution and Binding Arbitration</H2>
      <Caps>
        Please read this Section carefully. It requires you to arbitrate
        disputes with {C.shortName} on an individual basis and limits the ways
        you can seek relief. It includes a waiver of your right to a jury trial
        and to participate in a class action.
      </Caps>
      <H3>20.1 Informal resolution first</H3>
      <P>
        Before starting an arbitration or any other proceeding, you and we
        agree to try to resolve any Dispute informally. “
        <strong>Dispute</strong>” means any dispute, claim or controversy
        between you and any {C.shortName} Party arising out of or relating to
        these Terms, the Services, any Digital Asset or transaction, or any
        marketing or communication, whether based in contract, tort, statute,
        fraud, misrepresentation or any other legal theory, and whether it
        arose before or after these Terms. To begin, the party raising the
        Dispute must send the other a written notice (“
        <strong>Notice of Dispute</strong>”) that includes the
        claimant’s name, mailing address and email, the wallet addresses
        involved, a description of the Dispute and the facts supporting it, and
        the specific relief requested. You must send your Notice of Dispute to{" "}
        {C.legalName}, {C.noticeAddress}, with a copy to {C.legalEmail}. We will
        send ours to the email address on your account. The parties will then
        confer in good faith, including by at least one telephone or video
        conference if either party requests it, for sixty (60) days from
        receipt of the Notice of Dispute. Any statute of limitations is tolled
        during this period. Completing this step is a condition precedent to
        starting an arbitration or any court proceeding, and a court or
        arbitrator may enjoin the filing of any proceeding brought without it.
      </P>
      <H3>20.2 Agreement to arbitrate</H3>
      <P>
        If a Dispute is not resolved within the sixty-day period, you and we
        agree that it will be resolved exclusively by final and binding
        arbitration administered by the American Arbitration Association
        (“<strong>AAA</strong>”) under its Consumer Arbitration
        Rules then in effect (or, if you are not a consumer, its Commercial
        Arbitration Rules), as modified by this Section. The AAA rules are
        available at www.adr.org. If the AAA is unavailable or unwilling to
        administer the arbitration consistent with this Section, the parties
        will select an alternative administrator, or, failing agreement, a
        court of competent jurisdiction will appoint one. This agreement to
        arbitrate is governed by the Federal Arbitration Act, 9 U.S.C. § 1 et
        seq., and evidences a transaction involving interstate commerce.
      </P>
      <P>
        The arbitration will be conducted by a single neutral arbitrator. The
        arbitrator may award the same individual relief a court could award,
        and must follow these Terms as a court would. Hearings, if any, will be
        conducted by video conference unless the arbitrator determines an
        in-person hearing is necessary, in which case it will be held in the
        county where you reside, or in New Castle County, Delaware if you
        reside outside the United States. Any claim for US$10,000 or less will
        be decided on documents alone unless the arbitrator decides a hearing
        is needed. Payment of filing, administrative and arbitrator fees will
        be governed by the AAA rules, except that if you are a consumer and
        your claim is not frivolous or brought for an improper purpose, we will
        pay the arbitrator’s fees and the administrative fees above the
        amount you would have paid to file in court. The arbitrator will issue
        a reasoned written decision, and judgment on the award may be entered
        in any court of competent jurisdiction. The arbitrator may award
        attorneys’ fees and costs to the prevailing party where the
        governing law allows it, and may sanction a party who brings a claim or
        defense that is frivolous or for an improper purpose.
      </P>
      <H3>20.3 Delegation</H3>
      <P>
        The arbitrator, and not any court or agency, has exclusive authority to
        resolve any dispute relating to the interpretation, applicability,
        enforceability, scope or formation of this Section, including any claim
        that all or any part of it is void or voidable, and any dispute about
        whether a claim is subject to arbitration, except that the class action
        waiver in Section 20.5 and the mass arbitration procedures in Section
        20.6 are for a court to decide.
      </P>
      <H3>20.4 Exceptions</H3>
      <P>
        Either party may bring an individual action in small claims court for a
        Dispute within that court’s jurisdiction, as long as it stays in
        small claims court and is brought on an individual basis. Either party
        may seek a temporary restraining order or preliminary injunction in a
        court of competent jurisdiction to prevent irreparable harm pending
        arbitration. Either party may bring a claim in court for infringement or
        misappropriation of its intellectual property. Nothing in this Section
        prevents you from bringing a complaint to a federal, state or local
        agency, which may seek relief on your behalf if the law allows.
      </P>
      <H3>20.5 Class action and jury trial waiver</H3>
      <Caps>
        You and {C.shortName} each agree that any Dispute will be brought and
        resolved only on an individual basis, and not as a plaintiff or class
        member in any purported class, collective, consolidated, representative
        or private attorney general action or proceeding. The arbitrator may
        not consolidate more than one person’s claims, may not preside
        over any form of class, collective or representative proceeding, and
        may award relief only in favor of the individual party seeking relief
        and only to the extent necessary to resolve that party’s
        individual claim. To the fullest extent permitted by law, you and{" "}
        {C.shortName} each waive the right to a trial by jury and the right to
        participate in a class action. If a court finds this waiver
        unenforceable as to a particular claim or request for relief, that
        claim or request (and only that claim or request) will be severed and
        litigated in court under Section 21, and the rest of the Dispute will
        be arbitrated.
      </Caps>
      <H3>20.6 Mass arbitration</H3>
      <P>
        If twenty-five (25) or more Notices of Dispute or arbitration demands
        raising similar claims are brought against {C.shortName} by or with the
        assistance of the same or coordinated counsel or organizations within a
        period of one hundred eighty (180) days (a “
        <strong>Mass Filing</strong>”), the following applies. The
        parties will select ten (10) demands as bellwether cases, five chosen
        by each side, to proceed to arbitration first, with all other demands
        held in abeyance and their filing fees deferred. After the bellwether
        arbitrations conclude, the parties will engage in a global mediation of
        the remaining demands for a period of ninety (90) days. If any demands
        remain unresolved after mediation, either party may then require that
        the remaining demands proceed in batches of no more than one hundred
        (100), each batch before a single arbitrator, in an order the
        arbitrator designates, or may elect that the remaining demands be
        resolved in court under Section 21 on an individual basis, in which
        case the class waiver in Section 20.5 continues to apply. Applicable
        statutes of limitations are tolled for all demands from the date a
        compliant Notice of Dispute is received until the demand is resolved
        or released from abeyance. A court of competent jurisdiction will
        decide any dispute about whether this Section 20.6 applies or has been
        followed.
      </P>
      <H3>20.7 Thirty-day opt-out</H3>
      <P>
        You may opt out of this agreement to arbitrate by sending a written
        notice to {C.legalName}, {C.noticeAddress}, or by email to{" "}
        {C.legalEmail}, within thirty (30) days after you first accept these
        Terms. The notice must state that you wish to opt out of arbitration
        and must include your name, the email address on your account and your
        embedded wallet addresses. If you opt out, neither party may require
        the other to arbitrate, but the rest of these Terms, including the
        class action waiver to the extent enforceable and Section 21, still
        applies. Opting out does not affect any other arbitration agreement you
        have with us.
      </P>
      <H3>20.8 Changes and survival</H3>
      <P>
        If we change this Section after you accept these Terms, you may reject
        the change by sending us written notice within thirty (30) days of the
        change, in which case the version of this Section you last accepted
        continues to govern. This Section survives termination of these Terms
        and of your relationship with us.
      </P>

      {/* 21 */}
      <H2 id="law">21. Governing Law and Venue</H2>
      <P>
        These Terms and any Dispute are governed by the laws of the State of{" "}
        {C.stateOfIncorporation} and the federal laws of the United States,
        without regard to conflict-of-laws principles, except that Section 20
        is governed by the Federal Arbitration Act. The United Nations
        Convention on Contracts for the International Sale of Goods does not
        apply. To the extent a Dispute is not subject to arbitration, or is
        permitted in court under Section 20, it will be brought exclusively in
        the state or federal courts located in New Castle County,{" "}
        {C.stateOfIncorporation}, and you and we consent to the personal
        jurisdiction of and venue in those courts and waive any objection based
        on inconvenient forum. This does not prevent either party from
        enforcing an arbitral award or seeking injunctive relief in any court
        of competent jurisdiction.
      </P>

      {/* 22 */}
      <H2 id="general">22. General Provisions</H2>
      <P>
        <strong>Entire agreement.</strong> These Terms, together with the
        Privacy Policy and any Supplemental Terms, are the entire agreement
        between you and {C.shortName} about the Services and supersede all prior
        or contemporaneous understandings.
      </P>
      <P>
        <strong>Severability.</strong> If any provision of these Terms is held
        invalid or unenforceable, it will be enforced to the maximum extent
        permissible and the remaining provisions will remain in full force,
        except as stated in Section 20.5.
      </P>
      <P>
        <strong>No waiver.</strong> Our failure to enforce any provision is not
        a waiver of it. Any waiver must be in writing and signed by us.
      </P>
      <P>
        <strong>Assignment.</strong> You may not assign or transfer these Terms
        or any right under them without our prior written consent, and any
        attempt to do so is void. We may assign these Terms freely, including to
        an affiliate or in connection with a merger, acquisition, reorganization
        or sale of assets.
      </P>
      <P>
        <strong>Force majeure.</strong> We are not liable for any delay or
        failure to perform resulting from causes outside our reasonable
        control, including acts of God, war, terrorism, civil unrest, labor
        disputes, pandemics, government action, changes in law, failures of
        power, internet, hosting or telecommunications, failures or attacks on
        blockchain networks or Third-Party Services, and market disruptions.
      </P>
      <P>
        <strong>Electronic communications.</strong> You consent to receive all
        communications, notices, disclosures and agreements from us
        electronically, by email to the address on your account or by posting
        within the Services, and you agree that they satisfy any legal
        requirement that a communication be in writing. Notices to us must be
        sent to {C.legalName}, {C.noticeAddress}, or to {C.legalEmail}.
      </P>
      <P>
        <strong>Export controls.</strong> You may not use, export, re-export or
        transfer the Services or any software in violation of U.S. or other
        export control and sanctions laws.
      </P>
      <P>
        <strong>No third-party beneficiaries.</strong> Except for the{" "}
        {C.shortName} Parties, who may enforce Sections 16 through 20, there
        are no third-party beneficiaries of these Terms.
      </P>
      <P>
        <strong>Relationship.</strong> Nothing in these Terms creates a
        partnership, joint venture, agency, franchise, employment or fiduciary
        relationship between you and {C.shortName}.
      </P>
      <P>
        <strong>Headings and interpretation.</strong> Headings are for
        convenience only. “Including” means “including
        without limitation.” These Terms will not be construed against
        either party as the drafter.
      </P>
      <P>
        <strong>Language.</strong> These Terms are written in English. Any
        translation is for convenience only, and the English version controls.
      </P>

      {/* 23 */}
      <H2 id="contact">23. Contact</H2>
      <P>
        Questions about these Terms may be sent to {C.legalEmail}. Support
        requests may be sent to {C.supportEmail}. Legal notices must be sent as
        described in Section 20 and Section 22.
      </P>
      <P>
        {C.legalName}
        <br />
        {C.noticeAddress}
      </P>

      <p className="mt-16 border-t border-neutral-200 pt-6 text-xs leading-6 text-neutral-500">
        Tokenized stocks are tokenized representations issued by third parties.
        Holders of a tokenized stock are not shareholders of the underlying
        company and have no shareholder rights. {C.shortName} is a software
        interface to third-party, non-custodial protocols and does not custody
        assets, provide investment advice, or guarantee any yield or outcome.
      </p>
    </LegalPage>
  );
}
