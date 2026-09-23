import type { Metadata } from "next";
import Link from "next/link";

import {
  Contents,
  H2,
  H3,
  LegalPage,
  List,
  P,
} from "@/components/legal/prose";
import { COMPANY, PRIVACY_VERSION, TERMS_PATH } from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: "Privacy Policy | Aeras",
  description: `Privacy Policy for the Aeras interface, operated by ${COMPANY.legalName}.`,
};

// The Privacy Policy. Written against what the app actually stores and sends,
// not against a template: the users table (lib/users.ts, migrations 0001 and
// 0005), the per-user position and run tables (0002 through 0004), the edge
// country header lib/glider/eligibility.ts reads, the browser storage the
// venue hooks keep, the two SIWE sessions (Blend in sessionStorage, Ondo in an
// httpOnly cookie), and the third parties in lib/. When one of those changes,
// this document has to change with it.

const C = COMPANY;

const TOC: Array<[string, string]> = [
  ["scope", "1. Scope"],
  ["collect", "2. Information We Collect"],
  ["use", "3. How We Use Information"],
  ["share", "4. How We Share Information"],
  ["blockchain", "5. Public Blockchains"],
  ["storage", "6. Cookies and Browser Storage"],
  ["retention", "7. Retention"],
  ["security", "8. Security"],
  ["rights", "9. Your Rights and Choices"],
  ["regional", "10. Regional Disclosures"],
  ["transfers", "11. International Transfers"],
  ["children", "12. Children"],
  ["changes", "13. Changes to this Policy"],
  ["contact", "14. Contact"],
];

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={PRIVACY_VERSION} brand={C.shortName}>
      <P>
        This Privacy Policy explains what information {C.legalName} (“
        <strong>{C.shortName}</strong>,” “<strong>we</strong>”
        or “<strong>us</strong>”) collects when you use the website
        at {C.domain}, the {C.shortName} web application and related services
        (the “<strong>Services</strong>”), how we use and share it,
        and the choices you have. It is incorporated into our{" "}
        <Link href={TERMS_PATH} className="underline underline-offset-4">
          Terms of Service
        </Link>
        . Capitalised terms not defined here have the meaning given in the
        Terms.
      </P>

      <Contents entries={TOC} />

      {/* 1 */}
      <H2 id="scope">1. Scope</H2>
      <P>
        {C.shortName} is a software interface to public blockchain networks and
        to services operated by third parties. This Policy covers the
        information we collect and control. It does not cover information
        collected by third parties whose services you reach through the
        interface, such as the wallet infrastructure provider that provisions
        your wallets, the protocols and venues you transact with, or the fiat
        funding providers you may choose, each of which has its own privacy
        policy. Section 4 names the ones we work with. Nor does it cover the
        public blockchains themselves, on which every transaction you authorize
        is permanently and publicly recorded (Section 5).
      </P>

      {/* 2 */}
      <H2 id="collect">2. Information We Collect</H2>
      <H3>Information you give us</H3>
      <List
        items={[
          <><strong>Access request.</strong> Your email address and, if you choose to give them, your name, the reason you want access, a wallet address, and a referral code.</>,
          <><strong>Sign-in.</strong> The email address you sign in with, or the email address and name your Google account shares when you sign in with Google, or the public address of an external wallet you sign in with. Sign-in is handled by Privy (Section 4); we receive the verified identity, never your password, one-time codes, or any key material.</>,
          <><strong>Eligibility statements.</strong> Where a feature is restricted by jurisdiction, the confirmation you give that you are eligible, for example that you are not a U.S. person, together with the time you gave it.</>,
          <><strong>Terms acceptance.</strong> The version of the Terms you accepted and when.</>,
          <><strong>Correspondence.</strong> Anything you send us by email or other channels, and our replies.</>,
        ]}
      />
      <H3>Information created when you use the Services</H3>
      <List
        items={[
          <><strong>Account identifiers.</strong> A Privy user identifier, the public addresses of the embedded Solana and Ethereum-compatible wallets provisioned for you, and the public addresses of any external wallet you link. We never hold private keys, seed phrases or recovery material for any of them.</>,
          <><strong>Position and activity records.</strong> To let multi-step actions resume after an interruption and to show you what you hold, we record the steps of strategies you run, leveraged positions you open, liquidity positions you mint, the on-chain accounts created when you open a first position and how their cost was funded, card purchases made through the spend feature, and the transaction signatures involved. These are keyed to your wallet addresses.</>,
          <><strong>Request data.</strong> When your browser reaches our servers we receive your IP address, the country our hosting provider derives from it, your browser and device type, the pages and endpoints requested, timestamps, and error reports. The derived country is used to apply jurisdictional restrictions on some features.</>,
          <><strong>Session tokens.</strong> A session token for your sign-in, held by Privy’s client library, and, for venues that require a wallet-signed session (Sign-In with Ethereum), a session token scoped to your wallet address.</>,
        ]}
      />
      <H3>Information from public sources</H3>
      <P>
        We read public blockchain data associated with your wallet addresses,
        including balances, token holdings, positions, transaction history and
        the state of protocol accounts, through our own and third-party node
        and indexing providers. This is public information that anyone can read
        from the same addresses.
      </P>
      <H3>What we do not collect</H3>
      <P>
        We do not collect government identification numbers, identity
        documents, dates of birth, physical addresses, bank account or card
        numbers, or biometric data. If you use a fiat funding option, that
        provider collects whatever identity and payment information its own
        checks require, under its own policy, and does not share it with us. As
        of the date above we run no advertising trackers and no third-party
        analytics on the Services.
      </P>

      {/* 3 */}
      <H2 id="use">3. How We Use Information</H2>
      <P>We use the information described above to:</P>
      <List
        items={[
          <>operate the Services: authenticate you, provision and identify your wallets, read and display your balances and positions, construct the transactions you ask for, and resume interrupted actions;</>,
          <>manage the access list, including reviewing requests, sending invitations, and crediting referrals;</>,
          <>apply eligibility, jurisdictional, sanctions and fraud controls, and record the statements you make for them;</>,
          <>keep a record of your acceptance of the Terms;</>,
          <>respond to your requests and communicate with you about the Services, including service notices and, if you have not opted out, product updates;</>,
          <>monitor, debug, secure and improve the Services, including by reviewing request logs and error reports;</>,
          <>comply with law, respond to lawful requests, enforce the Terms, and protect the rights, safety and property of {C.shortName}, our users and others;</>,
          <>where you have consented or where the law otherwise permits, for any other purpose we describe to you at the time of collection.</>,
        ]}
      />
      <P>
        Where the law of your jurisdiction requires a legal basis, we rely on
        the performance of our contract with you (the Terms), our legitimate
        interests in operating, securing and improving the Services, compliance
        with our legal obligations, and your consent where we ask for it.
      </P>

      {/* 4 */}
      <H2 id="share">4. How We Share Information</H2>
      <P>We do not sell your personal information. We share it only as follows.</P>
      <H3>Service providers that process it for us</H3>
      <List
        items={[
          <><strong>Privy, Inc.</strong> handles sign-in and provisions and secures your embedded wallets. It receives your email or social identity and the identifiers of your wallets, and holds sign-in session state in your browser. Key material for your wallets is managed by Privy’s systems and your own device; we never receive it.</>,
          <><strong>Supabase</strong> hosts our database, which holds the account, acceptance and position records described in Section 2.</>,
          <><strong>Vercel</strong> hosts the Services and processes request data, including your IP address and derived country, in the course of serving pages and API routes.</>,
          <><strong>Alchemy and Helius</strong> are the node providers through which we read blockchain state and broadcast transactions. Every read and broadcast carries the wallet address it concerns.</>,
        ]}
      />
      <H3>Third parties you transact with through the interface</H3>
      <P>
        When you use a feature, the interface sends your wallet address, the
        transaction details and, where the third party requires a session, a
        signature from your wallet, to that third party. These parties act on
        their own behalf under their own privacy policies. As of the date above
        they include: Jupiter (swaps, lending, prices); Kamino (lending and
        borrowing); Morpho and Aave (lending, borrowing and vaults on Ethereum
        and Monad); Blend (Aeras Vault I, which creates an account for your
        wallet address when the position is first read); Glider (Bitwise
        Mag7X, which holds an account keyed to your wallet and your eligibility
        statement); FastLane (shMON staking); Uniswap (liquidity pools, whose
        API receives your wallet address and pool selection); Lighter and Ondo
        Global Markets (perpetual futures, with Ondo requiring a wallet-signed
        session and a payout address registered under it); Trustware and the
        bridges and solvers it routes through (cross-chain transfers, which
        receive both source and destination addresses); Rain (card issuance);
        and the fiat funding providers offered through Privy, such as MoonPay
        and Coinbase, which you deal with directly.
      </P>
      <H3>Data sources whose content the interface loads</H3>
      <P>
        Prices, charts, company data, headlines and market information are
        fetched from CoinGecko, Nasdaq, ForexFactory, the Federal Reserve and
        public RSS feeds, mostly through our servers, so those providers see our
        requests rather than yours. Two exceptions load in your browser and can
        set their own cookies under their own policies: the TradingView chart
        embed, if you switch a chart to candles, and the Lighter and Ondo market
        data connections, which connect from your browser to those venues.
      </P>
      <H3>Legal, safety and corporate</H3>
      <P>
        We may share information with regulators, law enforcement, courts and
        other parties where we believe in good faith that doing so is required
        by law or legal process, or is necessary to enforce the Terms, apply
        sanctions or eligibility controls, investigate fraud or security
        incidents, or protect the rights, property or safety of {C.shortName},
        our users or the public. If {C.shortName} is involved in a merger,
        financing, acquisition, reorganization or sale of assets, information
        may be transferred as part of that transaction, subject to this Policy.
      </P>

      {/* 5 */}
      <H2 id="blockchain">5. Public Blockchains</H2>
      <P>
        Every transaction you authorize through the interface is broadcast to a
        public blockchain and recorded there permanently. Your wallet addresses,
        their balances, every transaction they have ever made, and every
        protocol position they hold are visible to anyone, forever, and can be
        linked to you by anyone who learns which addresses are yours. We do not
        control any blockchain and cannot alter, delete, hide or anonymize
        anything recorded on one. A request to delete your information
        (Section 9) cannot reach on-chain data.
      </P>

      {/* 6 */}
      <H2 id="storage">6. Cookies and Browser Storage</H2>
      <P>
        We use a small number of cookies and browser storage entries, all of
        which are needed for the Services to work. None are used for
        advertising.
      </P>
      <List
        items={[
          <><strong>Sign-in state</strong> is kept by Privy’s client library in your browser so you stay signed in.</>,
          <><strong>Venue sessions.</strong> A wallet-signed session for Ondo is kept in an HTTP-only cookie set by our server so your browser cannot read it; a wallet-signed session for Blend is kept in session storage and is discarded when the tab closes.</>,
          <><strong>Preferences and caches.</strong> Local storage holds the interface mode you chose, which venues you have signed in to, in-progress action markers keyed to your wallet address, and cached copies of positions and prices so the interface can draw before the chain answers. These stay in your browser and are not sent to us.</>,
          <><strong>Third-party embeds.</strong> The TradingView chart embed, if you open it, may set cookies from TradingView’s own domains under TradingView’s policy.</>,
        ]}
      />
      <P>
        You can clear any of these through your browser settings. Clearing them
        signs you out and removes cached data; it does not remove anything from
        our servers or from any blockchain. We do not respond to browser
        “Do Not Track” signals, because we do no tracking that they
        would apply to.
      </P>

      {/* 7 */}
      <H2 id="retention">7. Retention</H2>
      <P>
        We keep account records for as long as you have an account and for as
        long afterwards as we need them to comply with legal obligations
        (including sanctions and anti-money-laundering record-keeping), resolve
        disputes, enforce the Terms and defend claims. Records of your
        acceptance of the Terms and of eligibility statements you made are kept
        for the duration of any applicable limitation period. Position and
        activity records are kept while the position is open and afterwards
        for the same reasons. Request logs are kept for a short period for
        security and debugging and then discarded or aggregated. Information on
        a blockchain is kept by the blockchain and is outside our control.
      </P>

      {/* 8 */}
      <H2 id="security">8. Security</H2>
      <P>
        We use technical and organisational measures appropriate to the
        information we hold, including encrypted connections, server-side
        storage of every third-party credential, restricted access to our
        database, and a design in which we never hold the keys to your
        wallets. No system is perfectly secure, and we cannot guarantee that
        information will not be accessed, disclosed, altered or destroyed by a
        breach of our safeguards or those of a provider. You are responsible
        for the security of the email account, social login, device and any
        external wallet through which your account can be reached.
      </P>

      {/* 9 */}
      <H2 id="rights">9. Your Rights and Choices</H2>
      <P>
        Depending on where you live, you may have the right to access the
        personal information we hold about you, to correct it, to delete it, to
        receive a copy in a portable form, to restrict or object to certain
        processing, and to withdraw consent where processing is based on it.
        You can exercise these rights by emailing {C.legalEmail} from the
        address on your account. We will verify the request and respond within
        the time the applicable law allows. We will not discriminate against
        you for exercising them.
      </P>
      <P>
        Some limits apply. We cannot delete or alter anything on a blockchain.
        We may retain information we are required to keep by law or need to
        establish, exercise or defend legal claims, including your acceptance
        of the Terms and any eligibility statement. Deleting your account
        removes our records; it does not affect the wallets Privy provisioned
        for you, which remain yours and reachable through Privy’s own
        tools, or anything you hold in them.
      </P>
      <P>
        You may opt out of product update emails by replying to one or by
        writing to {C.supportEmail}. We will still send notices needed to
        operate the Services or required by law.
      </P>

      {/* 10 */}
      <H2 id="regional">10. Regional Disclosures</H2>
      <H3>European Economic Area, United Kingdom and Switzerland</H3>
      <P>
        {C.legalName} is the controller of the personal information described
        in this Policy. The legal bases we rely on are set out in Section 3.
        You have the rights described in Section 9, and the right to lodge a
        complaint with your local supervisory authority. Transfers of your
        information to the United States are described in Section 11.
      </P>
      <H3>California</H3>
      <P>
        In the twelve months before the date above we collected the categories
        of personal information described in Section 2 (identifiers, internet
        and network activity, and commercial and financial activity in the form
        of on-chain positions), for the purposes in Section 3, and disclosed
        them to the categories of recipients in Section 4. We do not sell
        personal information and do not share it for cross-context behavioural
        advertising, and we have not done so in the preceding twelve months. We
        do not use or disclose sensitive personal information for purposes
        beyond those permitted by the California Consumer Privacy Act. You may
        exercise the rights in Section 9, including through an authorised agent.
      </P>

      {/* 11 */}
      <H2 id="transfers">11. International Transfers</H2>
      <P>
        We are located in the United States and our providers process
        information there and in other countries whose data-protection laws may
        differ from those of your jurisdiction. Where the law requires a
        transfer mechanism, we rely on the standard contractual clauses or
        another mechanism recognised by the relevant authority. By using the
        Services you understand that your information will be processed in the
        United States.
      </P>

      {/* 12 */}
      <H2 id="children">12. Children</H2>
      <P>
        The Services are not directed to, and may not be used by, anyone under
        18. We do not knowingly collect information from anyone under 18. If you
        believe we have, write to {C.legalEmail} and we will delete it.
      </P>

      {/* 13 */}
      <H2 id="changes">13. Changes to this Policy</H2>
      <P>
        We may update this Policy from time to time. We will post the updated
        version at this address with a new date, and where a change is
        material we will indicate it within the Services. Your continued use
        of the Services after the change takes effect is acceptance of the
        updated Policy.
      </P>

      {/* 14 */}
      <H2 id="contact">14. Contact</H2>
      <P>
        Questions and requests about this Policy may be sent to {C.legalEmail}{" "}
        or by mail to:
      </P>
      <P>
        {C.legalName}
        <br />
        {C.noticeAddress}
      </P>
    </LegalPage>
  );
}
