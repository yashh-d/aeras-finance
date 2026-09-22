// The card surface every section draws on the night canvas. Glass, not an
// opaque fill: the ambient blue wash behind the page reads through the surface,
// and the inset top hairline is the lit edge that keeps it from looking like a
// flat grey rectangle.
//
// The translucency is what lets the wash through, so the glass look lives in
// `bg-white/[0.06]`. There is deliberately NO `backdrop-blur` here any more.
// It cost a great deal and bought nothing: the only thing behind a card is the
// flat canvas and two radial gradients at a tenth of an alpha, and blurring a
// gradient that smooth by 40px returns the same pixels. Nothing scrolls under
// a card either, since the sidebar sits beside the content rather than over it.
//
// What it cost was every frame of every scroll. A backdrop filter has to
// re-sample everything painted behind the element, and Home alone stacks eight
// of these over a position:fixed wash. When the raster falls behind the scroll,
// Chrome composites the tiles it has and leaves the rest unpainted, which is
// the blank card-shaped blocks and the scroll that feels stuck. Overlay
// surfaces that genuinely sit over content (dialog backdrops, the asset
// popover, the Earn tooltip) keep their blur, because there the blur is the
// point.
//
// `isolate` replaces it as the stacking context the blur used to create, which
// HomeCharts relies on to lift an open picker above the next card. It is also
// strictly better than the blur was: backdrop-filter additionally made every
// card a containing block for fixed descendants, which ChartAssetPicker had to
// work around.
//
// Padding is deliberately left out. The dashboard cards, the Markets group
// cards and the Borrow sections all size their own, and baking one in here
// meant every caller overriding it.
export const GLASS_SURFACE =
  "isolate rounded-2xl border border-white/[0.10] bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]";

// A panel nested inside a GLASS_SURFACE card: a ticket, a stat block, a
// summary. A lift in the same white wash rather than a second opaque fill,
// since stacking two opaque greys kills the ambient blue that reads through
// every other surface. No backdrop blur, because the card underneath already
// blurred what is behind it.
export const INSET_PANEL =
  "rounded-xl border border-white/[0.07] bg-white/[0.04]";
