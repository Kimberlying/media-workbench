-- 自媒体工作台 · 一期初始表结构
-- 所有业务表都带 org_id（或能经由上级表追溯到 org_id），靠 RLS 按组织隔离。
-- news_items 是例外：资讯雷达是共享池，所有登录用户可读，只有服务端任务可写。

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- 枚举
-- ---------------------------------------------------------------------------

create type member_role as enum ('owner', 'editor', 'reviewer', 'client_viewer');

create type platform as enum ('x', 'instagram', 'facebook', 'linkedin', 'xiaohongshu');

create type topic_status as enum ('candidate', 'selected', 'scheduled', 'used', 'discarded');

-- 草稿 → 合规检查 → 待审批 → 已批准 → 已排期 → 已发布；任一审批环节可退回草稿
create type content_status as enum (
  'draft',
  'compliance_check',
  'pending_approval',
  'approved',
  'scheduled',
  'published'
);

create type approval_decision as enum ('approved', 'rejected');

create type publish_method as enum ('api', 'manual');

create type knowledge_type as enum (
  'tone_guide',
  'taboo_words',
  'viral_post',
  'brand_material',
  'competitor'
);

-- ---------------------------------------------------------------------------
-- 租户：组织 → 工作区 → 账号
-- ---------------------------------------------------------------------------

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'self',
  quota jsonb not null default '{}'::jsonb,
  -- 租户级配置：平台、语言、是否需要审批等。自用租户关掉审批。
  settings jsonb not null default '{"approval_required": false}'::jsonb,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  -- 供子表做 (workspace_id, org_id) 复合外键，防止挂到别的组织的工作区下
  unique (id, org_id)
);
create index on workspaces (org_id);

create table members (
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references orgs (id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index on members (org_id);

create table account_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  positioning text not null default '',
  audience text not null default '',
  tone text not null default '',
  taboo text[] not null default '{}',
  benchmarks text[] not null default '{}',
  language text not null default 'zh-CN',
  updated_at timestamptz not null default now()
);
create index on account_profiles (org_id);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  workspace_id uuid not null,
  platform platform not null,
  handle text not null,
  profile_id uuid references account_profiles (id) on delete set null,
  -- 指向 account_secrets.id；令牌本身不在这张表，也不会出现在前端
  token_ref uuid,
  created_at timestamptz not null default now(),
  unique (platform, handle),
  unique (id, org_id),
  foreign key (workspace_id, org_id) references workspaces (id, org_id) on delete cascade
);
create index on accounts (org_id);
create index on accounts (workspace_id);

-- 平台授权令牌：AES-256-GCM 加密后存储，只有 service role 能读写（不开放任何 RLS 策略）
create table account_secrets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  ciphertext text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create index on account_secrets (org_id);

alter table accounts
  add constraint accounts_token_ref_fkey
  foreign key (token_ref) references account_secrets (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 知识库（简版）
-- ---------------------------------------------------------------------------

create table knowledge_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  workspace_id uuid not null,
  type knowledge_type not null,
  content text not null,
  -- 一期先不做向量检索，列留好，二期接 embedding
  embedding vector(1536),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces (id, org_id) on delete cascade
);
create index on knowledge_items (workspace_id, type);

-- ---------------------------------------------------------------------------
-- 资讯雷达（共享池，不带 org_id）
-- ---------------------------------------------------------------------------

create table news_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  url text not null unique,
  title text not null default '',
  summary text not null default '',
  tags text[] not null default '{}',
  fetched_at timestamptz not null default now()
);
create index on news_items (fetched_at desc);
create index on news_items using gin (tags);

-- ---------------------------------------------------------------------------
-- 选题 → 内容 → 审批 → 发布 → 数据
-- ---------------------------------------------------------------------------

create table topics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  account_id uuid not null,
  news_ids uuid[] not null default '{}',
  title text not null,
  angle text not null default '',
  -- 热度与相关性评分，0–100
  heat_score smallint not null default 0 check (heat_score between 0 and 100),
  relevance_score smallint not null default 0 check (relevance_score between 0 and 100),
  score smallint generated always as ((heat_score + relevance_score) / 2) stored,
  status topic_status not null default 'candidate',
  -- 周日历：该周周一的日期
  scheduled_week date,
  created_at timestamptz not null default now(),
  foreign key (account_id, org_id) references accounts (id, org_id) on delete cascade
);
create index on topics (account_id, status);
create index on topics (org_id, scheduled_week);

