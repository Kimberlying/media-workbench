import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { daysAgoIso, weekStart } from "@/lib/dates";
import { requireSession } from "@/lib/session";

export default async function OverviewPage() {
  const { supabase, org } = await requireSession();
  const since = daysAgoIso(1);
  const thisWeek = weekStart(new Date());

  const [news, candidates, weekTopics, drafts, scheduled] = await Promise.all([
    supabase.from("news_items").select("id", { count: "exact", head: true }).gte("fetched_at", since),
    supabase.from("topics").select("id", { count: "exact", head: true }).eq("status", "candidate"),
    supabase.from("topics").select("id", { count: "exact", head: true }).eq("scheduled_week", thisWeek),
    supabase.from("contents").select("id", { count: "exact", head: true }).eq("status", "draft"),
    supabase.from("contents").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
  ]);

  const stats = [
    { label: "24 小时新资讯", value: news.count ?? 0, href: "/radar" },
    { label: "待挑选题", value: candidates.count ?? 0, href: "/topics" },
    { label: "本周排期选题", value: weekTopics.count ?? 0, href: "/topics?view=week" },
    { label: "待改草稿", value: drafts.count ?? 0, href: "/contents?status=draft" },
    { label: "已排期待发", value: scheduled.count ?? 0, href: "/contents?status=scheduled" },
  ];

  return (
    <>
      <PageHeader title={`${org.name} · 今天`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card>
              <div className="text-2xl font-semibold">{s.value}</div>
              <div className="text-sm text-zinc-500">{s.label}</div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
