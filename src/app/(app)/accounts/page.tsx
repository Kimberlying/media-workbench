import { Card, PageHeader, buttonClass, ghostButtonClass, inputClass } from "@/components/ui";
import { BufferClient, type BufferChannel } from "@/lib/buffer/client";
import type { Account, AccountProfile } from "@/lib/db/types";
import { requireSession } from "@/lib/session";
import { addManualAccount, saveProfile, setBufferChannel } from "../actions";

/** 配了 BUFFER_API_KEY 时列出 Buffer 里的频道，供每个账号选；读不到就手填频道 id */
async function loadBufferChannels(): Promise<BufferChannel[] | null> {
  if (!process.env.BUFFER_API_KEY) return null;
  try {
    return await new BufferClient(process.env.BUFFER_API_KEY).channels();
  } catch {
    return null;
  }
}

const PLATFORM_LABELS = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  xiaohongshu: "小红书",
  wechat: "公众号",
  zhihu: "知乎",
  threads: "Threads",
} as const;

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const { supabase, workspace } = await requireSession();
  const { error } = await searchParams;

  const { data } = await supabase
    .from("accounts")
    .select("*, profile:account_profiles(*)")
    .order("created_at");
  const accounts = (data ?? []) as (Account & { profile: AccountProfile | null })[];
  const channels = await loadBufferChannels();

  return (
    <>
      <PageHeader title="账号与档案">
        <a href={`/api/connect/x?workspace=${workspace.id}`} className={buttonClass}>
          连接 X 账号
        </a>
      </PageHeader>
      {error ? <p className="mb-4 text-sm text-bad">{String(error)}</p> : null}

      <div className="grid gap-4">
        {accounts.map((a) => (
          <Card key={a.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {PLATFORM_LABELS[a.platform]} @{a.handle}
              </span>
              <span className="text-xs text-muted">
                {a.buffer_channel_id
                  ? "经 Buffer 发布"
                  : a.platform === "x"
                    ? a.token_ref
                      ? "已授权，推文串可自动发布；长文出发布包"
                      : "未授权"
                    : "发布包 · 人工发"}
              </span>
            </div>
            <form action={setBufferChannel.bind(null, a.id)} className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Buffer 频道</span>
              {channels ? (
                <select name="buffer_channel_id" defaultValue={a.buffer_channel_id ?? ""} className={`${inputClass} w-auto`}>
                  <option value="">不经 Buffer</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} · {ch.service}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name="buffer_channel_id"
                  defaultValue={a.buffer_channel_id ?? ""}
                  placeholder="频道 id；配了 BUFFER_API_KEY 会改成下拉选"
                  className={`${inputClass} w-72`}
                />
              )}
              <button className={ghostButtonClass}>保存</button>
            </form>
            <form action={saveProfile.bind(null, a.id)} className="grid gap-3 md:grid-cols-2">
              <Field label="账号定位" name="positioning" value={a.profile?.positioning} rows={2} />
              <Field label="目标受众" name="audience" value={a.profile?.audience} rows={2} />
              <Field label="语气" name="tone" value={a.profile?.tone} rows={2} />
              <Field label="不碰的话题 / 禁用词（逗号或换行分隔）" name="taboo" value={a.profile?.taboo.join("\n")} rows={2} />
              <Field label="对标账号与关注方向（资讯雷达按这里抓）" name="benchmarks" value={a.profile?.benchmarks.join("\n")} rows={3} />
              <label className="grid gap-1 text-sm">
                <span className="text-muted">语言</span>
                <select name="language" defaultValue={a.profile?.language ?? "zh-CN"} className={inputClass}>
                  <option value="zh-CN">简体中文</option>
                  <option value="zh-HK">繁体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              <div className="md:col-span-2">
                <button className={buttonClass}>保存档案</button>
              </div>
            </form>
          </Card>
        ))}

        <Card>
          <div className="mb-2 text-sm font-medium">添加人工发布的账号</div>
          <form action={addManualAccount} className="flex flex-wrap items-center gap-2">
            <select name="platform" className={`${inputClass} w-auto`}>
              {Object.entries(PLATFORM_LABELS)
                .filter(([key]) => key !== "x")
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
            <input name="handle" placeholder="账号名" className={`${inputClass} w-48`} />
            <button className={ghostButtonClass}>添加</button>
          </form>
        </Card>
      </div>
    </>
  );
}

function Field({ label, name, value, rows }: { label: string; name: string; value?: string; rows: number }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <textarea name={name} defaultValue={value ?? ""} rows={rows} className={inputClass} />
    </label>
  );
}
