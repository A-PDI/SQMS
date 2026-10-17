import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./fonts.css";
import "./shell.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "PDI Inspection Management System", template: "%s | PDI" },
  description: "PDI Quality Management",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
