import { Card, Empty, PageHeader } from "@/components/ui";
import { latestByPost, summarize } from "@/lib/analytics";
import { daysAgoIso } from "@/lib/dates";
import { requireSession } from "@/lib/session";

interface Row {
  id: string;
  platform_post_id: string | null;
  published_at: string;
  method: "api" | "manual";
  content: { body: string; account: { platform: string; handle: string } };
  metrics: { date: string; views: number; likes: number; comments: number; shares: number; follows: number }[];
}

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const { supabase } = await requireSession();
  const { days: rawDays } = await searchParams;
  const days = rawDays === "30" ? 30 : 7;
  const since = daysAgoIso(days);

  const { data } = await supabase
    .from("posts")
    .select("id, platform_post_id, published_at, method, content:contents(body, account:accounts(platform, handle)), metrics(*)")
    .gte("published_at", since)
    .order("published_at", { ascending: false });
  const rows = latestByPost((data ?? []) as unknown as Row[]);
  const totals = summarize(rows.map((r) => r.latest));

  return (
    <>
      <PageHeader title={`近 ${days} 天复盘`}>
        <a href={`/analytics?days=${days === 7 ? 30 : 7}`} className="text-sm underline">
          看近 {days === 7 ? 30 : 7} 天
        </a>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["发布", rows.length],
          ["曝光", totals.views],
          ["点赞", totals.likes],
          ["评论", totals.comments],
          ["转发", totals.shares],
        ].map(([label, value]) => (
          <Card key={label}>
            <div className="text-2xl font-semibold tabular-nums">{Number(value).toLocaleString("zh-CN")}</div>
            <div className="text-sm text-zinc-500">{label}</div>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>这段时间还没有发布记录。X 的数据每天凌晨 3 点（北京时间）自动拉取。</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-2 pr-3">内容</th>
                <th className="py-2 pr-3">账号</th>
                <th className="py-2 pr-3 text-right">曝光</th>
                <th className="py-2 pr-3 text-right">点赞</th>
                <th className="py-2 pr-3 text-right">评论</th>
                <th className="py-2 text-right">转发</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows
                .sort((a, b) => b.latest.views - a.latest.views)
                .map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-md truncate py-2 pr-3">{r.content.body.split("\n")[0]}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.content.account.platform} @{r.content.account.handle}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.latest.views}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.latest.likes}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.latest.comments}</td>
                    <td className="py-2 text-right tabular-nums">{r.latest.shares}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
