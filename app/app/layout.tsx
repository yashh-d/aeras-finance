// This layout exists for one reason: to guarantee that no white ever shows on
// the app surface, however hard someone scrolls.
//
// White is the default page canvas, because globals.css paints `body` with
// `bg-background`. Chrome shows the canvas wherever it has not rasterized yet,
// which during a fast scroll is a real, visible region (see globals.css), and
// also in the overscroll rubber band and any gap under a shrinking document.
//
// Marking each of the page's own wrappers is not enough on its own. A Suspense
// fallback, an error boundary or any future state that renders before those
// wrappers mount has no marker, and would flash white. This layout wraps EVERY
// state of the route, including those, so the marker is present from the first
// server-rendered byte until the user navigates away.
//
// The background is also set here directly, not only through the stylesheet, so
// the surface survives a browser that does not support `:has()`.
//
// The wrapper is a flex column that fills the body so the page's own `flex-1`
// states keep filling the viewport; body is `min-h-full flex flex-col`. It
// carries `min-h-screen` as well as `flex-1` so it covers a full viewport on its
// own, without depending on how body's flex resolves.
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      data-app-canvas
      className="flex min-h-screen flex-1 flex-col"
      style={{ backgroundColor: "#08090a" }}
    >
      {children}
    </div>
  );
}
