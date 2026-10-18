import Link from "next/link";
import {
  Card,
  Empty,
  PageHeader,
  PlatformBadge,
  activeTabClass,
  buttonClass,
  chipClass,
  ghostButtonClass,
  inputClass,
  tabClass,
} from "@/components/ui";
import { TzOffsetInput } from "@/components/tz-offset-input";
import { PackSummary } from "@/components/pack-summary";
import { RewriteForm } from "./rewrite-form";
import { publishesViaApi } from "@/lib/connectors";
import { formatOfVariant } from "@/lib/content/formats";
import { STATUS_LABELS } from "@/lib/content/status";
import type { Account, Content, ContentStatus } from "@/lib/db/types";
import { requireSession } from "@/lib/session";
import {
  approveContent,
  markPublishedManually,
  regenerateXPost,
  rejectContent,
  resolveUncertainPublish,
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
    .select("*, account:accounts(*), posts(id, platform_post_id)")
    .eq("status", status)
    .order(status === "scheduled" ? "scheduled_at" : "updated_at", { ascending: status === "scheduled" })
    .limit(50);
  const contents = (data ?? []) as (Content & {
    account: Account;
    posts: { id: string; platform_post_id: string | null }[];
  })[];
  const { data: accountRows } = await supabase.from("accounts").select("*").order("created_at");

  return (
    <>
      <PageHeader title="内容" />
      <div className="mb-4">
        <RewriteForm accounts={(accountRows ?? []) as Account[]} />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t} href={`/contents?status=${t}`} className={t === status ? activeTabClass : tabClass}>
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
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <PlatformBadge platform={c.account.platform} />
                  <span className="text-sm font-medium">
                    {c.account.platform === "x" ? "@" : ""}
                    {c.account.handle}
                  </span>
                  <span className={chipClass}>{format.label}</span>
                  {c.scheduled_at ? (
                    <span className={chipClass}>定时 {new Date(c.scheduled_at).toLocaleString("zh-CN")}</span>
                  ) : null}
                  {!viaApi ? <span className={chipClass}>发布包 · 人工发</span> : null}
                </div>
                {status === "scheduled" && viaApi && c.posts.some((p) => !p.platform_post_id) ? (
                  <form
                    action={resolveUncertainPublish.bind(null, c.id)}
                    className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn"
                  >
                    <span>发布中断，结果不确定，不会自动重发。请到 X 上看看有没有发出去：</span>
                    <input name="url" placeholder="发出去了就贴链接" className={`${inputClass} w-56`} />
                    <button name="outcome" value="published" className={ghostButtonClass}>
                      已发出
                    </button>
                    <button name="outcome" value="not_published" className={ghostButtonClass}>
                      没发出，重新排队
                    </button>
                  </form>
                ) : null}
                {c.compliance_hits.length > 0 ? (
                  <p className="mb-3 rounded-xl bg-bad-soft p-3 text-sm text-bad">命中禁用词：{c.compliance_hits.join("、")}，改完再提交。</p>
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
                      {c.pack?.kind === "post" && c.pack.source ? (
                        <button formAction={regenerateXPost.bind(null, c.id)} className={ghostButtonClass}>
                          重出
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <details open={format.kind !== "longform"}>
                    <summary className="cursor-pointer text-sm text-muted">
                      {c.pack?.kind === "longform" ? c.pack.title : "正文"}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{c.body}</pre>
                  </details>
                )}

                {c.pack ? <PackSummary contentId={c.id} pack={c.pack} body={c.body} /> : null}

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
