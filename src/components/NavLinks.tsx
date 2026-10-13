"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Map" },
  { href: "/impact", label: "Impact" },
  { href: "/about", label: "About" },
];

/** The page switcher in the top bar: a rounded pill with the current page highlighted. */
export default function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex rounded-full bg-neutral-100 p-1 text-[13px] font-semibold">
      {LINKS.map(({ href, label }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 transition ${active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
