import { Suspense } from "react";
import { requireSession } from "@/lib/session";
import { Nav } from "./nav";

// 工作台每个页面都按登录用户取数，整体放在一个 Suspense 里流式渲染
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-4 p-4 md:w-60 md:gap-6 md:px-4 md:py-6">
        <Suspense fallback={<div className="h-9" />}>
          <OrgBadge />
        </Suspense>
        <Nav />
      </aside>
      <main className="min-w-0 flex-1 p-4 md:py-8 md:pl-6 md:pr-10">
        <div className="max-w-5xl">
          <Suspense fallback={<p className="text-sm text-muted">加载中…</p>}>{children}</Suspense>
        </div>
      </main>
    </div>
  );
}

async function OrgBadge() {
  const { org, user } = await requireSession();
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 grid-cols-2 place-content-center gap-0.5 rounded-[10px] bg-[#16161a] p-[7px]">
        <i className="h-2 w-2 rounded-[3px] bg-[#ff2442]" />
        <i className="h-2 w-2 rounded-[3px] bg-white" />
        <i className="h-2 w-2 rounded-[3px] bg-[#0a66c2]" />
        <i className="h-2 w-2 rounded-[3px] bg-[#07c160]" />
      </span>
      <div className="min-w-0">
        <div className="truncate font-black">{org.name}</div>
        <div className="truncate text-xs text-muted">{user.email}</div>
      </div>
    </div>
  );
}
