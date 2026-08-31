import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

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
      className={`${geistSans.variable} ${geistMono.variable} dark`}
      style={{ height: "100%", overflow: "hidden" }}
    >
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{
          __html: `if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(console.error); }`
        }} />
      </head>
      <body
        style={{ height: "100%", overflow: "hidden", background: "#0B0E11" }}
      >
        <a href="#main-content" className="skip-nav">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
