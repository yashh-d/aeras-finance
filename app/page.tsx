"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { WaitlistDialog } from "@/components/WaitlistDialog";
import "./landing.css";

type Logo = { src: string; alt: string };

// The four protocols that power Aeras. Featured in a dedicated section
// AND included in the broader marquee below.
const PROTOCOLS: readonly Logo[] = [
  { src: "/logos/ondo.png", alt: "Ondo" },
  { src: "/logos/xstocks.svg", alt: "xStocks" },
  { src: "/logos/jupiter.svg", alt: "Jupiter" },
  { src: "/logos/morpho.png", alt: "Morpho" },
];

// Stocks shown in the marquee. xStocks supports more than this, but these
// are the eight we currently have brand art for.
const STOCKS: readonly Logo[] = [
  { src: "/logos/apple.svg", alt: "Apple" },
  { src: "/logos/nvidia.svg", alt: "NVIDIA" },
  { src: "/logos/tesla.svg", alt: "Tesla" },
  { src: "/logos/google.svg", alt: "Google" },
  { src: "/logos/meta.svg", alt: "Meta" },
  { src: "/logos/microsoft.svg", alt: "Microsoft" },
  { src: "/logos/amazon.svg", alt: "Amazon" },
  { src: "/logos/amd.svg", alt: "AMD" },
];

// Marquee shows the stocks only. Protocols have their own showcase in the
// PoweredBy section above.
const MARQUEE: readonly Logo[] = STOCKS;

type FlowStep = readonly [step: string, title: string, desc: string];

const EARN_STEPS: readonly FlowStep[] = [
  [
    "01",
    "Deposit assets",
    "Bring tokenized stocks, ETFs, and treasuries into your Aeras account.",
  ],
  [
    "02",
    "Route to yield",
    "Supply them to integrated lending markets that pay a variable APY.",
  ],
  [
    "03",
    "Track your rate",
    "Watch live APY, utilization, and accrued interest on every position.",
  ],
  [
    "04",
    "Withdraw any time",
    "Pull your assets and earnings back to your wallet whenever you want.",
  ],
];

const BORROW_STEPS: readonly FlowStep[] = [
  [
    "01",
    "Deposit collateral",
    "Pledge tokenized stocks and ETFs as collateral without selling them.",
  ],
  [
    "02",
    "Draw USDC",
    "Borrow stablecoins up to your collateral factor at a variable rate.",
  ],
  [
    "03",
    "Monitor your health",
    "See projected LTV, liquidation price, and interest before you borrow.",
  ],
  [
    "04",
    "Repay or add collateral",
    "Repay any time, top up collateral, or withdraw when your position allows.",
  ],
];

const HEDGE_STEPS: readonly FlowStep[] = [
  [
    "01",
    "Hold your position",
    "Keep the tokenized assets and the long exposure you want to keep.",
  ],
  [
    "02",
    "Borrow against them",
    "Draw stablecoins to fund an offsetting trade without selling your assets.",
  ],
  [
    "03",
    "Offset downside",
    "Use the borrowed capital to hedge or rebalance as markets move.",
  ],
  [
    "04",
    "Unwind when ready",
    "Close the hedge, repay the loan, and return to a clean long position.",
  ],
];

const FLOWS: Record<"earn" | "borrow" | "hedge", readonly FlowStep[]> = {
  earn: EARN_STEPS,
  borrow: BORROW_STEPS,
  hedge: HEDGE_STEPS,
};

// `logo` wins if present; otherwise the colored `{bg, glyph}` chip renders.
// NVIDIA's logo is a wide wordmark that doesn't fit a square icon slot
// cleanly, so it stays as a letter chip.
type Holding = {
  name: string;
  ticker: string;
  amount: string;
  change: string;
  ltv: number;
  logo?: string;
  bg?: string;
  glyph?: string;
};

