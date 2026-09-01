import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "AI Finance Controller — Reconciliation Dashboard",
  description:
    "Production-grade AI-powered financial reconciliation engine with deterministic matching, Gemini AI verification, and honest audit logging.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} font-sans antialiased bg-[#0a0b0f] text-gray-100 min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
