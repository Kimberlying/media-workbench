"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "概览" },
  { href: "/radar", label: "资讯雷达" },
  { href: "/topics", label: "选题" },
  { href: "/contents", label: "内容" },
  { href: "/analytics", label: "复盘" },
  { href: "/accounts", label: "账号与档案" },
  { href: "/knowledge", label: "知识库" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[15px] font-medium ${
              active ? "bg-panel text-foreground shadow-card" : "text-muted hover:bg-panel/60 hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
