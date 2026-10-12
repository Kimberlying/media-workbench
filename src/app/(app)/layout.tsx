import { Suspense } from "react";
import { requireSession } from "@/lib/session";
import { Nav } from "./nav";

// 工作台每个页面都按登录用户取数，整体放在一个 Suspense 里流式渲染
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b border-zinc-200 p-4 md:w-52 md:border-b-0 md:border-r dark:border-zinc-800">
        <Suspense fallback={<div className="h-9" />}>
          <OrgBadge />
        </Suspense>
        <Nav />
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <Suspense fallback={<p className="text-sm text-zinc-500">加载中…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}

async function OrgBadge() {
  const { org, user } = await requireSession();
  return (
    <div>
      <div className="font-semibold">{org.name}</div>
      <div className="truncate text-xs text-zinc-500">{user.email}</div>
    </div>
  );
}
