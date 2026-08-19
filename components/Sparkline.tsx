"use client";

// A closes-only line for a table row.
//
// Hand-drawn SVG rather than recharts. At this size there is no axis, tooltip,
// legend or animation to configure, and a hedge tab renders one per held
// ticker, so mounting a chart library instance for each is a lot of machinery
// to draw a polyline. Colour follows direction over the window, matching the
// candles above it.

const UP = "#119b62";
const DOWN = "#d93232";
const FLAT = "#6f7174";

export function Sparkline({
  values,
  width = 72,
  height = 22,
}: {
  values: number[] | undefined;
  width?: number;
  height?: number;
}) {
  if (!values || values.length < 2) {
    return <div style={{ width, height }} aria-hidden />;
  }

  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }

  // A flat series has no range to scale against, so it is drawn down the middle
  // rather than divided by zero.
  const span = high - low;
  const stepX = width / (values.length - 1);
  const points = values
    .map((value, i) => {
      const y = span === 0 ? height / 2 : height - ((value - low) / span) * height;
      // Inset by half a pixel so the stroke is not clipped at the edges.
      const clamped = Math.min(height - 0.5, Math.max(0.5, y));
      return `${(i * stepX).toFixed(2)},${clamped.toFixed(2)}`;
    })
    .join(" ");

  const change = values[values.length - 1] - values[0];
  const stroke = change === 0 ? FLAT : change > 0 ? UP : DOWN;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
