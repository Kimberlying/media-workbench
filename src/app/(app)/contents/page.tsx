import Link from "next/link";
import { Card, Empty, PageHeader, buttonClass, ghostButtonClass, inputClass } from "@/components/ui";
import { TzOffsetInput } from "@/components/tz-offset-input";
import { PackSummary } from "@/components/pack-summary";
import { publishesViaApi } from "@/lib/connectors";
import { formatOfVariant } from "@/lib/content/formats";
import { STATUS_LABELS } from "@/lib/content/status";
import type { Account, Content, ContentStatus } from "@/lib/db/types";
import { requireSession } from "@/lib/session";
import {
  approveContent,
  markPublishedManually,
  rejectContent,
  saveContentBody,
  scheduleContent,
  submitContent,
} from "../actions";

const TABS: ContentStatus[] = ["draft", "pending_approval", "approved", "scheduled", "published"];

export default async function ContentsPage({ searchParams }: PageProps<"/contents">) {
  const { supabase, org } = await requireSession();
  const { status: rawStatus } = await searchParams;
  const status = TABS.includes(rawStatus as ContentStatus) ? (rawStatus as ContentStatus) : "draft";
  const tabs = org.settings.approval_required ? TABS : TABS.filter((t) => t !== "pending_approval");

  const { data } = await supabase
    .from("contents")
    .select("*, account:accounts(*)")
    .eq("status", status)
    .order(status === "scheduled" ? "scheduled_at" : "updated_at", { ascending: status === "scheduled" })
    .limit(50);
  const contents = (data ?? []) as (Content & { account: Account })[];

  return (
    <>
      <PageHeader title="内容" />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t} href={`/contents?status=${t}`} className={t === status ? buttonClass : ghostButtonClass}>
            {STATUS_LABELS[t]}
          </Link>
        ))}
      </div>

      {contents.length === 0 ? (
        <Empty>这里还没有内容。在「选题」里点「生成文案」。</Empty>
      ) : (
        <div className="grid gap-3">
          {contents.map((c) => {
            const viaApi = publishesViaApi(c.account.platform, c.variant);
            const format = formatOfVariant(c.variant);
            return (
              <Card key={c.id}>
                <div className="mb-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                  <span>
                    {c.account.platform} @{c.account.handle}
                  </span>
                  <span>{format.label}</span>
                  {c.scheduled_at ? <span>定时 {new Date(c.scheduled_at).toLocaleString("zh-CN")}</span> : null}
                  {!viaApi ? <span>发布包 · 人工发</span> : null}
                </div>
                {c.compliance_hits.length > 0 ? (
                  <p className="mb-2 text-sm text-red-600">命中禁用词：{c.compliance_hits.join("、")}，改完再提交。</p>
                ) : null}

                {status === "draft" ? (
                  <form action={saveContentBody.bind(null, c.id)} className="grid gap-2">
                    <textarea
                      name="body"
                      defaultValue={c.body}
                      rows={format.kind === "longform" ? 20 : 8}
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <button className={ghostButtonClass}>保存</button>
                      <button formAction={submitContent.bind(null, c.id)} className={buttonClass}>
                        提交
                      </button>
                    </div>
                  </form>
                ) : (
                  <details open={format.kind !== "longform"}>
                    <summary className="cursor-pointer text-sm text-zinc-500">
                      {c.pack?.kind === "longform" ? c.pack.title : "正文"}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{c.body}</pre>
                  </details>
                )}

                {c.pack ? <PackSummary contentId={c.id} pack={c.pack} /> : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {status === "pending_approval" ? (
                    <form action={approveContent.bind(null, c.id)}>
                      <button className={buttonClass}>批准</button>
                    </form>
                  ) : null}
                  {status === "approved" ? (
                    <form action={scheduleContent.bind(null, c.id)} className="flex items-center gap-2">
                      <input type="datetime-local" name="scheduled_at" required className={`${inputClass} w-auto`} />
                      <TzOffsetInput />
                      <button className={buttonClass}>{viaApi ? "定时发布" : "排期"}</button>
                    </form>
                  ) : null}
                  {status === "scheduled" && !viaApi ? (
                    <form action={markPublishedManually.bind(null, c.id)} className="flex items-center gap-2">
                      <input name="url" placeholder="发布后的链接（可选）" className={`${inputClass} w-64`} />
                      <button className={buttonClass}>已人工发布</button>
                    </form>
                  ) : null}
                  {["pending_approval", "approved", "scheduled"].includes(status) ? (
                    <form action={rejectContent.bind(null, c.id)} className="flex items-center gap-2">
                      {org.settings.approval_required ? (
                        <input name="reason" placeholder="退回原因" className={`${inputClass} w-48`} />
                      ) : null}
                      <button className={ghostButtonClass}>退回草稿</button>
                    </form>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
