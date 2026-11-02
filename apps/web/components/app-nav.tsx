"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/collections", label: "Collections" },
  { href: "/profiles", label: "Profiles" },
  { href: "/connections", label: "Connections" },
  { href: "/account", label: "Account" },
];

export function AppNav() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav aria-label="Main">
      <ul className="tabs">
        {TABS.map((tab) => (
          <li key={tab.href}>
            <Link href={tab.href} aria-current={active(tab.href) ? "page" : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
