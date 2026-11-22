import Link from "next/link";
import type { ReactNode } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, Empty, PageHeader, buttonClass, chipClass, ghostButtonClass, inputClass } from "@/components/ui";
import { formatsFor } from "@/lib/content/formats";
import type { Account, Source, SourceStatus } from "@/lib/db/types";
import { clock } from "@/lib/sources/digest";
import { PLATFORM_LABELS, SUPPORTED_HINT, linkAt, type SourcePlatform } from "@/lib/sources/platforms";
import { requireSession } from "@/lib/session";
import { createSource, deleteSource, retrySource, writeFromSource } from "../actions";
import { UploadForm } from "./upload-form";

// 素材：贴一个视频或播客链接 → 文字稿 → 摘要、章节、要点、金句、爆款拆解 → 选一个角度直接写多平台文案。

const STATUS_LABELS: Record<SourceStatus, string> = {
  pending: "排队中",
  transcribing: "转写中",
  digesting: "整理中",
  ready: "好了",
  failed: "失败",
};

const RUNNING: SourceStatus[] = ["pending", "transcribing", "digesting"];

type ListRow = Pick<Source, "id" | "url" | "platform" | "title" | "author" | "duration_seconds" | "status" | "error"> & {
  digest_title: string | null;
  summary: string | null;
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform as SourcePlatform] ?? platform;
}

function Meta({ source }: { source: Pick<Source, "platform" | "duration_seconds" | "status"> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={chipClass}>{platformLabel(source.platform)}</span>
      {source.duration_seconds ? <span className={chipClass}>{clock(source.duration_seconds)}</span> : null}
      <span className={`${chipClass} ${source.status === "failed" ? "text-bad" : ""}`}>{STATUS_LABELS[source.status]}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h3 className="mb-2 font-bold">{title}</h3>
      {children}
    </Card>
  );
}

