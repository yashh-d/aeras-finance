import type { Metadata } from "next";

import { DemoTerminal } from "@/components/DemoTerminal";

// A public, read-only view of the Terminal for partner evaluation. It is not
// linked from anywhere and is kept out of search indexes; the product itself
// stays behind the waitlist at /app.
export const metadata: Metadata = {
  title: "Demo | Aeras",
  description: "A read-only view of the Aeras Terminal.",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <DemoTerminal />;
}
