"use client";

// Grouped action menu for the wallet's Fund button.
//
// Funding used to be eight buttons across three labelled rows, one per
// chain/asset pair. That put every destination at equal weight and made the
// panel read as a control surface rather than a wallet. The menu keeps all the
// same destinations but asks the two questions in order: which chain, then
// which asset, with a logo against each so the chain is recognised before the
// label is read.

// The menu renders into a portal on document.body rather than next to the
// button. It has to: every Card on the app surface carries `backdrop-blur-2xl`,
// and a backdrop-filter creates a stacking context, so an absolutely positioned
// child is sealed inside its own card no matter how high its z-index goes. The
// wallet card comes before the price chart card in the DOM, so the chart painted
// straight over the open menu. A portal leaves that stacking context entirely,
// which also makes the menu immune to any `overflow-hidden` or transform an
// ancestor picks up later.

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface FundOption {
  // Stable across renders; used as the React key.
  id: string;
  label: string;
  // Optional second line, e.g. where the funds come from.
  hint?: string;
  // Public path to the asset mark.
  logo?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface FundGroup {
  chain: string;
  chainLogo?: string;
  options: FundOption[];
}

// Matches the old `w-[min(88vw,17rem)]`, now applied as an inline width because
// the menu is positioned in viewport coordinates.
const MENU_MAX_WIDTH_PX = 272; // 17rem
const GAP_PX = 8;
const VIEWPORT_PAD_PX = 8;
// Below this, a downward drop is too cramped to be worth it and the menu flips.
const MIN_DROP_HEIGHT_PX = 200;

// Viewport coordinates for the portalled menu. Exactly one of `top` / `bottom`
// is set, depending on whether the menu drops or flips.
interface MenuCoords {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

export function FundMenu({
  label = "Fund",
  groups,
  busyLabel,
}: {
  label?: string;
  groups: FundGroup[];
  // Shown in place of the label while a wallet is being provisioned.
  busyLabel?: string | null;
}) {
  // One piece of state: non-null means open, and carries where to draw. Keeping
  // "is it open" and "where is it" together means the menu can never render for
  // a frame at a stale position.
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const open = coords !== null;

  // Position the portalled menu against the trigger. Measured on click and again
  // on any scroll or resize, because a fixed-position menu does not travel with
  // the button the way an absolutely positioned one did.
  const measure = useCallback((): MenuCoords | null => {
    const el = btnRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const width = Math.min(window.innerWidth * 0.88, MENU_MAX_WIDTH_PX);
    const left = Math.min(
      Math.max(VIEWPORT_PAD_PX, r.left),
      window.innerWidth - width - VIEWPORT_PAD_PX,
    );
    const below = window.innerHeight - r.bottom - GAP_PX - VIEWPORT_PAD_PX;
    const above = r.top - GAP_PX - VIEWPORT_PAD_PX;
    // Drop down by default; flip up only when below is genuinely cramped and
    // above has more room.
    const dropDown = below >= MIN_DROP_HEIGHT_PX || below >= above;
    return {
      left,
      width,
      top: dropDown ? r.bottom + GAP_PX : undefined,
      bottom: dropDown ? undefined : window.innerHeight - r.top + GAP_PX,
      maxHeight: Math.max(MIN_DROP_HEIGHT_PX, dropDown ? below : above),
    };
  }, []);

  // Close on Escape, and keep the menu pinned to the button while open. The
  // click-away is handled by the backdrop below, which is more reliable than a
  // document listener racing the button's own onClick.
  useEffect(() => {
    if (!open) return;
    const reposition = () => setCoords((c) => (c ? measure() : c));
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCoords(null);
    }
    window.addEventListener("keydown", onKey);
    // Capture phase, so a scrolling ancestor moves the menu too, not just the
    // window.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, measure]);

  return (
    <div className="relative">
      <button
        type="button"
        ref={btnRef}
        onClick={() => setCoords((c) => (c ? null : measure()))}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15"
      >
        {busyLabel ?? label}
        <ChevronDown
          className={`size-3.5 text-white/50 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open &&
        coords &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[999]"
              onClick={() => setCoords(null)}
              aria-hidden="true"
            />
            <div
              role="menu"
              style={{
                position: "fixed",
                left: coords.left,
                width: coords.width,
                top: coords.top,
                bottom: coords.bottom,
                maxHeight: coords.maxHeight,
              }}
              className="z-[1000] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[#111415] p-1 shadow-2xl"
            >
              {groups.map((g, gi) => (
                <div
                  key={g.chain}
                  className={
                    gi > 0 ? "mt-1 border-t border-white/[0.07] pt-1" : ""
                  }
                >
                  <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5">
                    {g.chainLogo && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={g.chainLogo}
                        alt=""
                        aria-hidden="true"
                        className="size-3.5 shrink-0 rounded-full object-contain"
                      />
                    )}
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
                      {g.chain}
                    </span>
                  </div>
                  {g.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="menuitem"
                      disabled={o.disabled}
                      onClick={() => {
                        setCoords(null);
                        o.onSelect();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {o.logo && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={o.logo}
                          alt=""
                          aria-hidden="true"
                          className="size-5 shrink-0 rounded-full object-cover"
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-white">
                          {o.label}
                        </span>
                        {o.hint && (
                          <span className="mt-0.5 block truncate text-[11px] text-white/40">
                            {o.hint}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
