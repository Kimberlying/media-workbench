-- 素材（链接转写）：贴一个视频或播客链接，先转成带时间戳的文字稿，再整理成摘要、章节、要点、金句和爆款拆解，
-- 可以直接拿来出选题、写多平台文案。对标 SnapVee 的「链接进来就能转写」。

create type source_status as enum ('pending', 'transcribing', 'digesting', 'ready', 'failed');

create table sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  workspace_id uuid not null,
  url text not null,
  -- youtube / tiktok / instagram / x / facebook / file
  platform text not null default '',
  title text not null default '',
  author text not null default '',
  duration_seconds integer,
  lang text,
  -- auto：有字幕取字幕，没有就 AI 转写（按分钟计费）；native：只取字幕
  mode text not null default 'auto' check (mode in ('auto', 'native')),
  status source_status not null default 'pending',
  error text,
  -- 文字稿分段：[{ "start": 秒, "text": "…" }]
  transcript jsonb,
  -- 整理结果：摘要、章节、要点、金句、拆解、可做的选题，见 src/lib/sources/digest.ts
  digest jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (workspace_id, org_id) references workspaces (id, org_id) on delete cascade
);
create index on sources (org_id, created_at desc);

alter table sources enable row level security;
create policy "members read" on sources for select using (is_org_member(org_id));
create policy "editors write" on sources for all
  using (has_org_role(org_id, array['owner', 'editor']::member_role[]))
  with check (has_org_role(org_id, array['owner', 'editor']::member_role[]));

create trigger sources_touch before update on sources
  for each row execute function touch_updated_at();

-- 从素材出的选题记下来源，写文案时把素材带进提示词。素材删了选题还在，只是不再带素材。
alter table topics add column source_id uuid;
alter table topics
  add constraint topics_source_fkey
  foreign key (source_id, org_id) references sources (id, org_id) on delete set null (source_id);
create index on topics (source_id);
