import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "recountly",
  description: "A private spoken-word journal. Speak, and watch the words appear.",
  // "Add to Home Screen" on iOS Safari (no manifest support there — this is
  // the iOS-specific path; manifest.ts covers Android/Chrome).
  appleWebApp: {
    capable: true,
    title: "recountly",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  // black-translucent status bar draws under the notch; viewportFit: cover
  // extends content full-bleed so env(safe-area-inset-*) has room to work.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
        <Script src="https://prompt-labs.org/beacon.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