create table contents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  topic_id uuid references topics (id) on delete set null,
  account_id uuid not null,
  -- 平台 + 语言 + 形式，例如 x:zh-CN:thread
  variant text not null,
  body text not null,
  media_ids text[] not null default '{}',
  status content_status not null default 'draft',
  -- 合规检查命中的词；为空表示通过
  compliance_hits text[] not null default '{}',
  scheduled_at timestamptz,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, org_id) references accounts (id, org_id) on delete cascade
);
create index on contents (account_id, status);
create index on contents (status, scheduled_at);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  content_id uuid not null references contents (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id),
  decision approval_decision not null,
  reason text,
  created_at timestamptz not null default now()
);
create index on approvals (content_id);

create table posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  content_id uuid not null references contents (id) on delete cascade,
  platform_post_id text,
  published_at timestamptz not null default now(),
  method publish_method not null
);
create index on posts (content_id);

create table metrics (
  post_id uuid not null references posts (id) on delete cascade,
  org_id uuid not null references orgs (id) on delete cascade,
  date date not null,
  views integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  follows integer not null default 0,
  primary key (post_id, date)
);
create index on metrics (org_id, date);

-- ---------------------------------------------------------------------------
-- 计量
-- ---------------------------------------------------------------------------

create table usage_logs (
  id bigint generated always as identity primary key,
  -- 共享资讯雷达的抓取不属于任何租户，org_id 为空
  org_id uuid references orgs (id) on delete cascade,
  step text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  tokens integer generated always as (input_tokens + output_tokens) stored,
  cost numeric(12, 6) not null default 0,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index on usage_logs (org_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

create or replace function is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from members
    where org_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function has_org_role(target_org uuid, roles member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from members
    where org_id = target_org and user_id = auth.uid() and role = any (roles)
  );
$$;

alter table orgs enable row level security;
alter table workspaces enable row level security;
alter table members enable row level security;
alter table account_profiles enable row level security;
alter table accounts enable row level security;
alter table account_secrets enable row level security;
alter table knowledge_items enable row level security;
alter table news_items enable row level security;
alter table topics enable row level security;
alter table contents enable row level security;
alter table approvals enable row level security;
alter table posts enable row level security;
alter table metrics enable row level security;
alter table usage_logs enable row level security;

create policy "members read org" on orgs
  for select using (is_org_member(id));
create policy "owners update org" on orgs
  for update using (has_org_role(id, array['owner']::member_role[]));

create policy "members read own memberships" on members
  for select using (is_org_member(org_id));
create policy "owners manage members" on members
  for all using (has_org_role(org_id, array['owner']::member_role[]))
  with check (has_org_role(org_id, array['owner']::member_role[]));

-- 编辑类表：成员可读，owner / editor 可写
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspaces', 'account_profiles', 'accounts', 'knowledge_items', 'topics', 'contents'
  ]
  loop
    execute format(
      'create policy "members read" on %I for select using (is_org_member(org_id))', t);
    execute format(
      'create policy "editors write" on %I for all
         using (has_org_role(org_id, array[''owner'',''editor'']::member_role[]))
         with check (has_org_role(org_id, array[''owner'',''editor'']::member_role[]))', t);
  end loop;
end $$;

-- 审批：成员可读，owner / reviewer 可写
create policy "members read" on approvals
  for select using (is_org_member(org_id));
create policy "reviewers write" on approvals
  for insert with check (
    has_org_role(org_id, array['owner', 'reviewer']::member_role[])
    and reviewer_id = auth.uid()
  );

-- 发布记录、数据、用量：成员只读，写入由服务端任务（service role）完成
create policy "members read" on posts for select using (is_org_member(org_id));
-- 发布包平台人工发完后，由编辑登记
create policy "editors log manual posts" on posts
  for insert with check (
    method = 'manual' and has_org_role(org_id, array['owner', 'editor']::member_role[])
  );
create policy "members read" on metrics for select using (is_org_member(org_id));
create policy "members read" on usage_logs for select using (is_org_member(org_id));

-- 资讯共享池：登录用户都可读
create policy "authenticated read" on news_items
  for select to authenticated using (true);

-- account_secrets 不建任何策略：只有 service role 能访问

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contents_touch before update on contents
  for each row execute function touch_updated_at();
create trigger account_profiles_touch before update on account_profiles
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- 首次登录：给当前用户建一个自用组织和默认工作区（已有组织则直接返回）
-- ---------------------------------------------------------------------------

create or replace function ensure_personal_org(org_name text default '我的工作台')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
  new_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select org_id into existing from members where user_id = auth.uid() limit 1;
  if existing is not null then
    return existing;
  end if;

  insert into orgs (name, plan) values (org_name, 'self') returning id into new_org;
  insert into members (user_id, org_id, role) values (auth.uid(), new_org, 'owner');
  insert into workspaces (org_id, name) values (new_org, '自用');
  return new_org;
end;
$$;

grant execute on function ensure_personal_org(text) to authenticated;
