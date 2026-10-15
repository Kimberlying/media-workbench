import Link from "next/link";
import { Card, Empty, PageHeader, buttonClass, ghostButtonClass, inputClass } from "@/components/ui";
import { formatsFor } from "@/lib/content/formats";
import type { Account, Topic } from "@/lib/db/types";
import { addDays, weekStart } from "@/lib/dates";
import { requireSession } from "@/lib/session";
import { discardTopic, requestContents, requestTopics, scheduleTopic } from "../actions";

export default async function TopicsPage({ searchParams }: PageProps<"/topics">) {
  const { supabase } = await requireSession();
  const { view } = await searchParams;
  const showWeek = view === "week";

  const { data: accountRows } = await supabase.from("accounts").select("*").order("created_at");
  const accounts = (accountRows ?? []) as Account[];
  const handleOf = new Map(accounts.map((a) => [a.id, `${a.platform} @${a.handle}`]));

  const thisWeek = weekStart(new Date());
  const query = showWeek
    ? supabase
        .from("topics")
        .select("*")
        .in("scheduled_week", [thisWeek, addDays(thisWeek, 7)])
        .order("scheduled_week")
    : supabase
        .from("topics")
        .select("*")
        .in("status", ["candidate", "selected"])
        .order("score", { ascending: false })
        .limit(60);
  const { data } = await query;
  const topics = (data ?? []) as Topic[];

  return (
    <>
      <PageHeader title={showWeek ? "周日历" : "选题池"}>
        <Link href={showWeek ? "/topics" : "/topics?view=week"} className={ghostButtonClass}>
          {showWeek ? "看选题池" : "看周日历"}
        </Link>
        {accounts
          .filter((a) => a.profile_id)
          .map((a) => (
            <form key={a.id} action={requestTopics.bind(null, a.id)}>
              <button className={buttonClass}>为 @{a.handle} 出选题</button>
            </form>
          ))}
      </PageHeader>

      {topics.length === 0 ? (
        <Empty>
          {showWeek
            ? "本周和下周还没有排期的选题。"
            : "选题池是空的。资讯雷达每天抓完会自动出选题，也可以点右上角手动出一批。"}
        </Empty>
      ) : (
        <div className="grid gap-3">
          {topics.map((t) => (
            <Card key={t.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{t.title}</div>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.angle}</p>
                  <div className="mt-1 text-xs text-zinc-500">
                    {handleOf.get(t.account_id)} · 热度 {t.heat_score} · 相关性 {t.relevance_score}
                    {t.scheduled_week ? ` · ${t.scheduled_week} 这周` : ""}
                    {t.status === "selected" ? " · 文案生成中" : ""}
                  </div>
                </div>
                <div className="text-2xl font-semibold tabular-nums">{t.score}</div>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <form action={requestContents.bind(null, t.id)} className="flex flex-wrap items-center gap-2">
                  {accounts.flatMap((a) =>
                    formatsFor(a.platform).map((f, i) => (
                      <label key={`${a.id}|${f.id}`} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          name="targets"
                          value={`${a.id}|${f.id}`}
                          defaultChecked={a.id === t.account_id && i === 0}
                          disabled={!a.profile_id}
                        />
                        {f.label} @{a.handle}
                      </label>
                    )),
                  )}
                  <button className={buttonClass}>生成文案</button>
                </form>
                {!showWeek ? (
                  <>
                    <form action={scheduleTopic.bind(null, t.id)} className="flex items-center gap-2">
                      <input type="date" name="week" className={`${inputClass} w-auto`} />
                      <button className={ghostButtonClass}>排进这周</button>
                    </form>
                    <form action={discardTopic.bind(null, t.id)}>
                      <button className={ghostButtonClass}>不做</button>
                    </form>
                  </>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
