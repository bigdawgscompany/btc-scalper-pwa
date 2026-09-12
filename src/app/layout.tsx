import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { PwaRegistration } from "@/components/pwa-registration";

export const metadata: Metadata = {
  title: "BTC Scalper — Paper Research Terminal",
  description:
    "Personal paper-only research workspace for BTCUSDT 15m signal analysis and simulated autopilot. Paper only. No real orders.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192" }, { url: "/icon-512.png", sizes: "512x512" }],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BTC Scalper",
  },
  openGraph: {
    title: "BTC Scalper — Paper Research Terminal",
    description:
      "Paper-only BTCUSDT 15m oscillator matrix and simulated autopilot. Not financial advice.",
    type: "website",
    siteName: "BTC Scalper",
  },
  keywords: ["bitcoin", "paper trading", "research terminal", "oscillator", "signal analysis"],
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0B0E11",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // Allow zoom for accessibility (up to 200%)
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
      style={{ height: "100%", overflow: "hidden" }}
    >
      <body
        style={{ height: "100%", overflow: "hidden", background: "#0B0E11" }}
        className="font-sans"
      >
        <a href="#main-content" className="skip-nav">
          Skip to main content
        </a>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}