import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import "./globals.css";
import { APP_NAME } from "@/lib/brand";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Stuck at a broken traffic light? Report it and we send it to the agency that fixes it.",
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
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
        <header className="relative z-20 flex items-center justify-between gap-2 bg-white px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-[0_1px_6px_rgb(0_0_0/0.06)]">
          <Link href="/" className="flex min-w-0 items-center gap-2 font-bold text-neutral-900">
            <span aria-hidden className="flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-[2px] rounded-[10px] bg-neutral-900 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            </span>
            <span className="truncate text-[15px] max-[350px]:hidden">{APP_NAME}</span>
          </Link>
          <NavLinks />
        </header>
        {children}
      </body>
    </html>
  );
}
