import type { ReactNode } from "react";
import type { Platform } from "@/lib/db/types";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-black">{title}</h1>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border-2 border-dashed border-line p-8 text-center text-sm text-muted">{children}</p>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-[20px] bg-panel p-5 shadow-card md:p-6">{children}</div>;
}

// 平台徽章：平台色只出现在这里，用来一眼分清是哪个平台的内容
const PLATFORM_BADGE: Record<Platform, { label: string; mark: string; dot: string; chip: string }> = {
  x: { label: "X", mark: "X", dot: "bg-black dark:bg-white dark:text-black", chip: "bg-soft text-foreground" },
  xiaohongshu: { label: "小红书", mark: "书", dot: "bg-[#ff2442]", chip: "bg-[#ffe8ec] text-[#c0102e] dark:bg-[#3d1c22] dark:text-[#ff8a9a]" },
  wechat: { label: "公众号", mark: "公", dot: "bg-[#07c160]", chip: "bg-[#e2f7ea] text-[#0a7a3b] dark:bg-[#133a24] dark:text-[#6fd99a]" },
  linkedin: { label: "LinkedIn", mark: "in", dot: "bg-[#0a66c2]", chip: "bg-[#e3effb] text-[#0a4f94] dark:bg-[#142a44] dark:text-[#7db8f0]" },
  instagram: { label: "Instagram", mark: "IG", dot: "bg-[#d62976]", chip: "bg-[#fce6f1] text-[#a3195b] dark:bg-[#3a1730] dark:text-[#f08bc8]" },
  zhihu: { label: "知乎", mark: "知", dot: "bg-[#0066ff]", chip: "bg-[#e5efff] text-[#0050c8] dark:bg-[#142446] dark:text-[#8ab4ff]" },
  threads: { label: "Threads", mark: "@", dot: "bg-black dark:bg-white dark:text-black", chip: "bg-soft text-foreground" },
  facebook: { label: "Facebook", mark: "f", dot: "bg-[#1877f2]", chip: "bg-[#e7f0fe] text-[#1457b8] dark:bg-[#16284a] dark:text-[#8ab4ff]" },
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  const b = PLATFORM_BADGE[platform] ?? PLATFORM_BADGE.x;
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full py-1 pl-1 pr-3 text-sm font-bold ${b.chip}`}>
      <i className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black not-italic text-white ${b.dot}`}>
        {b.mark}
      </i>
      {b.label}
    </span>
  );
}

export const chipClass = "inline-flex items-center whitespace-nowrap rounded-full bg-soft px-2.5 py-1 text-xs text-muted";

export const inputClass =
  "w-full rounded-xl border-0 bg-soft px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ink/20";

export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 py-2 text-sm font-bold text-ink-fg hover:opacity-85";

export const ghostButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-soft px-4 py-2 text-sm font-medium hover:bg-line";

export const tabClass = "rounded-full px-4 py-2 text-sm font-medium text-muted hover:bg-panel hover:text-foreground";

export const activeTabClass = "rounded-full bg-ink px-4 py-2 text-sm font-bold text-ink-fg";
