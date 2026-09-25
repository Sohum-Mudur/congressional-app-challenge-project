import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Signal Report",
  description: "Stuck at a broken traffic light? Report it and we send it to the agency that fixes it.",
  appleWebApp: { capable: true, title: "Signal Report", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#dc2626",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <header className="z-20 flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
          <Link href="/" className="flex items-center gap-2 font-bold text-neutral-900">
            <span aria-hidden className="flex h-7 w-7 flex-col items-center justify-center gap-[2px] rounded-md bg-neutral-900">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            </span>
            Signal Report
          </Link>
          <nav className="flex gap-4 text-sm font-medium text-neutral-600">
            <Link href="/">Map</Link>
            <Link href="/impact">Impact</Link>
            <Link href="/about">About</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