const HOLDINGS: readonly Holding[] = [
  {
    logo: "/logos/apple.svg",
    name: "Apple",
    ticker: "AAPLx · xStocks",
    amount: "$18,420",
    change: "+1.8%",
    ltv: 60,
  },
  {
    logo: "/logos/nvidia-eye.svg",
    name: "NVIDIA",
    ticker: "NVDAx · xStocks",
    amount: "$12,960",
    change: "+3.2%",
    ltv: 55,
  },
  {
    logo: "/logos/ondo.png",
    name: "Ondo Treasuries",
    ticker: "USDY · Ondo",
    amount: "$11,420",
    change: "+0.4%",
    ltv: 85,
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { ready, authenticated, login, user } = usePrivy();

  // After a user clicks Launch App while signed out, we open the Privy modal
  // and remember they wanted to go through. When `authenticated` flips true we
  // send them to /app, where the access gate syncs their identity and decides
  // whether they enter the app or see the waitlist.
  const [pendingLaunch, setPendingLaunch] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const userEmail = user?.email?.address;
  const walletAddress = user?.linkedAccounts.find(
    (account): account is WalletWithMetadata =>
      account.type === "wallet" &&
      account.walletClientType === "privy" &&
      account.chainType === "solana",
  )?.address;

  useEffect(() => {
    if (ready && authenticated && pendingLaunch) {
      router.push("/app");
    }
  }, [ready, authenticated, pendingLaunch, router]);

  // If something linked here with /?waitlist=1, open the dialog directly. Read
  // the query off the URL to avoid needing a Suspense boundary.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("waitlist") === "1") {
      setWaitlistOpen(true);
    }
  }, [ready]);

  const handleLaunch = useCallback(() => {
    if (!ready) return;
    if (authenticated) {
      router.push("/app");
      return;
    }
    setPendingLaunch(true);
    login();
  }, [ready, authenticated, login, router]);

  const handleWaitlist = useCallback(() => setWaitlistOpen(true), []);

  const launchLabel = authenticated ? "Open app" : "Launch App";

  return (
    <div className="aeras-landing">
      <Nav
        onLaunch={handleLaunch}
        launchLabel={launchLabel}
        onWaitlist={handleWaitlist}
      />
      <Hero
        onLaunch={handleLaunch}
        launchLabel={launchLabel}
        onWaitlist={handleWaitlist}
      />
      <Marquee />
      <HowItWorks />
      <Metrics />
      <Pillars />
      <PoweredBy />
      <YieldSection />
      <BorrowCalc />
      <FinalCta
        onLaunch={handleLaunch}
        launchLabel={launchLabel}
        onWaitlist={handleWaitlist}
      />
      <Footer />
      {waitlistOpen && (
        <WaitlistDialog
          onClose={() => setWaitlistOpen(false)}
          lockedEmail={userEmail}
          walletAddress={walletAddress}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Nav                                                                */
/* ------------------------------------------------------------------ */

function Nav({
  onLaunch,
  launchLabel,
  onWaitlist,
}: {
  onLaunch: () => void;
  launchLabel: string;
  onWaitlist: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`lnav${scrolled ? " scrolled" : ""}`}>
      <div className="wrap nav-in">
        <a href="#" className="logo" aria-label="Aeras">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/aeras-logo-black.png"
            alt="Aeras"
            className="logo-img"
          />
        </a>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#earn">Earn</a>
          <a href="#borrow">Borrow</a>
          <a href="#assets">Assets</a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="lbtn lbtn-ghost"
            onClick={onLaunch}
          >
            {launchLabel}
          </button>
          <button
            type="button"
            className="lbtn lbtn-primary"
            onClick={onWaitlist}
          >
            Join the waitlist
          </button>
        </div>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Reveal-on-scroll helper                                            */
/* ------------------------------------------------------------------ */

function useReveal<T extends HTMLElement>(threshold = 0.16) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return ref;
}

/* ------------------------------------------------------------------ */
/*  Hero                                                               */
/* ------------------------------------------------------------------ */

function Hero({
  onLaunch,
  launchLabel,
  onWaitlist,
}: {
  onLaunch: () => void;
  launchLabel: string;
  onWaitlist: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [userClicked, setUserClicked] = useState(false);

  // Trigger the card reveal + LTV bar animation when it scrolls into view.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add("in");
            setTimeout(() => setRevealed(true), 300);
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const handleAssetClick = (i: number) => {
    setSelectedIdx(i);
    setUserClicked(true);
  };

  // Math: total holdings = $18,420 + $12,960 + $11,420 = $42,800.
  // Available to borrow = $25,680, so blended max LTV = 25,680 / 42,800 = 60%.
  // Default reveal shows the blended LTV; clicking an asset shows that
  // asset's individual max LTV.
  const BLENDED_LTV = 60;
  const fillPct = userClicked
    ? HOLDINGS[selectedIdx].ltv
    : revealed
      ? BLENDED_LTV
      : 0;
  const ltvLabel = userClicked
    ? `${HOLDINGS[selectedIdx].ltv}% max LTV`
    : revealed
      ? `${BLENDED_LTV}% LTV`
      : "0% LTV";
  const ltvFillWidth = `${fillPct}%`;

  const h1Ref = useReveal<HTMLHeadingElement>();
  const subRef = useReveal<HTMLParagraphElement>();
  const ctaRef = useReveal<HTMLDivElement>();

  return (
    <header className="hero">
      <div className="hero-grid" />
      <div className="wrap hero-in">
        <h1 ref={h1Ref} className="reveal d1">
          Hold the assets you love. <em>Earn yield.</em> Borrow cash against
          them.
        </h1>
        <p ref={subRef} className="hero-sub reveal d2">
          Aeras turns the world&apos;s most popular stocks, treasuries and
          tokenized funds into productive collateral. Keep your upside, unlock
          liquidity, never sell.
        </p>
        <div ref={ctaRef} className="hero-cta reveal d3">
          <button
            type="button"
            className="lbtn lbtn-primary lbtn-lg"
            onClick={onWaitlist}
          >
            Join the waitlist
          </button>
          <button
            type="button"
            className="lbtn lbtn-ghost lbtn-lg"
            onClick={onLaunch}
          >
            {launchLabel}
          </button>
        </div>
      </div>

      <div className="wrap hero-image-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/background.webp"
          alt="Manhattan skyline at golden hour"
          className="hero-image"
        />
      </div>

      <div className="wrap">
        <div ref={cardRef} className="hero-card reveal">
          <div className="hc-top">
            <span className="d" />
            <span className="d" />
            <span className="d" />
            <span className="label">portfolio · live</span>
          </div>
          <div className="hc-body">
            <div className="hc-left">
              <div className="hc-label">Your tokenized holdings</div>
              {HOLDINGS.map((h, i) => (
                <button
                  key={h.name}
                  type="button"
                  className={`asset-row${i === selectedIdx ? " active" : ""}`}
                  onClick={() => handleAssetClick(i)}
                >
                  {h.logo ? (
                    <div className="asset-ic asset-ic-logo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={h.logo} alt="" />
                    </div>
                  ) : (
                    <div className="asset-ic" style={{ background: h.bg }}>
                      {h.glyph}
                    </div>
                  )}
                  <div className="asset-meta">
                    <div className="asset-name">{h.name}</div>
                    <div className="asset-tic">{h.ticker}</div>
                  </div>
                  <div className="asset-val">
                    <div className="asset-amt">{h.amount}</div>
                    <div className="asset-chg">{h.change}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="hc-right">
              <div className="borrow-stat">
                <div className="k">Available to borrow</div>
                <div className="v">
                  $25,680 <small>USDC</small>
                </div>
              </div>
              <div className="hc-label" style={{ marginBottom: 6 }}>
                Loan-to-value
              </div>
              <div className="ltv-bar">
                <div className="ltv-fill" style={{ width: ltvFillWidth }} />
              </div>
              <div className="ltv-legend">
                <span>Borrowed</span>
                <span>{ltvLabel}</span>
              </div>
              <div className="hc-cta">
                <button type="button" className="lbtn lbtn-ghost">
                  Earn 2.4%
                </button>
                <button
                  type="button"
                  className="lbtn lbtn-primary"
                  onClick={onLaunch}
                >
                  Borrow cash
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Marquee                                                            */
/* ------------------------------------------------------------------ */

function Marquee() {
  const capRef = useReveal<HTMLDivElement>();
  // Duplicate so the CSS marquee loop is seamless.
  const doubled = useMemo(() => [...MARQUEE, ...MARQUEE], []);
  return (
    <section className="marquee-sec" id="assets">
      <div ref={capRef} className="marquee-cap reveal">
        Built for the world&apos;s most recognized assets
      </div>
      <div className="marquee">
        <div className="marquee-track">
          {doubled.map((b, i) => (
            <span key={`${b.alt}-${i}`} className="brand brand-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.src} alt={b.alt} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function PoweredBy() {
  const capRef = useReveal<HTMLDivElement>();
  const rowRef = useReveal<HTMLDivElement>();
  return (
    <section className="powered-by">
      <div className="wrap">
        <div ref={capRef} className="powered-by-cap reveal">
          Powered by
        </div>
        <div ref={rowRef} className="powered-by-row reveal d1">
          {PROTOCOLS.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.alt} src={p.src} alt={p.alt} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  How it works                                                       */
/* ------------------------------------------------------------------ */

function HowItWorks() {
  const [flow, setFlow] = useState<"earn" | "borrow" | "hedge">("earn");

  const eyebrowRef = useReveal<HTMLSpanElement>();
  const titleRef = useReveal<HTMLHeadingElement>();
  const leadRef = useReveal<HTMLParagraphElement>();
  const tabsRef = useReveal<HTMLDivElement>();
  // Outer wrapper carries the .reveal — IntersectionObserver attaches once
  // and stays attached, so the wrapper never loses its .in class. The
  // inner stage gets key={flow} so it remounts on tab change to restart
  // the per-node CSS animations.
  const stageRevealRef = useReveal<HTMLDivElement>();

  return (
    <section className="sec-pad" id="how">
      <div className="wrap" style={{ textAlign: "center", marginBottom: 10 }}>
        <span ref={eyebrowRef} className="eyebrow reveal">
          The mechanics
        </span>
        <h2 ref={titleRef} className="reveal d1" style={{ margin: "0 auto" }}>
          From tokenized assets to usable liquidity
        </h2>
        <p
          ref={leadRef}
          className="sec-lead reveal d2"
          style={{ margin: "20px auto 0" }}
        >
          Buy or deposit tokenized stocks and ETFs, borrow stablecoins against
          them, and choose how to use your capital.
        </p>
      </div>
      <div className="wrap" style={{ marginTop: 46 }}>
        <div ref={tabsRef} className="flow-tabs reveal d1">
          <button
            type="button"
            className={`flow-tab${flow === "earn" ? " active" : ""}`}
            onClick={() => setFlow("earn")}
          >
            Earn flow
          </button>
          <button
            type="button"
            className={`flow-tab${flow === "borrow" ? " active" : ""}`}
            onClick={() => setFlow("borrow")}
          >
            Borrow flow
          </button>
          <button
            type="button"
            className={`flow-tab${flow === "hedge" ? " active" : ""}`}
            onClick={() => setFlow("hedge")}
          >
            Hedge flow
          </button>
        </div>
        <div ref={stageRevealRef} className="reveal d2">
          <div
            key={flow}
            className="flow-stage flow-stage--animate"
          >
            {FLOWS[flow].map((n, i) => (
              <div key={i} className="flow-node">
                <div className="fn-step">STEP {n[0]}</div>
                <div className="fn-title">{n[1]}</div>
                <div className="fn-desc">{n[2]}</div>
                {i < FLOWS[flow].length - 1 && (
                  <span className="flow-arrow">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Metrics                                                            */
/* ------------------------------------------------------------------ */

type Metric = {
  target: number;
  pre?: string;
  suf?: string;
  dec?: number;
  label: string;
};

const METRICS: Metric[] = [
  {
    target: 30,
    pre: "$",
    suf: "B+",
    label: "Tokenized real-world assets",
  },
  { target: 200, suf: "+", label: "Tokenized U.S. stocks and ETFs supported" },
  {
    target: 1.3,
    pre: "$",
    suf: "T",
    dec: 1,
    label: "U.S. margin debt in traditional markets",
  },
  {
    target: 929,
    pre: "$",
    suf: "M+",
    label: "Onchain RWA lending",
  },
];

function CountUpCell({ m }: { m: Metric }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState("0");
  const cellRef = useReveal<HTMLDivElement>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries, ob) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          ob.unobserve(el);
          let start: number | null = null;
          const dur = 1400;
          const step = (t: number) => {
            if (start == null) start = t;
            const p = Math.min((t - start) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3);
            setValue((m.target * ease).toFixed(m.dec ?? 0));
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [m]);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        cellRef.current = el;
      }}
      className="m-cell reveal"
    >
      <div className="m-num">
        {m.pre ?? ""}
        {value}
        <span className="u">{m.suf ?? ""}</span>
      </div>
      <div className="m-lab">{m.label}</div>
    </div>
  );
}

function Metrics() {
  const eyebrowRef = useReveal<HTMLSpanElement>();
  const titleRef = useReveal<HTMLHeadingElement>();
  return (
    <section className="metrics sec-pad">
      <div className="wrap" style={{ textAlign: "center" }}>
        <span ref={eyebrowRef} className="eyebrow reveal">
          Proof, not promises
        </span>
        <h2 ref={titleRef} className="reveal d1" style={{ margin: "0 auto" }}>
          Numbers that show the market is ready
        </h2>
        <div className="m-grid">
          {METRICS.map((m, i) => (
            <CountUpCell key={i} m={m} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Pillars                                                            */
/* ------------------------------------------------------------------ */

function Pillars() {
  const eyebrowRef = useReveal<HTMLSpanElement>();
  const titleRef = useReveal<HTMLHeadingElement>();
  const p1 = useReveal<HTMLDivElement>();
  const p2 = useReveal<HTMLDivElement>();
  const p3 = useReveal<HTMLDivElement>();
  return (
    <section className="sec-pad" id="why">
      <div className="wrap" style={{ textAlign: "center" }}>
        <span ref={eyebrowRef} className="eyebrow reveal">
          Why Aeras
        </span>
        <h2 ref={titleRef} className="reveal d1" style={{ margin: "0 auto" }}>
          Built for assets you want to hold, not sell
        </h2>
      </div>
      <div className="wrap">
        <div className="pillars">
          <div ref={p1} className="pillar reveal d1">
            <div className="p-tag">Control</div>
            <div className="p-ic">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#2973ff"
                strokeWidth="1.8"
              >
                <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <h3>Non-custodial by design</h3>
            <p>
              Aeras routes through onchain protocols so users can access
              lending and yield opportunities without relying on a traditional
              brokerage account.
            </p>
          </div>
          <div ref={p2} className="pillar reveal d2">
            <div className="p-tag">Liquidity</div>
            <div className="p-ic">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#2973ff"
                strokeWidth="1.8"
              >
                <path d="M12 21s-7-4.5-9.5-9A5 5 0 0112 6a5 5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z" />
              </svg>
            </div>
            <h3>Borrow without selling</h3>
            <p>
              Use tokenized assets as collateral to access stablecoin
              liquidity while staying exposed to the assets you believe in.
            </p>
          </div>
          <div ref={p3} className="pillar reveal d3">
            <div className="p-tag">Transparency</div>
            <div className="p-ic">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#2973ff"
                strokeWidth="1.8"
              >
                <path d="M3 3v18h18" />
                <path d="M7 14l4-5 3 3 5-7" />
              </svg>
            </div>
            <h3>Rates shown clearly</h3>
            <p>
              Borrow limits, rates, utilization, and liquidation risk are
              shown before you act, so you can understand the tradeoff before
              opening a position.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Yield section + SVG chart                                          */
/* ------------------------------------------------------------------ */

function YieldChart() {
  // Deterministic so the chart looks the same every render (purity rule)
  // and so server- and client-rendered output match on hydration.
  const { areaPath, linePath, lastX, lastY } = useMemo(() => {
    const W = 460;
    const H = 200;
    // mulberry32 seeded PRNG
    let seed = 0x9e3779b1;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pts: number[] = [];
    let v = 40;
    for (let i = 0; i <= 48; i++) {
      v += rand() * 1.2 - 0.25;
      pts.push(v);
    }
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (val: number) => H - 10 - ((val - min) / (max - min)) * (H - 30);
    let d = `M${x(0)},${y(pts[0])}`;
    pts.forEach((p, i) => {
      if (i > 0) d += ` L${x(i)},${y(p)}`;
    });
    return {
      areaPath: `${d} L${W},${H} L0,${H} Z`,
      linePath: d,
      lastX: x(pts.length - 1),
      lastY: y(pts[pts.length - 1]),
    };
  }, []);

  return (
    <svg className="line" viewBox="0 0 460 200" preserveAspectRatio="none">
      <defs>
        <linearGradient id="aeras-yield-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2973ff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#2973ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#aeras-yield-g)" />
      <path
        d={linePath}
        fill="none"
        stroke="#2973ff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="2000"
        strokeDashoffset="2000"
      >
        <animate
          attributeName="stroke-dashoffset"
          to="0"
          dur="1.8s"
          begin="0.2s"
          fill="freeze"
          calcMode="spline"
          keySplines="0.16 1 0.3 1"
          keyTimes="0;1"
          values="2000;0"
        />
      </path>
      <circle cx={lastX} cy={lastY} r="4.5" fill="#2973ff">
        <animate
          attributeName="r"
          values="4.5;7;4.5"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

function YieldSection() {
  const eyebrowRef = useReveal<HTMLSpanElement>();
  const titleRef = useReveal<HTMLHeadingElement>();
  const listRef = useReveal<HTMLUListElement>();
  const cardRef = useReveal<HTMLDivElement>();
  return (
    <section className="chart-sec sec-pad" id="earn">
      <div className="wrap chart-grid">
        <div>
          <span ref={eyebrowRef} className="eyebrow reveal">
            Earn
          </span>
          <h2 ref={titleRef} className="reveal d1">
            Put idle assets to work
          </h2>
          <ul ref={listRef} className="chart-pts reveal d2" style={{ marginTop: 30 }}>
            <li>
              <div className="ci">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v20M2 12h20" />
                </svg>
              </div>
              <div>
                <strong>Auto-routed opportunities</strong>
                <span>
                  Aeras surfaces lending and yield routes across integrated
                  markets.
                </span>
              </div>
            </li>
            <li>
              <div className="ci">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <strong>Stay flexible</strong>
                <span>
                  Withdraw, borrow, repay, or rebalance as market conditions
                  change.
                </span>
              </div>
            </li>
            <li>
              <div className="ci">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <div>
                <strong>Clear risk view</strong>
                <span>
                  See APYs, collateral requirements, utilization, and
                  liquidation risk before entering a position.
                </span>
              </div>
            </li>
          </ul>
        </div>
        <div ref={cardRef} className="chart-card reveal d2">
          <div className="chart-head">
            <div>
              <div className="t">Blended portfolio yield</div>
              <div className="chart-sub">
                USDY + AAPLx + NVDAx · trailing 12mo
              </div>
            </div>
            <span className="badge">+2.4% APY</span>
          </div>
          <div className="chart-big">$51,200</div>
          <div className="chart-sub">
            Projected value · started at $50,000
          </div>
          <YieldChart />
          <div className="chart-x">
            <span>Jun</span>
            <span>Sep</span>
            <span>Dec</span>
            <span>Mar</span>
            <span>May</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Borrow calculator                                                  */
/* ------------------------------------------------------------------ */

function BorrowCalc() {
  const [collateral, setCollateral] = useState(50000);
  const [ltv, setLtv] = useState(50);

  const borrow = Math.round((collateral * ltv) / 100);
  const monthly = Math.round((borrow * 0.059) / 12);
  const buffer = Math.max(0, 78 - ltv);
  const fmt = (n: number) => n.toLocaleString("en-US");

  const eyebrowRef = useReveal<HTMLSpanElement>();
  const titleRef = useReveal<HTMLHeadingElement>();
  const leadRef = useReveal<HTMLParagraphElement>();
  const calcRef = useReveal<HTMLDivElement>();

  return (
    <section className="sec-pad" id="borrow">
      <div className="wrap" style={{ textAlign: "center" }}>
        <span ref={eyebrowRef} className="eyebrow reveal">
          Borrow
        </span>
        <h2 ref={titleRef} className="reveal d1" style={{ margin: "0 auto" }}>
          Stablecoins against your portfolio
        </h2>
        <p
          ref={leadRef}
          className="sec-lead reveal d2"
          style={{ margin: "20px auto 0" }}
        >
          Borrow stablecoins against tokenized stocks and ETFs without
          selling. Use the capital to invest, hedge, withdraw, or prepare for
          future card-based spending. No credit checks. No forced selling.
          Fully transparent collateral terms.
        </p>
      </div>
      <div className="wrap">
        <div ref={calcRef} className="calc reveal d1">
          <div className="calc-in">
            <div>
              <h3>Try the borrow engine</h3>
              <p>
                Slide to model a loan against your tokenized collateral. Rates
                and limits update live, the same way they do in-app.
              </p>
              <div className="slider-wrap">
                <label>
                  Collateral value <b>${fmt(collateral)}</b>
                </label>
                <input
                  type="range"
                  min={5000}
                  max={250000}
                  step={1000}
                  value={collateral}
                  onChange={(e) => setCollateral(Number(e.target.value))}
                />
              </div>
              <div className="slider-wrap">
                <label>
                  Loan-to-value <b>{ltv}%</b>
                </label>
                <input
                  type="range"
                  min={10}
                  max={70}
                  step={5}
                  value={ltv}
                  onChange={(e) => setLtv(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="calc-out">
              <div className="row">
                <span className="k">Borrowable now</span>
                <span className="v blue">${fmt(borrow)}</span>
              </div>
              <div className="row">
                <span className="k">Variable APR</span>
                <span className="v">5.9%</span>
              </div>
              <div className="row">
                <span className="k">Monthly cost</span>
                <span className="v">${fmt(monthly)}</span>
              </div>
              <div className="row">
                <span className="k">Liquidation buffer</span>
                <span className="v">{buffer}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Final CTA + footer                                                 */
/* ------------------------------------------------------------------ */

function FinalCta({
  onLaunch,
  launchLabel,
  onWaitlist,
}: {
  onLaunch: () => void;
  launchLabel: string;
  onWaitlist: () => void;
}) {
  const eyebrowRef = useReveal<HTMLSpanElement>();
  const titleRef = useReveal<HTMLHeadingElement>();
  const leadRef = useReveal<HTMLParagraphElement>();
  const ctaRef = useReveal<HTMLDivElement>();
  return (
    <section className="final">
      <div className="wrap">
        <span
          ref={eyebrowRef}
          className="eyebrow reveal"
          style={{ justifyContent: "center" }}
        >
          Get started
        </span>
        <h2 ref={titleRef} className="reveal d1">
          Your assets can do more than just sit there.
        </h2>
        <p ref={leadRef} className="sec-lead reveal d2">
          Bring your tokenized stocks and treasuries to Aeras. Earn yield,
          borrow cash, and keep every ounce of conviction.
        </p>
        <div ref={ctaRef} className="final-cta reveal d3">
          <button
            type="button"
            className="lbtn lbtn-primary lbtn-lg"
            onClick={onWaitlist}
          >
            Join the waitlist
          </button>
          <button
            type="button"
            className="lbtn lbtn-ghost lbtn-lg"
            onClick={onLaunch}
          >
            {launchLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-grid">
          <div style={{ maxWidth: 300 }}>
            <a
              href="#"
              className="logo"
              style={{ marginBottom: 16 }}
              aria-label="Aeras"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/aeras-logo-black.png"
                alt="Aeras"
                className="logo-img"
              />
            </a>
            <p
              style={{
                fontSize: 14,
                color: "var(--aeras-300)",
                lineHeight: 1.6,
              }}
            >
              Tokenized asset banking. Hold, earn, and borrow against the
              world&apos;s most popular assets.
            </p>
          </div>
          <div className="foot-col">
            <h4>Product</h4>
            <a href="#">Earn</a>
            <a href="#">Borrow</a>
            <a href="#">Aeras Card</a>
            <a href="#">Assets</a>
          </div>
          <div className="foot-col">
            <h4>Build</h4>
            <a href="#">Docs</a>
            <a href="#">API</a>
            <a href="#">Audits</a>
            <a href="#">GitHub</a>
          </div>
          <div className="foot-col">
            <h4>Company</h4>
            <a href="#">About</a>
            <a href="#">Blog</a>
            <a href="#">Careers</a>
            <a href="#">Contact</a>
          </div>
        </div>
        <div className="foot-bot">
          <span>© 2026 Aeras Finance</span>
          <span style={{ display: "flex", gap: 24 }}>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Disclosures</a>
          </span>
        </div>
        <p className="foot-disc">
          Aeras is a software interface to non-custodial protocols. Tokenized
          assets carry market and smart-contract risk. Yields are variable and
          not guaranteed. Nothing here is investment advice. Names and logos
          shown belong to their respective owners and are used to indicate
          supported assets and integrations.
        </p>
      </div>
    </footer>
  );
}