export default async function SourcesPage({ searchParams }: PageProps<"/sources">) {
  const { supabase, org } = await requireSession();
  const { id, error, sent } = await searchParams;

  const [{ data: rows }, { data: detail }, { data: accountRows }] = await Promise.all([
    supabase
      .from("sources")
      .select(
        "id, url, platform, title, author, duration_seconds, status, error, digest_title:digest->>title, summary:digest->>summary",
      )
      .order("created_at", { ascending: false })
      .limit(30),
    typeof id === "string"
      ? supabase.from("sources").select("*").eq("id", id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("accounts").select("*").order("created_at"),
  ]);
  const sources = (rows ?? []) as ListRow[];
  const source = detail as Source | null;
  const accounts = (accountRows ?? []) as Account[];
  const running = sources.some((s) => RUNNING.includes(s.status)) || (source && RUNNING.includes(source.status));

  return (
    <>
      <PageHeader title="素材" />
      {running ? <AutoRefresh /> : null}

      <Card>
        <form action={createSource} className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              name="url"
              required
              placeholder="贴一个视频或播客链接，例如 https://www.youtube.com/watch?v=…"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button className={buttonClass}>转写</button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" value="auto" defaultChecked /> 有字幕取字幕，没有就 AI 转写
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" value="native" /> 只取字幕
            </label>
          </div>
          <p className="text-xs text-muted">
            {SUPPORTED_HINT}取字幕 1 积分；AI 转写每分钟 2 积分（Supadata 免费档每月 100 积分）。转好后自动整理出摘要、章节、要点、金句和爆款拆解。
          </p>
        </form>
        <div className="mt-4 border-t border-line pt-4">
          <UploadForm orgId={org.id} />
        </div>
      </Card>

      {typeof error === "string" ? <p className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p> : null}
      {typeof sent === "string" ? (
        <p className="mt-3 rounded-xl bg-soft p-3 text-sm">
          开始写 {sent} 份文案了，一两分钟后到 <Link href="/contents?status=approved" className="underline">内容</Link> 里看（命中禁用词的在「草稿」）。
        </p>
      ) : null}

      {source ? <SourceDetail source={source} accounts={accounts} /> : null}

      <h2 className="mb-3 mt-8 text-lg font-bold">最近的素材</h2>
      {sources.length === 0 ? (
        <Empty>还没有素材。贴一个 YouTube、TikTok 或播客音频链接，或者上传一段本地录音试试；资讯雷达里的视频也可以直接点「转写」。</Empty>
      ) : (
        <div className="grid gap-3">
          {sources.map((s) => (
            <Link key={s.id} href={`/sources?id=${s.id}`}>
              <Card>
                <Meta source={s} />
                <div className="mt-2 font-medium">{s.digest_title || s.title || s.url}</div>
                {s.summary ? <p className="mt-1 line-clamp-2 text-sm text-muted">{s.summary}</p> : null}
                {s.status === "failed" && s.error ? <p className="mt-1 text-sm text-bad">{s.error}</p> : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** 时间点：贴链接的可以点开原视频（YouTube 跳到那一秒），上传的文件只显示时间 */
function At({ source, seconds, className }: { source: Source; seconds: number; className: string }) {
  if (source.storage_path) return <span className={`${className} tabular-nums text-muted`}>{clock(seconds)}</span>;
  return (
    <a href={linkAt(source.url, seconds)} target="_blank" rel="noreferrer" className={`${className} tabular-nums text-muted underline`}>
      {clock(seconds)}
    </a>
  );
}

function SourceDetail({ source, accounts }: { source: Source; accounts: Account[] }) {
  const d = source.digest;
  return (
    <div className="mt-6 grid gap-3">
      <Card>
        <Meta source={source} />
        <h2 className="mt-2 text-xl font-black">{d?.title || source.title || source.url}</h2>
        {d?.title && source.title && d.title !== source.title ? <p className="text-sm text-muted">{source.title}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
          {source.author ? <span>{source.author}</span> : null}
          {source.storage_path ? (
            <span>本地上传</span>
          ) : (
            <a href={source.url} target="_blank" rel="noreferrer" className="underline">
              原链接
            </a>
          )}
          {source.status === "ready" ? (
            <a href={`/api/sources/${source.id}/transcript`} className="underline">
              下载 Markdown
            </a>
          ) : null}
          <form action={deleteSource.bind(null, source.id)}>
            <button className="hover:text-bad">删除</button>
          </form>
        </div>
        {RUNNING.includes(source.status) ? (
          <p className="mt-3 text-sm text-muted">
            {STATUS_LABELS[source.status]}……长视频要几分钟，页面会自动刷新。
          </p>
        ) : null}
        {source.status === "failed" ? (
          <form action={retrySource.bind(null, source.id)} className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-bad">{source.error}</span>
            <button className={ghostButtonClass}>重试</button>
            {source.mode === "native" ? (
              <button name="mode" value="auto" className={ghostButtonClass}>
                改用 AI 转写
              </button>
            ) : null}
          </form>
        ) : null}
        {d?.summary ? <p className="mt-4 leading-7">{d.summary}</p> : null}
      </Card>

      {d ? (
        <>
          <WriteForm source={source} accounts={accounts} />

          <div className="grid gap-3 md:grid-cols-2">
            {d.key_points.length ? (
              <Section title="要点">
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {d.key_points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </Section>
            ) : null}
            {d.breakdown.hook || d.breakdown.structure.length ? (
              <Section title="爆款拆解">
                <dl className="grid gap-2 text-sm">
                  {d.breakdown.hook ? (
                    <div>
                      <dt className="text-muted">开头怎么抓人</dt>
                      <dd>{d.breakdown.hook}</dd>
                    </div>
                  ) : null}
                  {d.breakdown.structure.length ? (
                    <div>
                      <dt className="text-muted">怎么展开</dt>
                      <dd>
                        <ol className="list-decimal pl-5">
                          {d.breakdown.structure.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      </dd>
                    </div>
                  ) : null}
                  {d.breakdown.why_it_works ? (
                    <div>
                      <dt className="text-muted">好在哪</dt>
                      <dd>{d.breakdown.why_it_works}</dd>
                    </div>
                  ) : null}
                  {d.breakdown.reuse ? (
                    <div>
                      <dt className="text-muted">写稿能借鉴</dt>
                      <dd>{d.breakdown.reuse}</dd>
                    </div>
                  ) : null}
                </dl>
              </Section>
            ) : null}
          </div>

          {d.chapters.length ? (
            <Section title="章节">
              <ul className="grid gap-2 text-sm">
                {d.chapters.map((c, i) => (
                  <li key={i} className="flex gap-3">
                    <At source={source} seconds={c.start} className="shrink-0" />
                    <span>
                      <span className="font-medium">{c.title}</span>
                      {c.summary ? <span className="text-muted">：{c.summary}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {d.quotes.length ? (
            <Section title="金句">
              <div className="grid gap-3 text-sm">
                {d.quotes.map((q, i) => (
                  <blockquote key={i} className="border-l-4 border-line pl-3">
                    <p>{q.text}</p>
                    {q.zh ? <p className="text-muted">{q.zh}</p> : null}
                    <At source={source} seconds={q.start} className="text-xs" />
                  </blockquote>
                ))}
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      {source.transcript?.length ? (
        <Card>
          <details>
            <summary className="cursor-pointer font-bold">文字稿（{source.transcript.length} 段）</summary>
            <div className="mt-3 grid gap-2 text-sm">
              {source.transcript.map((s, i) => (
                <p key={i}>
                  <At source={source} seconds={s.start} className="mr-2" />
                  {s.text}
                </p>
              ))}
            </div>
          </details>
        </Card>
      ) : null}
    </div>
  );
}

/** 选一个切入角度、要写的账号和形式，按选题「生成文案」同一套流程写，素材会带进提示词 */
function WriteForm({ source, accounts }: { source: Source; accounts: Account[] }) {
  const angles = source.digest?.angles ?? [];
  return (
    <Card>
      <h3 className="mb-2 font-bold">写成内容</h3>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">
          先到 <Link href="/accounts" className="underline">账号与档案</Link> 加账号、填档案。
        </p>
      ) : (
        <form action={writeFromSource.bind(null, source.id)} className="grid gap-3">
          <fieldset className="grid gap-2 text-sm">
            {angles.map((a, i) => (
              <label key={i} className="flex items-start gap-2">
                <input type="radio" name="angle" value={i} defaultChecked={i === 0} className="mt-1" />
                <span>
                  <span className="font-medium">{a.title}</span>
                  {a.angle ? <span className="text-muted">：{a.angle}</span> : null}
                </span>
              </label>
            ))}
            <label className="flex items-start gap-2">
              <input type="radio" name="angle" value="custom" defaultChecked={angles.length === 0} className="mt-3" />
              <span className="grid flex-1 gap-1">
                <input name="custom_title" placeholder="自己定一个选题" className={inputClass} />
                <input name="custom_angle" placeholder="切入角度（可选）" className={inputClass} />
              </span>
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {accounts.flatMap((a) =>
              formatsFor(a.platform).map((f) => (
                <label key={`${a.id}|${f.id}`} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="targets" value={`${a.id}|${f.id}`} disabled={!a.profile_id} />
                  {f.label} @{a.handle}
                </label>
              )),
            )}
          </div>
          <div>
            <button className={buttonClass}>生成文案</button>
          </div>
          <p className="text-xs text-muted">短内容带摘要、要点和金句；长文和小红书再带上文字稿，细节以它为准。没填档案的账号不能选。</p>
        </form>
      )}
    </Card>
  );
}
