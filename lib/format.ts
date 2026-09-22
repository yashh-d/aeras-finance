// Display formatting for prices.
//
// Four surfaces had their own copy of this and none of them grouped thousands,
// so a $77,143 perp printed "77143.10" directly above its own axis, which
// writes "77,414". Same defect on the gold rows, where "4368.73" is a price a
// reader has to count digits on.
//
// Grouping is pinned to en-US rather than the viewer's locale. Every other
// figure in the app is written that way, including the axis ticks these sit
// beside, and a locale that groups with periods would disagree with them on
// screen. It also keeps the server and client renders identical, which a
// locale-dependent string does not.

export function formatUsdPrice(price: number, subDollarDigits = 4): string {
  // Below a dollar the cents are not the interesting digits, so the caller
  // decides how many to keep: four for spot, five for perps, whose ticks are
  // finer.
  const digits = price >= 1 ? 2 : subDollarDigits;
  return price.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
