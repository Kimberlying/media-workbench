import { Empty, PageHeader } from "@/components/ui";
import type { NewsItem } from "@/lib/db/types";
import { detectPlatform } from "@/lib/sources/platforms";
import { requireSession } from "@/lib/session";
import { createSource } from "../actions";

/** 雷达里能直接转写的：视频平台的链接（X 帖子大多不是视频，不放按钮） */
function transcribable(url: string): boolean {
  const platform = detectPlatform(url);
  return platform !== null && platform !== "x";
}

export default async function RadarPage({ searchParams }: PageProps<"/radar">) {
  const { supabase } = await requireSession();
  const { tag } = await searchParams;

  let query = supabase.from("news_items").select("*").order("fetched_at", { ascending: false }).limit(100);
  if (typeof tag === "string") query = query.contains("tags", [tag]);
  const { data } = await query;
  const items = (data ?? []) as NewsItem[];

  return (
    <>
      <PageHeader title="资讯雷达">
        {typeof tag === "string" ? (
          <a href="/radar" className="text-sm text-muted underline">
            清除标签：{tag}
          </a>
        ) : null}
      </PageHeader>
      {items.length === 0 ? (
        <Empty>还没有资讯。每天早上 7 点（北京时间）从固定信源和 X 自动抓取；先去「账号与档案」填好档案。</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((n) => (
            <li key={n.id} className="py-3">
              <a href={n.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {n.title || n.url}
              </a>
              <p className="mt-1 text-sm text-muted">{n.summary}</p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                <span>{n.source === "x" ? "X（Grok 搜索）" : n.source === "web" ? "全网" : n.source}</span>
                {n.heat > 0 ? <span>热度 {n.heat}</span> : null}
                <span>{new Date(n.fetched_at).toLocaleString("zh-CN")}</span>
                {n.tags.map((t) => (
                  <a key={t} href={`/radar?tag=${encodeURIComponent(t)}`} className="rounded-full bg-soft px-2">
                    {t}
                  </a>
                ))}
                {transcribable(n.url) ? (
                  <form action={createSource}>
                    <input type="hidden" name="url" value={n.url} />
                    <button className="rounded-full bg-ink px-2 text-ink-fg hover:opacity-85">转写</button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
