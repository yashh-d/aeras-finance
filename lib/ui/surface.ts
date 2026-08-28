// The card surface every section draws on the night canvas. Glass, not an
// opaque fill: the ambient blue wash behind the page reads through the surface,
// and the inset top hairline is the lit edge that keeps it from looking like a
// flat grey rectangle.
//
// Padding is deliberately left out. The dashboard cards, the Markets group
// cards and the Borrow sections all size their own, and baking one in here
// meant every caller overriding it.
export const GLASS_SURFACE =
  "rounded-2xl border border-white/[0.10] bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-2xl";

// A panel nested inside a GLASS_SURFACE card: a ticket, a stat block, a
// summary. A lift in the same white wash rather than a second opaque fill,
// since stacking two opaque greys kills the ambient blue that reads through
// every other surface. No backdrop blur, because the card underneath already
// blurred what is behind it.
export const INSET_PANEL =
  "rounded-xl border border-white/[0.07] bg-white/[0.04]";
